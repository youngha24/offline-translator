// 서비스워커: 앱 파일을 기기에 저장(오프라인 실행) + 다른 출처로 나가는 요청 전부 차단
const VERSION = 'app-v1';
const APP_FILES = ['./', 'index.html', 'style.css', 'app.js', 'models.js', 'sha256.js', 'split.js', 'worker.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/transformers.min.js', 'vendor/ort-wasm-simd-threaded.jsep.mjs', 'vendor/ort-wasm-simd-threaded.jsep.wasm'];
const MODEL_CACHE = 'offline-translator-model';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP_FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== MODEL_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) { e.respondWith(Response.error()); return; } // 외부 전송 금지
  if (e.request.method !== 'GET') return;
  const scope = new URL(self.registration.scope);
  const rel = url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : url.pathname;
  if (rel.startsWith('models/')) {
    // 모델 조각: 저장본 우선, 없으면 네트워크(받기 중) — 네트워크 결과는 app.js 가 검사 후 저장
    e.respondWith(caches.open(MODEL_CACHE).then(c => c.match(e.request)).then(r => r || fetch(e.request)));
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(e.request, { ignoreSearch: true }) || (e.request.mode === 'navigate' ? await c.match('index.html') : null);
    if (hit) return hit;
    try { return await fetch(e.request); }
    catch { return new Response('오프라인', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
  })());
});
