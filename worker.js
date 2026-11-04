// 번역 일꾼: 모델을 기기 저장소에서만 읽고(원격 금지) 문장 단위로 번역한다.
import { env, pipeline } from './vendor/transformers.min.js';
import { BASE, cachedManifest, modelCache } from './models.js';
import { splitSentences } from './split.js';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('models/', BASE).href;
env.useBrowserCache = false;
env.useCustomCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('vendor/', BASE).href; // 기본값(jsdelivr CDN) 덮어쓰기
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

let translator = null;

// 엔진(wasm) 메모리 크기 읽기용 — 화면 아래 저장 줄과 메모리 시험에 쓴다
const wasmMems = [];
const OrigMemory = WebAssembly.Memory;
WebAssembly.Memory = function (...a) { const m = new OrigMemory(...a); wasmMems.push(m); return m; };
WebAssembly.Memory.prototype = OrigMemory.prototype;
for (const k of ['instantiate', 'instantiateStreaming']) {
  const orig = WebAssembly[k];
  WebAssembly[k] = async (...a) => {
    const r = await orig.apply(WebAssembly, a);
    for (const v of Object.values((r.instance || r).exports || {})) if (v instanceof OrigMemory) wasmMems.push(v);
    return r;
  };
}
const wasmBytes = () => [...new Set(wasmMems)].reduce((s, m) => s + m.buffer.byteLength, 0);

async function load() {
  const man = await cachedManifest();
  if (!man) throw new Error('저장된 모델이 없습니다');
  env.customCache = modelCache(man);
  const t0 = performance.now();
  translator = await pipeline('translation', man.model, {
    dtype: man.dtype, device: 'wasm',
    // 가중치는 외부 데이터로: wasm 힙에 모델 파일 사본이 생기지 않아 아이폰 메모리 최고치가 내려간다
    use_external_data_format: !!man.external,
  });
  return Math.round(performance.now() - t0);
}

async function translate({ id, text, src, tgt }) {
  const parts = splitSentences(text);
  let acc = '';
  for (const p of parts) {
    const s = p.text.trim();
    if (s) {
      const n = translator.tokenizer(s).input_ids.size;
      const [r] = await translator(s, { src_lang: src, tgt_lang: tgt, max_new_tokens: Math.min(400, Math.round(n * 2.5) + 16) });
      acc += (acc && !acc.endsWith('\n') ? ' ' : '') + r.translation_text;
    }
    if (p.nl) acc += '\n';
    self.postMessage({ type: 'partial', id, text: acc.replace(/\n$/, '') });
  }
  self.postMessage({ type: 'done', id, text: acc.replace(/\n$/, ''), wasm: wasmBytes() });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') self.postMessage({ type: 'ready', ms: await load(), wasm: wasmBytes() });
    else if (data.type === 'translate') await translate(data);
  } catch (e) {
    self.postMessage({ type: 'error', id: data.id, message: String(e && e.message || e) });
  }
};
