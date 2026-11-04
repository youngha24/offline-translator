// 모델 조각 저장소 — 화면(app.js)과 번역 일꾼(worker.js)이 함께 쓴다.
// 모델 파일은 40MB 조각으로 Cache Storage 에 저장하고, 읽을 때 Blob 으로 이어 붙인다.
import { Sha256 } from './sha256.js';
export const BASE = new URL('./', import.meta.url);
export const MODEL_CACHE = 'offline-translator-model';
const MANIFEST_URL = new URL('models/manifest.json', BASE).href;

export const partURL = (man, part) => new URL(`models/${man.model}/${part.path}`, BASE).href;
export const fileURL = (man, file) => new URL(`models/${man.model}/${file.path}`, BASE).href;

export async function cachedManifest() {
  const c = await caches.open(MODEL_CACHE);
  const r = await c.match(MANIFEST_URL);
  return r ? r.json() : null;
}

export async function fetchManifest() {
  const r = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!r.ok) throw new Error(`manifest HTTP ${r.status}`);
  return r.json();
}

export async function missingParts(man) {
  const c = await caches.open(MODEL_CACHE);
  const out = [];
  for (const f of man.files) for (const p of f.parts) if (!(await c.match(partURL(man, p)))) out.push(p);
  return out;
}

// 빠진 조각만 받는다(이어 받기). 조각마다 크기·sha256 확인, 실패 시 조각당 3번까지 다시.
export async function downloadModel(man, onProgress) {
  const c = await caches.open(MODEL_CACHE);
  const all = man.files.flatMap(f => f.parts);
  let done = 0;
  for (const p of all) {
    const url = partURL(man, p), done0 = done;
    if (await c.match(url)) { done += p.size; onProgress(done, man.total); continue; }
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} ${p.path}`);
        // 받으면서 바로 저장소로 흘려 넣고, 갈라진 다른 쪽에서 크기·sha256 을 조금씩 계산 — 큰 버퍼를 만들지 않는다
        const [toCache, toHash] = r.body.tee();
        const saving = c.put(url, new Response(toCache, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(p.size) } }));
        const h = new Sha256(); let n = 0;
        for (const rd = toHash.getReader(); ;) {
          const { done, value } = await rd.read();
          if (done) break;
          h.update(value); n += value.length; onProgress(done0 + n, man.total);
        }
        await saving;
        if (n !== p.size || h.hex() !== p.sha256) { await c.delete(url); throw new Error(`검사값 불일치 ${p.path}`); }
        lastErr = null; break;
      } catch (e) {
        lastErr = e;
        await new Promise(res => setTimeout(res, 1500 * attempt));
      }
    }
    if (lastErr) throw lastErr;
    done += p.size; onProgress(done, man.total);
  }
  await c.put(MANIFEST_URL, new Response(JSON.stringify(man), { headers: { 'Content-Type': 'application/json' } }));
}

// transformers.js 의 env.customCache 규약(match/put)
export function modelCache(man) {
  const byURL = new Map(man.files.map(f => [fileURL(man, f), f]));
  return {
    async match(key) {
      const f = byURL.get(typeof key === 'string' ? key : key.url);
      if (!f) return undefined;
      const c = await caches.open(MODEL_CACHE);
      const blobs = [];
      for (const p of f.parts) {
        const r = await c.match(partURL(man, p));
        if (!r) return undefined;
        blobs.push(await r.blob());
      }
      return new Response(new Blob(blobs), { headers: { 'Content-Length': String(f.size) } });
    },
    async put() {},
  };
}

export async function deleteModel() {
  await caches.delete(MODEL_CACHE);
}
