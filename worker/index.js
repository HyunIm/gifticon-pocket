// Serves the app (static assets) and the expiry reminder API.
// Each browser push subscription gets its own Durable Object, which stores that device's
// reminders and wakes up with an alarm when the next one is due. No cron, no database setup.
import { generateVapidKeys, sendPush } from './webpush.js';

const MAX_REMINDERS = 100;
const RETRY_LIMIT = 4;
const STALE_MS = 12 * 3600000;
// Push services operated by browser vendors. Anything else is refused, so the API cannot be
// used to make this server POST to arbitrary URLs.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/,
  /\.notify\.windows\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export function validEndpoint(endpoint, env = {}) {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
  // Local tests point subscriptions at a fake push service.
  if (env.PUSH_TEST_ENDPOINT_PREFIX && endpoint.startsWith(env.PUSH_TEST_ENDPOINT_PREFIX)) return true;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_HOSTS.some(pattern => pattern.test(url.hostname));
  } catch {
    return false;
  }
}

export function cleanSubscription(value, env) {
  if (!value || !validEndpoint(value.endpoint, env)) return null;
  const { p256dh, auth } = value.keys || {};
  if (!/^[A-Za-z0-9_-]{86,88}={0,2}$/.test(p256dh || '') || !/^[A-Za-z0-9_-]{21,24}={0,2}$/.test(auth || '')) return null;
  return { endpoint: value.endpoint, keys: { p256dh, auth } };
}

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

export function cleanReminders(list, now = Date.now()) {
  if (!Array.isArray(list)) return null;
  const horizon = now + 6 * 366 * 86400000;
  return list
    .filter(item => item && Number.isFinite(item.at) && item.at > now - 86400000 && item.at < horizon)
    .slice(0, MAX_REMINDERS)
    .map(item => ({
      at: item.at,
      title: text(item.title, 120) || '기프티콘 포켓',
      body: text(item.body, 400),
      tag: text(item.tag, 64),
      url: typeof item.url === 'string' && item.url.startsWith('/') ? item.url.slice(0, 200) : '/',
    }))
    .sort((a, b) => a.at - b.at);
}

async function endpointId(env, endpoint) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return env.PUSH.idFromName([...digest].map(b => b.toString(16).padStart(2, '0')).join(''));
}

let vapidCache;
export async function vapidKeys(env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  // Otherwise one Durable Object generates a key pair on first use and keeps it.
  vapidCache ||= env.PUSH.get(env.PUSH.idFromName('vapid-keys')).fetch('https://push/vapid').then(r => r.json());
  return vapidCache.catch(error => { vapidCache = null; throw error; });
}

function subjectFor(env, url) {
  return env.VAPID_SUBJECT || (url.protocol === 'https:' ? url.origin : 'mailto:push@gifticon-pocket.invalid');
}

async function handleApi(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/api/push/key') {
    const { publicKey } = await vapidKeys(env);
    return json({ publicKey });
  }
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  // Only the app itself calls this API.
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'origin' }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'json' }, 400);
  }
  const call = async (endpoint, path, payload) => {
    const stub = env.PUSH.get(await endpointId(env, endpoint));
    return stub.fetch('https://push' + path, { method: 'POST', body: JSON.stringify(payload || {}) });
  };
  const subject = subjectFor(env, url);
  switch (url.pathname) {
    case '/api/push/sync': {
      const subscription = cleanSubscription(body.subscription, env);
      const reminders = cleanReminders(body.reminders);
      if (!subscription || !reminders) return json({ error: 'invalid' }, 400);
      return call(subscription.endpoint, '/sync', { subscription, reminders, subject });
    }
    case '/api/push/test': {
      const subscription = cleanSubscription(body.subscription, env);
      if (!subscription) return json({ error: 'invalid' }, 400);
      return call(subscription.endpoint, '/test', { subscription, subject });
    }
    case '/api/push/unsubscribe': {
      if (!validEndpoint(body.endpoint, env)) return json({ error: 'invalid' }, 400);
      return call(body.endpoint, '/clear');
    }
    case '/api/push/move': {
      const subscription = cleanSubscription(body.subscription, env);
      if (!subscription) return json({ error: 'invalid' }, 400);
      let reminders = [];
      if (validEndpoint(body.oldEndpoint, env)) reminders = (await (await call(body.oldEndpoint, '/take')).json()).reminders || [];
      return call(subscription.endpoint, '/sync', { subscription, reminders: cleanReminders(reminders), subject });
    }
    default:
      return json({ error: 'not found' }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        console.error('push api', error);
        return json({ error: 'server' }, 500);
      }
    }
    // The service worker normally answers the share target; this covers the very first visit.
    if (url.pathname === '/share-target') return Response.redirect(new URL('/', url).href, 303);
    return env.ASSETS.fetch(request);
  },
};

export class PushReminders {
  constructor(ctx, env) {
    this.storage = ctx.storage;
    this.env = env;
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/vapid') return json(await this.ownVapidKeys());
    const body = request.method === 'POST' ? await request.json() : {};
    if (pathname === '/sync') {
      await this.storage.put('subscription', body.subscription);
      await this.storage.put('subject', body.subject);
      await this.storage.put('reminders', body.reminders);
      await this.schedule(body.reminders);
      return json({ ok: true, scheduled: body.reminders.length, next: body.reminders[0]?.at ?? null });
    }
    if (pathname === '/clear') {
      await this.clear();
      return json({ ok: true });
    }
    if (pathname === '/take') {
      const reminders = (await this.storage.get('reminders')) || [];
      await this.clear();
      return json({ reminders });
    }
    if (pathname === '/test') return this.test(body);
    return json({ error: 'not found' }, 404);
  }

  async ownVapidKeys() {
    let keys = await this.storage.get('vapid');
    if (!keys) {
      keys = await generateVapidKeys();
      await this.storage.put('vapid', keys);
    }
    return keys;
  }

  async clear() {
    await this.storage.deleteAlarm();
    await this.storage.deleteAll();
  }

  async schedule(reminders) {
    if (reminders.length) await this.storage.setAlarm(Math.max(reminders[0].at, Date.now()));
    else await this.storage.deleteAlarm();
  }

  async test({ subscription, subject }) {
    const last = (await this.storage.get('lastTest')) || 0;
    if (Date.now() - last < 10000) return json({ error: 'too soon' }, 429);
    await this.storage.put('lastTest', Date.now());
    const response = await sendPush(subscription, {
      title: '기프티콘 포켓',
      body: '알림이 잘 도착했어요. 만료 3일 전과 만료일 오전 9시에 알려 드릴게요.',
      tag: 'test',
      url: '/',
    }, await vapidKeys(this.env), subject, { ttl: 600, urgency: 'high' });
    if (response.status === 404 || response.status === 410) await this.clear();
    return json({ status: response.status }, response.ok ? 200 : 502);
  }

  async alarm() {
    const subscription = await this.storage.get('subscription');
    if (!subscription) return;
    const subject = await this.storage.get('subject');
    const reminders = (await this.storage.get('reminders')) || [];
    const now = Date.now();
    const due = reminders.filter(item => item.at <= now + 60000);
    const rest = reminders.filter(item => item.at > now + 60000);
    const vapid = due.length ? await vapidKeys(this.env) : null;
    for (const item of due) {
      // A reminder the platform delivered half a day late is no longer worth sending.
      if (item.at < now - STALE_MS && !item.tries) continue;
      let response = null;
      try {
        response = await sendPush(subscription, { title: item.title, body: item.body, tag: item.tag, url: item.url }, vapid, subject);
      } catch (error) {
        console.error('push send', error);
      }
      // The browser unsubscribed or the app was removed: forget this device.
      if (response && (response.status === 404 || response.status === 410)) {
        await this.clear();
        return;
      }
      if (!response || response.status === 429 || response.status >= 500) {
        const tries = (item.tries || 0) + 1;
        if (tries <= RETRY_LIMIT) rest.push({ ...item, at: now + tries * 10 * 60000, tries });
      }
    }
    rest.sort((a, b) => a.at - b.at);
    await this.storage.put('reminders', rest);
    await this.schedule(rest);
  }
}
