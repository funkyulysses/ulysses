// public/sw.js
// Minimal app-shell service worker. Job: make the UI itself (HTML/CSS/JS)
// load offline after a first visit. Deliberately does NOT cache model bytes
// — those come from huggingface.co (cross-origin) and are wllama's /
// Transformers.js's own caching responsibility (Cache Storage / OPFS), see
// js/llm.js and js/embeddings.js. We only ever touch same-origin GET
// requests here, so those cross-origin model fetches pass straight through
// untouched.

const SHELL_CACHE = 'ulysses-shell-v1';
// Deployment-path-agnostic: self.registration.scope is wherever this SW
// actually ended up (e.g. "/" locally, "/ulysses/" on GitHub Pages).
const SCOPE_URL = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname; // always ends in "/"

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add(SCOPE_URL.href).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== SHELL_CACHE).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin (model) requests
  if (url.pathname.startsWith(SCOPE_PATH + 'wasm/')) return; // wllama's own asset, leave it alone

  // Network-first, falling back to cache, so the shell stays fresh when
  // online but still loads offline once a page has been visited once.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const fallback = await caches.match(SCOPE_URL.href);
          if (fallback) return fallback;
        }
        throw new Error('offline and not cached: ' + req.url);
      })
  );
});
