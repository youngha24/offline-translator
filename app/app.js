// 화면 — 입력·언어·기록·대화 모드. 번역은 worker.js 가 기기 안에서 한다.
import { LANGS, byId, splitText, joinParts, fmtBytes } from "./text.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("ot_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("ot_" + k, JSON.stringify(v)); } catch (e) {} },
};

// ---- 일꾼 ----
const worker = window.__OT_WORKER__ ? window.__OT_WORKER__() : new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let ready = false, seq = 0;
const waiting = new Map();
worker.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === "progress") {
    $("prog").hidden = false; $("prog").max = m.total || 1; $("prog").value = m.loaded || 0;
    status(`모델 받는 중… ${fmtBytes(m.loaded)} / ${fmtBytes(m.total)} (화면을 켜 둔 채 기다려 주세요)`);
  } else if (m.type === "ready") {
    ready = true; store.set("model", true);
    $("setup").hidden = true; $("prog").hidden = true;
    status(navigator.onLine ? "✓ 번역 준비 완료 — 이제 인터넷 없이도 됩니다" : "✓ 오프라인 번역 중");
    run(); talkRun("me"); talkRun("them");
  } else if (m.type === "error" && !m.id) {   // 모델을 못 열었음(받다 끊김·아이폰이 저장 공간을 비움·메모리 부족)
    store.set("model", false); $("setup").hidden = false; $("getModel").disabled = false; $("prog").hidden = true;
    status("모델을 열지 못했습니다: " + m.message + (navigator.onLine ? " — «번역 모델 받기»로 다시 해 주세요" : " — 와이파이에서 다시 받아 주세요"), true);
  } else if (m.type === "result" || m.type === "error") {
    const w = waiting.get(m.id); if (!w) return;
    waiting.delete(m.id);
    m.type === "result" ? w.resolve(m) : w.reject(new Error(m.message));
  }
};
function ask(text, src, tgt) {
  const id = ++seq;
  return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); worker.postMessage({ type: "translate", id, text, src, tgt }); });
}
async function translate(text, src, tgt) {
  if (src === tgt) return { text, ms: 0 };
  const parts = splitText(text), outs = [];
  let ms = 0;
  for (const p of parts) {
    if (!p.text) { outs.push(""); continue; }
    const r = await ask(p.text, byId(src).nllb, byId(tgt).nllb);
    outs.push(r.text); ms += r.ms;
  }
  return { text: joinParts(parts, outs, tgt), ms };
}
function status(t, warn) { $("status").textContent = t; $("status").className = warn ? "warn" : ""; }
function startModel() {
  $("getModel").disabled = true;
  status("모델 준비 중…");
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});   // 아이폰이 저장 공간 정리 때 지우지 않게
  worker.postMessage({ type: "load" });
}

// ---- 번역 화면 ----
function fillSelect(sel, value, only) {
  sel.innerHTML = LANGS.filter((l) => !only || only(l)).map((l) => `<option value="${l.id}">${l.name}</option>`).join("");
  sel.value = value;
}
fillSelect($("src"), store.get("src", "ko"));
fillSelect($("tgt"), store.get("tgt", "en"));
$("input").value = store.get("draft", "");

let timer = null, runSeq = 0, last = null;
async function run() {
  const text = $("input").value.trim(), src = $("src").value, tgt = $("tgt").value;
  $("count").textContent = text ? text.length + "자" : "";
  store.set("draft", $("input").value);
  if (!text) { $("output").textContent = ""; $("took").textContent = ""; last = null; return; }
  if (!ready) { $("output").textContent = store.get("model", false) ? "모델 여는 중…" : "먼저 위 «번역 모델 받기»를 눌러 주세요"; $("output").className = "out pending"; return; }
  const my = ++runSeq;
  $("output").className = "out pending";
  try {
    const r = await translate(text, src, tgt);
    if (my !== runSeq) return;
    $("output").textContent = r.text; $("output").className = "out";
    $("took").textContent = `${(r.ms / 1000).toFixed(1)}초 · 기기 안에서 번역`;
    last = { src, tgt, from: text, to: r.text };
  } catch (e) {
    if (my !== runSeq) return;
    $("output").textContent = "번역하지 못했습니다: " + e.message; $("output").className = "out pending";
  }
}
const later = () => { clearTimeout(timer); timer = setTimeout(run, 700); };
$("input").addEventListener("input", later);
for (const id of ["src", "tgt"]) $(id).addEventListener("change", () => { store.set(id, $(id).value); run(); });
$("swap").onclick = () => {
  const s = $("src").value; $("src").value = $("tgt").value; $("tgt").value = s;
  if (last && last.to) $("input").value = last.to;
  store.set("src", $("src").value); store.set("tgt", $("tgt").value); run();
};
$("clear").onclick = () => { $("input").value = ""; run(); $("input").focus(); };
$("paste").onclick = async () => { try { $("input").value = await navigator.clipboard.readText(); run(); } catch (e) { $("input").focus(); } };
$("copy").onclick = async () => { try { await navigator.clipboard.writeText($("output").textContent); flash($("copy")); } catch (e) {} };
$("speak").onclick = () => speak($("output").textContent, $("tgt").value, $("speak"));
$("save").onclick = () => { if (!last) return; const h = store.get("history", []); h.unshift({ ...last, t: Date.now() }); store.set("history", h.slice(0, 50)); drawHistory(); flash($("save")); };
function flash(b) { const t = b.textContent; b.textContent = "✓"; setTimeout(() => (b.textContent = t), 900); }

function drawHistory() {
  const h = store.get("history", []);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  $("history").innerHTML = h.length ? "<h2>☆ 남긴 번역</h2>" + h.map((x, i) => `<div class="item" data-i="${i}"><small>${esc(byId(x.src).name)} → ${esc(byId(x.tgt).name)}</small><br>${esc(x.from)}<br><b>${esc(x.to)}</b></div>`).join("") : "";
}
$("history").addEventListener("click", (e) => {
  const it = e.target.closest(".item"); if (!it) return;
  const x = store.get("history", [])[+it.dataset.i]; if (!x) return;
  $("src").value = x.src; $("tgt").value = x.tgt; $("input").value = x.from; run(); window.scrollTo(0, 0);
});

// ---- 읽어 주기(아이폰에 그 언어 음성이 있을 때만 · 인터넷 불필요) ----
function voiceFor(lang) {
  const code = byId(lang).speech.toLowerCase(), base = code.split("-")[0];
  const vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  return vs.find((v) => v.lang.toLowerCase().replace("_", "-") === code) || vs.find((v) => v.lang.toLowerCase().startsWith(base));
}
function speak(text, lang, btn) {
  if (!text || !window.speechSynthesis) return;
  const v = voiceFor(lang);
  if (!v) { status(`이 아이폰에 «${byId(lang).name}» 음성이 없습니다 (설정 › 손쉬운 사용 › 읽기 및 말하기 › 음성에서 받을 수 있음)`, true); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.voice = v; u.lang = v.lang; u.rate = 0.95;
  speechSynthesis.speak(u); if (btn) flash(btn);
}

// ---- 대화 모드: 아래 = 나(한국어) · 위 = 상대(뒤집혀 보임) ----
fillSelect($("talkLang"), store.get("talk", "en"), (l) => l.id !== "ko");
const talkTimers = {};
function themLang() { return $("talkLang").value; }
function drawWho() { $("themWho").textContent = byId(themLang()).name; $("themIn").placeholder = { en: "Type here", ja: "ここに入力", zh: "在这里输入", vi: "Nhập ở đây", mn: "Энд бичнэ үү", es: "Escriba aquí" }[themLang()] || "…"; }
async function talkRun(who) {
  const inp = who === "me" ? $("meIn") : $("themIn"), outEl = who === "me" ? $("themOut") : $("meOut");
  const text = inp.value.trim(); if (!text || !ready) return;
  const [src, tgt] = who === "me" ? ["ko", themLang()] : [themLang(), "ko"];
  outEl.className = "out pending";
  try { const r = await translate(text, src, tgt); outEl.textContent = r.text; outEl.className = "out"; if (who === "me") outEl.dataset.say = r.text; }
  catch (e) { outEl.textContent = "번역 실패: " + e.message; }
}
for (const who of ["me", "them"]) $(who + "In").addEventListener("input", () => { clearTimeout(talkTimers[who]); talkTimers[who] = setTimeout(() => talkRun(who), 700); });
$("talkLang").onchange = () => { store.set("talk", themLang()); drawWho(); talkRun("me"); talkRun("them"); };
$("talkSpeak").onclick = () => speak($("themOut").textContent, themLang(), $("talkSpeak"));
function mode(talk) {
  document.body.classList.toggle("talking", talk);
  $("tabMain").setAttribute("aria-pressed", String(!talk)); $("tabTalk").setAttribute("aria-pressed", String(talk));
  store.set("mode", talk ? "talk" : "main");
}
$("tabMain").onclick = () => mode(false);
$("tabTalk").onclick = () => mode(true);
mode(store.get("mode", "main") === "talk"); drawWho();

// ---- 시작 ----
$("getModel").onclick = startModel;
drawHistory();
if (store.get("model", false)) { status("번역 모델 여는 중… (몇 초)"); startModel(); }
else { $("setup").hidden = false; status(navigator.onLine ? "처음 한 번 번역 모델을 받아야 합니다" : "인터넷이 없어 모델을 받을 수 없습니다 — 와이파이에서 열어 주세요", !navigator.onLine); }
addEventListener("offline", () => ready && status("✓ 오프라인 — 기기 안에서 번역 중"));
if ("serviceWorker" in navigator && !window.__OT_WORKER__) navigator.serviceWorker.register("sw.js").catch(() => {});
run();
