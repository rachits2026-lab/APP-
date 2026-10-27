// Pages: network first, so a new version reaches people as soon as they are
// online, with the cached copy as the offline fallback.
// Everything else (hashed build files, fonts, OCR data): cache first, so the
// app and the label reader work with no connection.
const CACHE = 'chirp-hunter-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

function store(req, res) {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => store('/', res)).catch(() => caches.match('/')),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => store(req, res))),
  );
});

// Tapping a reminder opens the app (or focuses it) on the right screen.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.go || '#/', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins[0];
      if (win) return win.navigate(url).then((w) => (w || win).focus()).catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    }),
  );
});
