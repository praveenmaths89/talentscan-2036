const CACHE = "kheltara-shell-v4";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./js/app.js",
  "./js/config.js",
  "./js/env.js",
  "./js/i18n.js",
  "./js/locales.js",
  "./js/store.js",
  "./js/signal.js",
  "./js/norms.js",
  "./js/battery.js",
  "./js/audio.js",
  "./js/motion.js",
  "./js/ppg.js",
  "./js/conditions.js",
  "./js/demos.js",
  "./js/vendor/qrcode.js",
  "./locales/en.json",
  "./locales/hi.json",
  "./icons/icon.svg",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
