// 앱 화면·번역 엔진 파일을 기기에 보관 → 비행기 모드에서도 열린다. (모델은 transformers.js 가 자체 캐시에 보관)
const CACHE = "ot-shell-3";
const SHELL = ["./", "index.html", "app.js", "text.js", "worker.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png",
  "vendor/transformers.min.js", "vendor/ort-wasm-simd-threaded.jsep.mjs", "vendor/ort-wasm-simd-threaded.jsep.wasm"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("ot-shell-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // 모델(huggingface)은 transformers.js 캐시가 맡는다
  if (u.pathname.includes("/vendor/")) {   // 번역 엔진(21MB): 보관본 먼저(판이 바뀌면 CACHE 이름이 바뀐다)
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
    return;
  }
  // 화면 파일: 인터넷 되면 새것, 안 되면 보관본
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))));
});
