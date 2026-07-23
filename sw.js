// Bonmot service worker. Pattern inherited from Mise (which paid for
// the reopen-twice staleness bug so this app does not have to):
//   - app code, index, and data/en.json (change per deploy):
//     NETWORK-FIRST with cache fallback.
//   - vendor/, icons/ (version-pinned, replaced wholesale):
//     CACHE-FIRST, immutable until CACHE_VERSION bumps.
// Everything is precached on install so the very first offline open
// (a no-signal train) already works.

// BUMP this whenever anything under vendor/ or icons/ changes; those
// paths are cache-first and will serve stale forever otherwise.
const CACHE_VERSION = "bonmot-v2";

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./app/styles.css",
  "./app/main.js",
  "./app/bank.js",
  "./app/review-bank.js",
  "./app/srs.js",
  "./app/queue.js",
  "./app/stats.js",
  "./app/store.js",
  "./app/placement.js",
  "./app/views/entry.js",
  "./app/views/today.js",
  "./app/views/review.js",
  "./app/views/shelf.js",
  "./app/views/placement-view.js",
  "./data/en.json",
  "./data/review.json",
  "./vendor/ts-fsrs.mjs",
  "./vendor/fonts/fraunces-600.woff2",
  "./vendor/fonts/fraunces-italic.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

const SCOPE_PATH = new URL(
  self.registration ? self.registration.scope : self.location.href,
).pathname.replace(/[^/]*$/, "");
const IMMUTABLE = new RegExp(
  `^${SCOPE_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(vendor|icons)/`,
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
  } else {
    event.respondWith(networkFirst(req));
  }
});

function putInCache(req, res) {
  if (!res.ok) return;
  const copy = res.clone();
  caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  putInCache(req, res);
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    putInCache(req, res);
    return res;
  } catch {
    const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
    if (hit) return hit;
    throw new Error("offline and not cached: " + req.url);
  }
}
