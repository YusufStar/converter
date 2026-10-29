// Service worker, written to dist/sw.js by vite.config.ts with `BUILD` prepended:
//   BUILD = { version, shell: [...urls to precache], assets: [...every /assets/* path of this build] }
// Pages: network first, cached copy (or the app shell) when offline.
// /assets/*: hashed and immutable, so cache first; heavy engines (ffmpeg, OCR, codecs) are cached
// the first time a tool uses them and then work offline too.
/* global BUILD */

const SHELL = `shell-${BUILD.version}`;
const ASSETS = "assets";
const ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(BUILD.shell))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("shell-") && key !== SHELL) await caches.delete(key);
      // Forget hashed files the new build no longer ships.
      const keep = new Set(BUILD.assets);
      const cache = await caches.open(ASSETS);
      for (const req of await cache.keys()) if (!keep.has(new URL(req.url).pathname)) await cache.delete(req);
      await self.clients.claim();
    })(),
  );
});

/** Cached and offline pages must stay cross-origin isolated (SharedArrayBuffer for ffmpeg). */
function isolate(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(ISOLATION)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            const copy = res.clone();
            event.waitUntil(caches.open(SHELL).then((cache) => cache.put(req, copy)));
          }
          return isolate(res);
        } catch {
          const cached = (await caches.match(req, { ignoreSearch: true })) ?? (await caches.match("/index.html"));
          return cached ? isolate(cached) : Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") && !req.headers.has("range")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === "basic") event.waitUntil(cache.put(req, res.clone()));
        return res;
      })(),
    );
  }
});
