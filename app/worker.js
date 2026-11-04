// 번역 일꾼 — 화면이 멈추지 않게 모델은 여기서만 돈다. 밖으로 보내는 것은 없다(모델 파일을 처음 한 번 받는 것만).
import { pipeline, env } from "./vendor/transformers.min.js";

const MODEL = "Xenova/nllb-200-distilled-600M";   // 200개 언어 · 몽골어(khk_Cyrl) 포함
env.allowLocalModels = false;
env.useBrowserCache = true;                        // 받은 모델은 기기(Cache Storage)에 남아 다음부터 인터넷 없이
env.backends.onnx.wasm.wasmPaths = new URL("./vendor/", self.location.href).href;
env.backends.onnx.wasm.numThreads = 1;             // GitHub Pages 는 교차 출처 격리가 없어 단일 스레드

let translator = null, loading = null;
const latest = {};                                 // 칸(번역·대화 나·대화 상대)마다 가장 새 요청 번호
const queue = [];                                  // 모델은 한 번에 한 문장만(동시에 돌리면 엔진이 꼬임)
let busy = false;

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
  }).then(async (t) => {
    translator = t;
    try { await t("안녕", { src_lang: "kor_Hang", tgt_lang: "eng_Latn", max_new_tokens: 8 }); } catch (e) {}   // 예열: 첫 번역이 느리지 않게
    self.postMessage({ type: "ready" });
    return t;
  }).catch((e) => { loading = null; throw e; });
  return loading;
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const m = queue.shift();
    if ((m.gen || 0) < (latest[m.ch] || 0)) { self.postMessage({ type: "skip", id: m.id }); continue; }   // 사용자가 글을 고쳐 쓸모없어진 요청
    try {
      const t = await load();
      const started = performance.now();
      const out = await t(m.text, { src_lang: m.src, tgt_lang: m.tgt, max_new_tokens: Math.min(400, 24 + Math.ceil(m.text.length * 2.5)) });
      self.postMessage({ type: "result", id: m.id, text: (out[0] && out[0].translation_text) || "", ms: Math.round(performance.now() - started) });
    } catch (e) {
      self.postMessage({ type: "error", id: m.id, message: String((e && e.message) || e) });
    }
  }
  busy = false;
}

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === "load") { load().catch((e) => self.postMessage({ type: "error", message: String((e && e.message) || e) })); return; }
  if (m.type === "cancel") { latest[m.ch] = Math.max(latest[m.ch] || 0, m.gen || 0); return; }
  if (m.type === "translate") { latest[m.ch] = Math.max(latest[m.ch] || 0, m.gen || 0); queue.push(m); pump(); }
};
