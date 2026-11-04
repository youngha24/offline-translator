// 번역 일꾼 — 화면이 멈추지 않게 모델은 여기서만 돈다. 밖으로 보내는 것은 없다(모델 파일을 처음 한 번 받는 것만).
import { pipeline, env } from "./vendor/transformers.min.js";

const MODEL = "Xenova/nllb-200-distilled-600M";   // 200개 언어 · 몽골어(khk_Cyrl) 포함
env.allowLocalModels = false;
env.useBrowserCache = true;                        // 받은 모델은 기기(Cache Storage)에 남아 다음부터 인터넷 없이
env.backends.onnx.wasm.wasmPaths = new URL("./vendor/", self.location.href).href;
env.backends.onnx.wasm.numThreads = 1;             // GitHub Pages 는 교차 출처 격리가 없어 단일 스레드

let translator = null, loading = null;

function load() {
  if (translator) return Promise.resolve(translator);
  if (loading) return loading;
  const files = {};
  loading = pipeline("translation", MODEL, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p) => {
      if (p.status === "progress" && p.file) {
        files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
        let loaded = 0, total = 0;
        for (const f of Object.values(files)) { loaded += f.loaded; total += f.total; }
        self.postMessage({ type: "progress", loaded, total, file: p.file });
      }
    },
  }).then((t) => { translator = t; self.postMessage({ type: "ready" }); return t; })
    .catch((e) => { loading = null; throw e; });
  return loading;
}

self.onmessage = async (ev) => {
  const m = ev.data || {};
  try {
    if (m.type === "load") { await load(); return; }
    if (m.type === "translate") {
      const t = await load();
      const started = performance.now();
      const out = await t(m.text, { src_lang: m.src, tgt_lang: m.tgt, max_new_tokens: Math.min(512, 32 + m.text.length * 3) });
      self.postMessage({ type: "result", id: m.id, text: (out[0] && out[0].translation_text) || "", ms: Math.round(performance.now() - started) });
    }
  } catch (e) {
    self.postMessage({ type: "error", id: m.id, message: String((e && e.message) || e) });
  }
};
