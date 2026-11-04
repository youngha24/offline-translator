// 화면 — 입력·언어·기록·대화 모드. 번역은 worker.js 가 기기 안에서 한다.
import { LANGS, byId, splitText, joinParts, fmtBytes, detectLang } from "./text.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("ot_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("ot_" + k, JSON.stringify(v)); } catch (e) {} },
};

// ---- 번역 기억: 같은 문장은 모델을 다시 돌리지 않고 바로(기기 안 · 최근 400개) ----
const memo = new Map(store.get("memo", []));
let memoTimer = null;
function remember(key, val) {
  memo.delete(key); memo.set(key, val);
  while (memo.size > 400) memo.delete(memo.keys().next().value);
  clearTimeout(memoTimer); memoTimer = setTimeout(() => store.set("memo", [...memo]), 1500);
}

// ---- 일꾼 ----
const worker = window.__OT_WORKER__ ? window.__OT_WORKER__() : new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let ready = false, seq = 0;
const waiting = new Map(), gens = { main: 0, me: 0, them: 0 };
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
  } else if (m.type === "result" || m.type === "error" || m.type === "skip") {
    const w = waiting.get(m.id); if (!w) return;
    waiting.delete(m.id);
    m.type === "result" ? w.resolve(m) : m.type === "skip" ? w.resolve(null) : w.reject(new Error(m.message));
  }
};
function ask(ch, gen, text, src, tgt) {
  const id = ++seq;
  return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); worker.postMessage({ type: "translate", id, ch, gen, text, src, tgt }); });
}
// 문장마다 번역해 끝나는 대로 보여 준다(onPart). 새 글이 들어오면(gen 이 바뀌면) 남은 문장은 버린다.
async function translate(ch, text, src, tgt, onPart) {
  const gen = ++gens[ch];
  worker.postMessage({ type: "cancel", ch, gen });
  if (src === tgt) { onPart && onPart(text); return { text, ms: 0 }; }
  const parts = splitText(text), outs = parts.map(() => ""), started = performance.now();
  let fresh = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.text) continue;
    const key = src + ">" + tgt + ":" + p.text;
    if (memo.has(key)) { outs[i] = memo.get(key); }
    else {
      const r = await ask(ch, gen, p.text, byId(src).nllb, byId(tgt).nllb);
      if (r === null || gen !== gens[ch]) return null;   // 더 새 글이 왔음
      outs[i] = r.text; remember(key, r.text); fresh++;
    }
    if (gen !== gens[ch]) return null;
    onPart && onPart(joinParts(parts.slice(0, i + 1), outs.slice(0, i + 1), tgt), i + 1 < parts.length);
  }
  return { text: joinParts(parts, outs, tgt), ms: Math.round(performance.now() - started), cached: fresh === 0 };
}
function status(t, warn) { $("status").textContent = t; $("status").className = warn ? "warn" : ""; }
function startModel() {
  $("getModel").disabled = true;
  status("모델 준비 중…");
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});   // 아이폰이 저장 공간 정리 때 지우지 않게
  worker.postMessage({ type: "load" });
}

// ---- 번역 화면 ----
function fillSelect(sel, value, filter, extra) {
  sel.innerHTML = (extra || "") + LANGS.filter((l) => !filter || filter(l)).map((l) => `<option value="${l.id}">${l.name}</option>`).join("");
  sel.value = value;
}
fillSelect($("src"), store.get("src", "auto"), null, '<option value="auto">자동 감지</option>');
fillSelect($("tgt"), store.get("tgt", "en"));
$("input").value = store.get("draft", "");
let lastForeign = store.get("foreign", $("tgt").value === "ko" ? "en" : $("tgt").value);

// 실제로 쓸 언어 쌍. 자동 감지: 한국어면 → 고른 외국어, 외국어면 → 한국어.
function pair(text) {
  let src = $("src").value, tgt = $("tgt").value, guessed = null;
  if (src === "auto") {
    guessed = detectLang(text) || "en";
    src = guessed;
    tgt = src === "ko" ? (tgt === "ko" ? lastForeign : tgt) : "ko";
  }
  return { src, tgt, guessed };
}

let timer = null, last = null;
async function run() {
  const text = $("input").value.trim();
  $("count").textContent = text ? text.length + "자" : "";
  store.set("draft", $("input").value);
  if (!text) { gens.main++; $("output").textContent = ""; $("took").textContent = ""; $("detected").textContent = ""; last = null; return; }
  const { src, tgt, guessed } = pair(text);
  $("detected").textContent = guessed ? `· 감지: ${byId(src).name.split(" ")[0]} → ${byId(tgt).name.split(" ")[0]}` : "";
  if (!ready) { $("output").textContent = store.get("model", false) ? "모델 여는 중…" : "먼저 위 «번역 모델 받기»를 눌러 주세요"; $("output").className = "out pending"; return; }
  $("output").className = "out pending";
  $("took").textContent = "번역 중…";
  try {
    const r = await translate("main", text, src, tgt, (partial, more) => { $("output").textContent = partial + (more ? " …" : ""); });
    if (!r) return;
    $("output").textContent = r.text; $("output").className = "out";
    $("took").textContent = r.cached ? "기억해 둔 번역" : `${(r.ms / 1000).toFixed(1)}초 · 기기 안에서 번역`;
    last = { src, tgt, from: text, to: r.text };
  } catch (e) {
    $("output").textContent = "번역하지 못했습니다: " + e.message; $("output").className = "out pending"; $("took").textContent = "";
  }
}
const later = (ms) => { clearTimeout(timer); timer = setTimeout(run, ms); };
// 문장을 끝맺으면(. ? ! 。 줄바꿈) 바로, 쓰는 중이면 0.6초 쉬면 번역
$("input").addEventListener("input", () => later(/[.!?。！？\n]\s*$/.test($("input").value) ? 80 : 600));
$("src").addEventListener("change", () => { store.set("src", $("src").value); run(); });
$("tgt").addEventListener("change", () => { store.set("tgt", $("tgt").value); if ($("tgt").value !== "ko") { lastForeign = $("tgt").value; store.set("foreign", lastForeign); } run(); });
$("swap").onclick = () => {
  const cur = last || pair($("input").value.trim());
  $("src").value = cur.tgt; $("tgt").value = cur.src;
  if (last && last.to) $("input").value = last.to;
  if ($("tgt").value !== "ko") { lastForeign = $("tgt").value; store.set("foreign", lastForeign); }
  store.set("src", $("src").value); store.set("tgt", $("tgt").value); run();
};
$("clear").onclick = () => { $("input").value = ""; run(); $("input").focus(); };
$("paste").onclick = async () => { try { $("input").value = await navigator.clipboard.readText(); run(); } catch (e) { $("input").focus(); } };
$("copy").onclick = async () => { try { await navigator.clipboard.writeText($("output").textContent); flash($("copy")); } catch (e) {} };
$("output").onclick = () => $("copy").click();   // 번역문을 누르면 복사
$("share").onclick = async () => { const t = $("output").textContent; if (!t) return; try { if (navigator.share) await navigator.share({ text: t }); else { await navigator.clipboard.writeText(t); flash($("share")); } } catch (e) {} };
$("speak").onclick = () => speak($("output").textContent, last ? last.tgt : $("tgt").value, $("speak"));
$("save").onclick = () => { if (!last) return; const h = store.get("history", []); h.unshift({ ...last, t: Date.now() }); store.set("history", h.slice(0, 100)); drawHistory(); flash($("save")); };
function flash(b) { const t = b.textContent; b.textContent = "✓"; setTimeout(() => (b.textContent = t), 900); }

function drawHistory() {
  const h = store.get("history", []);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  $("history").innerHTML = h.length ? `<h2>☆ 남긴 번역 <button class="clearall" id="clearAll">모두 지우기</button></h2>` + h.map((x, i) => `<div class="item" data-i="${i}"><button class="del" data-del="${i}" aria-label="지우기">×</button><small>${esc(byId(x.src).name)} → ${esc(byId(x.tgt).name)}</small><br>${esc(x.from)}<br><b>${esc(x.to)}</b></div>`).join("") : "";
}
$("history").addEventListener("click", (e) => {
  const h = store.get("history", []);
  if (e.target.id === "clearAll") { if (confirm("남긴 번역을 모두 지울까요?")) { store.set("history", []); drawHistory(); } return; }
  if (e.target.dataset.del != null) { h.splice(+e.target.dataset.del, 1); store.set("history", h); drawHistory(); return; }
  const it = e.target.closest(".item"); if (!it) return;
  const x = h[+it.dataset.i]; if (!x) return;
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
let talkAuto = store.get("talkAuto", false);
function themLang() { return $("talkLang").value; }
function drawWho() {
  $("themWho").textContent = byId(themLang()).name;
  $("themIn").placeholder = { en: "Type here", ja: "ここに入力", zh: "在这里输入", vi: "Nhập ở đây", mn: "Энд бичнэ үү", es: "Escriba aquí" }[themLang()] || "…";
  $("talkAuto").setAttribute("aria-pressed", String(talkAuto));
}
async function talkRun(who) {
  const inp = who === "me" ? $("meIn") : $("themIn"), outEl = who === "me" ? $("themOut") : $("meOut");
  const text = inp.value.trim(); if (!text || !ready) return;
  const [src, tgt] = who === "me" ? ["ko", themLang()] : [themLang(), "ko"];
  outEl.className = "out pending";
  try {
    const r = await translate(who, text, src, tgt, (partial, more) => { outEl.textContent = partial + (more ? " …" : ""); });
    if (!r) return;
    outEl.textContent = r.text; outEl.className = "out";
    if (talkAuto) speak(r.text, tgt);
  } catch (e) { outEl.textContent = "번역 실패: " + e.message; }
}
for (const who of ["me", "them"]) $(who + "In").addEventListener("input", () => {
  clearTimeout(talkTimers[who]);
  talkTimers[who] = setTimeout(() => talkRun(who), /[.!?。！？\n]\s*$/.test($(who + "In").value) ? 80 : 700);
});
$("talkLang").onchange = () => { store.set("talk", themLang()); drawWho(); talkRun("me"); talkRun("them"); };
$("talkSpeak").onclick = () => speak($("themOut").textContent, themLang(), $("talkSpeak"));
$("talkAuto").onclick = () => { talkAuto = !talkAuto; store.set("talkAuto", talkAuto); drawWho(); };
$("talkClear").onclick = () => { $("meIn").value = $("themIn").value = ""; $("meOut").textContent = $("themOut").textContent = ""; gens.me++; gens.them++; };
function mode(talk) {
  document.body.classList.toggle("talking", talk);
  $("tabMain").setAttribute("aria-pressed", String(!talk)); $("tabTalk").setAttribute("aria-pressed", String(talk));
  store.set("mode", talk ? "talk" : "main");
}
$("tabMain").onclick = () => mode(false);
$("tabTalk").onclick = () => mode(true);
mode(store.get("mode", "main") === "talk"); drawWho();

// ---- 글자 크기 ----
function size(big) { document.body.classList.toggle("big", big); $("size").setAttribute("aria-pressed", String(big)); store.set("big", big); }
$("size").onclick = () => size(!document.body.classList.contains("big"));
size(store.get("big", false));

// ---- 시작 ----
$("getModel").onclick = startModel;
drawHistory();
if (store.get("model", false)) { status("번역 모델 여는 중… (몇 초)"); startModel(); }
else { $("setup").hidden = false; status(navigator.onLine ? "처음 한 번 번역 모델을 받아야 합니다" : "인터넷이 없어 모델을 받을 수 없습니다 — 와이파이에서 열어 주세요", !navigator.onLine); }
addEventListener("offline", () => ready && status("✓ 오프라인 — 기기 안에서 번역 중"));
if ("serviceWorker" in navigator && !window.__OT_WORKER__) navigator.serviceWorker.register("sw.js").catch(() => {});
run();
