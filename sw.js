// The offline file list is generated at build time by scripts/refresh-offline-cache.mjs into
// sw-manifest.js, which is not committed: app changes never touch this file, so pull requests
// do not conflict over it. The page registers sw.js?v=<revision>, so each deploy is a new version.
importScripts('sw-manifest.js');
const { revision, shell, vendorDir } = self.OFFLINE_MANIFEST;

const scope = new URL(self.registration.scope);
const project = encodeURIComponent(scope.pathname);
const prefix = 'gifticon-pocket-shell:' + project + ':';
const cacheName = prefix + revision;
// The text recognition engine is large and optional, so it is cached on first use, not at install.
// Its directory name carries the version, so cached copies never go stale.
const vendorCache = 'gifticon-pocket-vendor:' + project;
const shareCache = 'gifticon-pocket-share:' + project;
const vendorBase = new URL(vendorDir, scope).href;

function shellRequest(path) {
  return new Request(new URL(path, scope), {
    cache: 'reload',
    credentials: 'omit',
    integrity: shell[path],
  });
}

self.addEventListener('install', event => {
  // addAll commits the release only after every file passes its integrity check.
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(Object.keys(shell).map(shellRequest))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(prefix) && name !== cacheName).map(name => caches.delete(name)));
    // Drop engine files from versions the app no longer references.
    const vendor = await caches.open(vendorCache);
    for (const request of await vendor.keys()) {
      if (!request.url.startsWith(vendorBase)) await vendor.delete(request);
    }
  })());
});

// The page asked to switch to the waiting version right away.
self.addEventListener('message', event => {
  if (event.data?.type === 'skip-waiting') self.skipWaiting();
});

// Android share sheet → "기프티콘 포켓": park the images, then open the app to register them.
async function receiveShare(request) {
  const data = await request.formData();
  const files = data.getAll('images').filter(file => typeof file === 'object' && file.type.startsWith('image/'));
  const cache = await caches.open(shareCache);
  const batch = crypto.randomUUID();
  await Promise.all(files.map((file, i) => cache.put(new URL(`shared/${batch}-${i}`, scope).href, new Response(file, {
    headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name || 'shared') },
  }))));
  return Response.redirect(new URL(`?shared=${files.length}`, scope).href, 303);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const relativePath = url.pathname.slice(scope.pathname.length);
  if (request.method === 'POST' && relativePath === 'share-target') {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET') return;
  if (relativePath.startsWith(vendorDir)) {
    event.respondWith(caches.open(vendorCache).then(async cache => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }));
    return;
  }
  const isHome = request.mode === 'navigate' && (relativePath === '' || relativePath === 'index.html');
  const path = isHome ? './' : relativePath;
  if ((!isHome && url.search) || !Object.hasOwn(shell, path)) return;
  event.respondWith(caches.open(cacheName).then(async cache =>
    (await cache.match(new URL(path, scope).href)) || fetch(shellRequest(path))
  ));
});

// Reminder payloads use the app home with a query, including older /?coupon= links.
function notificationTarget(value) {
  try {
    const url = new URL(value || './', scope);
    if (url.origin === scope.origin && (url.pathname === '/' || url.pathname === scope.pathname)) {
      const home = new URL(scope.href);
      home.search = url.search;
      return home.href;
    }
  } catch { /* An invalid link still opens the wallet. */ }
  return scope.href;
}

self.addEventListener('push', event => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data?.text() };
  }
  event.waitUntil(self.registration.showNotification(message.title || '기프티콘 포켓', {
    body: message.body || '곧 만료되는 기프티콘이 있어요.',
    tag: message.tag,
    icon: new URL('icons/icon-192.png', scope).href,
    badge: new URL('icons/badge-96.png', scope).href,
    lang: 'ko',
    data: { url: notificationTarget(message.url) },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = notificationTarget(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(client => {
      const url = new URL(client.url);
      return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
    });
    if (open) {
      // The open app shows the coupon in place: no reload, nothing typed is lost.
      await open.focus().catch(() => {});
      open.postMessage({ type: 'open', url: target });
      return;
    }
    return self.clients.openWindow(target);
  })());
});

// The push service replaced the subscription (Firefox does this); move the reminders over.
self.addEventListener('pushsubscriptionchange', event => {
  if (scope.hostname.endsWith('.github.io')) return;
  event.waitUntil((async () => {
    const options = event.oldSubscription?.options || { userVisibleOnly: true };
    const subscription = event.newSubscription || await self.registration.pushManager.subscribe(options);
    await fetch(new URL('api/push/move', scope), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldEndpoint: event.oldSubscription?.endpoint, subscription: subscription.toJSON() }),
    });
  })());
});
