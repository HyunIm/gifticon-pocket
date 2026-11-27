// Expiry notifications through Web Push. The server only receives the reminder times and texts
// (brand and product name); coupon numbers and images stay on the device.
import { buildReminders } from './reminders.js';

// GitHub Pages serves static assets only. A Worker deployment can also serve the push API.
export const hasPushBackend = !location.hostname.endsWith('.github.io');
const SYNCED_KEY = 'gifticon-pocket:push-synced';
const storage = {
  get: key => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
  remove: key => { try { localStorage.removeItem(key); } catch { /* private mode */ } },
};

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isAppleMobile = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'
export async function pushState() {
  if (!hasPushBackend) return 'unavailable';
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return 'unsupported';
  // iOS and iPadOS offer Web Push only to web apps added to the home screen.
  if (isAppleMobile() && !isStandalone()) return 'needs-install';
  if (!('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const subscription = await currentSubscription();
  return subscription && Notification.permission === 'granted' ? 'on' : 'off';
}

async function registration() {
  // ready never settles if the service worker failed to register; give up after a few seconds.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('service worker unavailable')), 5000)),
  ]);
}

async function currentSubscription() {
  try {
    return await (await registration()).pushManager.getSubscription();
  } catch {
    return null;
  }
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`push server ${response.status}`);
  return response;
}

// Must run from a click: browsers only show the permission prompt for a user gesture.
export async function enablePush(records) {
  if (!hasPushBackend) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  const response = await fetch('/api/push/key');
  if (!response.ok) throw new Error('push key');
  const { publicKey } = await response.json();
  const serverKey = base64UrlToBytes(publicKey);
  let subscription = await reg.pushManager.getSubscription();
  const subscribedKey = subscription?.options?.applicationServerKey;
  // A subscription made with another server key cannot receive our messages.
  if (subscription && subscribedKey && !sameBytes(new Uint8Array(subscribedKey), serverKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
  await syncReminders(records, { force: true });
  return 'on';
}

export async function disablePush() {
  const subscription = await currentSubscription();
  storage.remove(SYNCED_KEY);
  if (!subscription) return;
  await post('/api/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => {});
  await subscription.unsubscribe();
}

export async function sendTestPush() {
  const subscription = await currentSubscription();
  if (!subscription) throw new Error('not subscribed');
  await post('/api/push/test', { subscription: subscription.toJSON() });
}

async function digest(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...bytes));
}

// Sends the current schedule when it changed since the last successful sync. Safe to call often.
export async function syncReminders(records, { force = false } = {}) {
  if (!hasPushBackend) return false;
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const subscription = await currentSubscription();
  if (!subscription) return false;
  const body = { subscription: subscription.toJSON(), reminders: buildReminders(records) };
  // Reminders already in the past drop out, so the hash also changes from day to day.
  const hash = await digest(JSON.stringify(body));
  if (!force && storage.get(SYNCED_KEY) === hash) return false;
  await post('/api/push/sync', body);
  storage.set(SYNCED_KEY, hash);
  return true;
}
