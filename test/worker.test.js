import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { PushReminders, cleanReminders } from '../worker/index.js';
import { browserSubscription, decryptPush } from './helpers/push.js';

class FakeStorage {
  data = new Map();
  alarm = null;
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { this.data.set(key, structuredClone(value)); }
  async deleteAll() { this.data.clear(); }
  async setAlarm(time) { this.alarm = time; }
  async deleteAlarm() { this.alarm = null; }
}

function makeEnv() {
  const objects = new Map();
  const env = {
    ASSETS: { fetch: () => new Response('asset') },
    PUSH: {
      idFromName: name => name,
      get: id => ({
        fetch: (url, init) => {
          if (!objects.has(id)) objects.set(id, new PushReminders({ storage: new FakeStorage() }, env));
          return objects.get(id).fetch(new Request(url, init));
        },
      }),
    },
  };
  return { env, objects };
}

const origin = 'https://gifticon.example';
const api = (env, path, body, headers = {}) => worker.fetch(new Request(origin + path, body === undefined ? {} : {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body),
}), env);

let sent;
let pushStatus;
const realFetch = globalThis.fetch;
beforeEach(() => {
  sent = [];
  pushStatus = 201;
  globalThis.fetch = async (url, init) => {
    sent.push({ url, headers: init.headers, body: init.body });
    return new Response(null, { status: pushStatus });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const findObject = objects => [...objects.values()].find(o => o.storage.data.has('subscription'));

test('public key is generated once and reused', async () => {
  const { env } = makeEnv();
  const first = await (await api(env, '/api/push/key')).json();
  const second = await (await api(env, '/api/push/key')).json();
  assert.match(first.publicKey, /^B[A-Za-z0-9_-]{86}$/);
  assert.equal(first.publicKey, second.publicKey);
});

test('sync schedules the next reminder, alarm delivers due ones encrypted', async () => {
  const { env, objects } = makeEnv();
  const { ecdh, auth, subscription } = browserSubscription();
  const now = Date.now();
  const reminders = [
    { at: now + 3 * 86400000, title: '3일 후', body: 'b', tag: 't2', url: '/?filter=expiring' },
    { at: now - 1000, title: '오늘 만료되는 기프티콘 1개', body: '스타벅스 아메리카노', tag: 't1', url: '/?filter=expiring' },
  ];
  const response = await api(env, '/api/push/sync', { subscription, reminders });
  assert.equal(response.status, 200);
  const object = findObject(objects);
  assert.ok(Math.abs(object.storage.alarm - now) < 5000, 'alarm at the earliest reminder');

  await object.alarm();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, subscription.endpoint);
  assert.match(sent[0].headers.Authorization, /^vapid t=.+, k=B/);
  assert.equal(sent[0].headers['Content-Encoding'], 'aes128gcm');
  const message = JSON.parse(decryptPush(sent[0].body, ecdh, auth));
  assert.deepEqual(message, { title: '오늘 만료되는 기프티콘 1개', body: '스타벅스 아메리카노', tag: 't1', url: '/?filter=expiring' });
  assert.equal(object.storage.alarm, reminders[0].at, 'next alarm is the remaining reminder');
  assert.equal((await object.storage.get('reminders')).length, 1);
});

test('a gone subscription is forgotten, a failing push service is retried', async () => {
  const { env, objects } = makeEnv();
  const { subscription } = browserSubscription();
  await api(env, '/api/push/sync', { subscription, reminders: [{ at: Date.now() - 1000, title: 'x', body: 'y' }] });
  const object = findObject(objects);

  pushStatus = 503;
  await object.alarm();
  const [retry] = await object.storage.get('reminders');
  assert.equal(retry.tries, 1);
  assert.equal(object.storage.alarm, retry.at);

  pushStatus = 410;
  retry.at = Date.now() - 1000;
  await object.storage.put('reminders', [retry]);
  await object.alarm();
  assert.equal(object.storage.data.size, 0);
  assert.equal(object.storage.alarm, null);
});

test('unsubscribe clears the device', async () => {
  const { env, objects } = makeEnv();
  const { subscription } = browserSubscription();
  await api(env, '/api/push/sync', { subscription, reminders: [{ at: Date.now() + 60000, title: 'x', body: 'y' }] });
  const object = findObject(objects);
  await api(env, '/api/push/unsubscribe', { endpoint: subscription.endpoint });
  assert.equal(object.storage.data.size, 0);
  assert.equal(object.storage.alarm, null);
});

test('moving a subscription carries the reminders over', async () => {
  const { env, objects } = makeEnv();
  const old = browserSubscription('https://updates.push.services.mozilla.com/wpush/v2/old');
  const fresh = browserSubscription('https://updates.push.services.mozilla.com/wpush/v2/new');
  await api(env, '/api/push/sync', { subscription: old.subscription, reminders: [{ at: Date.now() + 60000, title: 'x', body: 'y' }] });
  await api(env, '/api/push/move', { oldEndpoint: old.subscription.endpoint, subscription: fresh.subscription });
  const holders = [...objects.values()].filter(o => o.storage.data.has('subscription'));
  assert.equal(holders.length, 1);
  assert.equal((await holders[0].storage.get('subscription')).endpoint, fresh.subscription.endpoint);
  assert.equal((await holders[0].storage.get('reminders')).length, 1);
});

test('test notification is sent right away and rate limited', async () => {
  const { env } = makeEnv();
  const { subscription } = browserSubscription();
  assert.equal((await api(env, '/api/push/test', { subscription })).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers.Urgency, 'high');
  assert.equal((await api(env, '/api/push/test', { subscription })).status, 429);
});

test('requests that are not from the app or not for a push service are refused', async () => {
  const { env } = makeEnv();
  const { subscription } = browserSubscription('https://attacker.example/collect');
  assert.equal((await api(env, '/api/push/sync', { subscription, reminders: [] })).status, 400);
  const good = browserSubscription().subscription;
  assert.equal((await api(env, '/api/push/sync', { subscription: good, reminders: [] }, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await api(env, '/api/push/sync', { subscription: { ...good, keys: { p256dh: 'x', auth: 'y' } }, reminders: [] })).status, 400);
  assert.equal(sent.length, 0);
});

test('reminders are bounded and cleaned', () => {
  const now = Date.now();
  const list = Array.from({ length: 150 }, (_, i) => ({ at: now + i * 1000, title: 't'.repeat(500), url: 'https://evil.example' }));
  const cleaned = cleanReminders([{ at: 'soon' }, { at: now - 2 * 86400000 }, ...list], now);
  assert.equal(cleaned.length, 100);
  assert.equal(cleaned[0].title.length, 120);
  assert.equal(cleaned[0].url, '/');
});

test('other paths are served from static assets', async () => {
  const { env } = makeEnv();
  assert.equal(await (await worker.fetch(new Request(origin + '/'), env)).text(), 'asset');
  const share = await worker.fetch(new Request(origin + '/share-target', { method: 'POST' }), env);
  assert.equal(share.status, 303);
});
