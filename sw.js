// The offline file list is generated at build time by scripts/refresh-offline-cache.mjs into
// sw-manifest.js, which is not committed: app changes never touch this file, so pull requests
// do not conflict over it. The page registers sw.js?v=<revision>, so each deploy is a new version.
importScripts('sw-manifest.js');
const { revision, shell, vendorDirs } = self.OFFLINE_MANIFEST;

const scope = new URL(self.registration.scope);
const project = encodeURIComponent(scope.pathname);
const prefix = 'gifticon-pocket-shell:' + project + ':';
const cacheName = prefix + revision;
// The text recognition engine and barcode reader are large and optional, so they are cached on first
// use, not at install. Their directory names carry the version, so cached copies never go stale.
const vendorCache = 'gifticon-pocket-vendor:' + project;
const shareCache = 'gifticon-pocket-share:' + project;
const vendorBases = vendorDirs.map(dir => new URL(dir, scope).href);

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
      if (!vendorBases.some(base => request.url.startsWith(base))) await vendor.delete(request);
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
  if (vendorDirs.some(dir => relativePath.startsWith(dir))) {
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
