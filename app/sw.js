// sw.js — service worker for the PWA.
// Strategy chosen for an app that is (a) deployed often and (b) must be fresh online:
//   • same-origin app code → NETWORK-FIRST  (online = always the latest deploy; cache is the
//     offline fallback). This is why your edits/deploys reach the phone immediately when online.
//   • the pinned Firebase SDK on gstatic    → CACHE-FIRST (big, version-pinned; offline-capable).
//   • Firestore / Auth traffic              → NOT intercepted (the Firestore SDK's own IndexedDB
//     persistence serves the last data offline; writes are blocked by the app when offline).
const CACHE = 'tools-shell-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './styles/app.css',
  './ui/app.js', './ui/charts.js', './ui/report.js',
  './core/storage.js', './core/model.js', './core/permissions.js', './core/views.js',
  './core/dashboard.js', './core/security.js', './core/import.js', './core/workflows.js',
  './core/ids.js', './core/dates.js', './core/admins.js',
  './core/firebase.js', './core/firebase-adapter.js', './core/firebase-config.js',
  './icon-192.png', './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  // live data + auth: let the Firebase SDK handle it (its own offline cache / write queue)
  if (/firestore\.googleapis|firebaseio|identitytoolkit|securetoken|googleapis\.com\/google\.firestore/.test(url)) return;
  // pinned Firebase SDK: cache-first
  if (url.includes('gstatic.com/firebasejs')) {
    e.respondWith(caches.match(req).then((c) => c || fetch(req).then((r) => {
      const cl = r.clone(); caches.open(CACHE).then((ca) => ca.put(req, cl)); return r;
    })));
    return;
  }
  // same-origin app shell: network-first (fresh online), cache fallback (offline)
  if (new URL(url).origin === self.location.origin) {
    e.respondWith(fetch(req).then((r) => {
      if (r && r.ok) { const cl = r.clone(); caches.open(CACHE).then((ca) => ca.put(req, cl)); }
      return r;
    }).catch(() => caches.match(req).then((c) => c || caches.match('./index.html'))));
  }
});
