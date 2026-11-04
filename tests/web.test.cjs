// 아이폰 크기 화면 시험 — ① 가짜 일꾼으로 화면 흐름 ② 진짜 일꾼(모델 서버 막힘)으로 오류 처리 ③ 서비스워커로 비행기 모드 열림
const { chromium, devices } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "app");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  fs.readFile(path.join(ROOT, p), (e, b) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" }); s.end(b); }); });
let fails = 0; const ok = (c, n) => { console.log((c ? "ok " : "FAIL ") + n); if (!c) fails++; };
const FAKE = () => { window.__OT_WORKER__ = () => { const w = { onmessage: null, postMessage(m) {
  const send = (d) => setTimeout(() => w.onmessage({ data: d }), 20);
  if (m.type === "load") { send({ type: "progress", loaded: 5e8, total: 9e8 }); setTimeout(() => send({ type: "ready" }), 60); }
  if (m.type === "translate") send({ type: "result", id: m.id, text: `[${m.tgt}]${m.text}`, ms: 120 });
} }; return w; }; };
(async () => {
  await new Promise(r => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch();
  // ① 화면 흐름
  let ctx = await b.newContext({ ...devices["iPhone 14 Pro Max"] });
  let pg = await ctx.newPage(); const errs = []; pg.on("pageerror", e => errs.push(e.message));
  await pg.addInitScript(FAKE); await pg.goto(base);
  ok(await pg.isVisible("#getModel"), "처음엔 «모델 받기» 단추");
  await pg.fill("#input", "안녕하세요. 반갑습니다."); await pg.waitForTimeout(900);
  ok((await pg.textContent("#output")).includes("모델 받기"), "모델 없으면 안내");
  await pg.click("#getModel"); await pg.waitForSelector("#setup", { state: "hidden" });
  await pg.waitForFunction(() => document.querySelector("#output").textContent.includes("[eng_Latn]"));
  ok(await pg.textContent("#output") === "[eng_Latn]안녕하세요. [eng_Latn]반갑습니다.", "문장별 번역·잇기");
  await pg.selectOption("#tgt", "mn"); await pg.waitForFunction(() => document.querySelector("#output").textContent.includes("khk_Cyrl"));
  ok(true, "몽골어(khk_Cyrl) 선택");
  await pg.click("#save"); ok((await pg.textContent("#history")).includes("안녕하세요"), "☆ 기록 남기기");
  await pg.click("#swap"); ok(await pg.inputValue("#src") === "mn" && (await pg.inputValue("#input")).includes("khk_Cyrl"), "⇄ 바꾸기(번역문이 입력으로)");
  const over = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); ok(!over, "가로 넘침 없음(430px)");
  await pg.screenshot({ path: path.join(__dirname, "shot_main.png") });
  await pg.click("#tabTalk"); await pg.fill("#meIn", "화장실이 어디예요?"); await pg.waitForTimeout(900);
  ok((await pg.textContent("#themOut")).startsWith("[eng_Latn]"), "대화: 나 → 상대 언어");
  await pg.fill("#themIn", "Over there"); await pg.waitForTimeout(900);
  ok((await pg.textContent("#meOut")) === "[kor_Hang]Over there", "대화: 상대 → 한국어");
  ok(await pg.evaluate(() => getComputedStyle(document.querySelector(".side.them")).transform !== "none"), "대화: 상대 쪽 화면 뒤집힘");
  await pg.screenshot({ path: path.join(__dirname, "shot_talk.png") });
  await pg.reload(); ok(await pg.isVisible("#talk") && !(await pg.isVisible("#getModel")), "다시 열면 모드·모델 기억");
  ok(errs.length === 0, "자바스크립트 오류 없음 " + errs.join(" | "));
  await ctx.close();
  // ② 진짜 일꾼 — 모델 서버(huggingface)를 막아 오류 처리 확인
  ctx = await b.newContext({ ...devices["iPhone 14 Pro Max"], serviceWorkers: "block" });
  await ctx.route(/huggingface\.co/, r => r.abort());
  pg = await ctx.newPage(); const errs2 = []; pg.on("pageerror", e => errs2.push(e.message));
  await pg.goto(base); await pg.click("#getModel");
  await pg.waitForFunction(() => document.querySelector("#status").textContent.includes("열지 못했습니다"), null, { timeout: 30000 }).catch(() => {});
  const st = await pg.textContent("#status"); ok(st.includes("열지 못했습니다") && await pg.isEnabled("#getModel"), "모델 못 받으면 원인·다시 받기 (" + st.slice(0, 60) + ")");
  ok(errs2.length === 0, "진짜 일꾼: 엔진 파일 불러오기 오류 없음 " + errs2.join(" | "));
  await ctx.close();
  // ③ 비행기 모드: 서비스워커가 화면·엔진을 보관
  ctx = await b.newContext({ ...devices["iPhone 14 Pro Max"] });
  pg = await ctx.newPage(); await pg.goto(base);
  await pg.waitForFunction(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; }, null, { timeout: 30000 });
  const cached = await pg.evaluate(async () => { const c = await caches.open("ot-shell-2"); return (await c.keys()).length; });
  ok(cached >= 12, "보관 파일 " + cached + "개(화면·엔진 21MB 포함)");
  await ctx.setOffline(true); await pg.reload();
  ok(await pg.isVisible("#src") && (await pg.textContent("#status")).length > 0, "비행기 모드에서 앱 열림");
  const wasm = await pg.evaluate(async () => (await fetch("vendor/ort-wasm-simd-threaded.jsep.wasm")).headers.get("content-length") || (await (await fetch("vendor/ort-wasm-simd-threaded.jsep.wasm")).arrayBuffer()).byteLength);
  ok(Number(wasm) > 2e7, "비행기 모드에서 번역 엔진 파일 열림");
  await b.close(); srv.close();
  console.log(fails ? `실패 ${fails}` : "전부 통과"); process.exit(fails ? 1 : 0);
})();
