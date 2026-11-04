// 메모리 시험: 모델을 받아 둔 상태에서 앱을 새로 열고(아이폰에서 매일 쓰는 경우) 불러오기+번역 3건의 렌더러 최고 메모리
// 사용: node tests/mem.cjs [models 폴더] [이름]
const { chromium, devices } = require('playwright');
const { spawn, execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const MODELS = process.argv[2] || path.join(ROOT, 'models');
const LABEL = process.argv[3] || 'main';
const PORT = 8900 + Math.floor(Math.random() * 100), URL0 = `http://127.0.0.1:${PORT}/`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rss = () => { try { return execSync("ps -eo rss=,args= | grep -- '--type=renderer' | grep -v grep", { encoding: 'utf8' }).trim().split('\n').map(l => parseInt(l, 10) * 1024).filter(Boolean); } catch { return []; } };
const MB = b => Math.round(b / 1048576);

(async () => {
  const srv = spawn('python3', [path.join(ROOT, 'tools/serve.py'), String(PORT), MODELS], { stdio: 'ignore' });
  await sleep(800);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-mem-'));
  const dev = { ...devices['iPhone 14 Pro Max'] };
  // 1) 받기(측정 안 함)
  let ctx = await chromium.launchPersistentContext(dir, dev);
  let page = await ctx.newPage(); await page.goto(URL0);
  await page.waitForSelector('#dl:not([disabled])'); await page.waitForFunction(() => /MB/.test(document.getElementById('setupInfo').textContent));
  let dlPeak = 0, firstDayPeak = 0, seenReload = false;
  const t1 = setInterval(() => { const m = Math.max(0, ...rss()); firstDayPeak = Math.max(firstDayPeak, m); if (!seenReload) dlPeak = Math.max(dlPeak, m); }, 100);
  page.on('framenavigated', () => { seenReload = true; });
  await page.click('#dl');
  for (let i = 0; i < 2000; i++) { try { if (await page.evaluate(() => document.body.dataset.ready === '1')) break; } catch {} await sleep(300); }
  clearInterval(t1);
  await ctx.close();
  // 2) 새로 열기 → 불러오기 → 번역 3건 (측정)
  ctx = await chromium.launchPersistentContext(dir, dev);
  const base = Math.max(0, ...rss());
  let peak = 0; const tm = setInterval(() => { peak = Math.max(peak, ...rss()); }, 100);
  page = await ctx.newPage(); const t0 = Date.now(); await page.goto(URL0);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || /오류/.test(document.body.innerText), null, { timeout: 600000 });
  const loadMs = Date.now() - t0; const wasmLoad = await page.evaluate(() => +document.body.dataset.wasm); const status = await page.textContent('#status');
  await sleep(500); const afterLoad = Math.max(0, ...rss()); const peakLoad = peak;
  const outs = [];
  for (const [s, t, x] of [['kor_Hang', 'eng_Latn', '오늘 날씨가 정말 좋네요. 같이 산책하러 갈까요?'], ['eng_Latn', 'kor_Hang', 'I would like to change my reservation to next Friday.'], ['jpn_Jpan', 'kor_Hang', 'すみません、この電車は東京駅に止まりますか。']]) {
    await page.selectOption('#src', s); await page.selectOption('#tgt', t); await page.fill('#input', x); await page.click('#go');
    await page.waitForFunction(() => /^번역 [\d.]+초|오류/.test(document.getElementById('status').textContent), null, { timeout: 180000 });
    outs.push(`${await page.textContent('#output')} [${await page.textContent('#status')}]`);
  }
  await sleep(300); clearInterval(tm); const wasmAll = await page.evaluate(() => +document.body.dataset.wasm);
  const r = { label: LABEL, status, loadMs, peakLoadMB: MB(peakLoad), afterLoadMB: MB(afterLoad), peakAllMB: MB(peak), browserBaseMB: MB(base), downloadPeakMB: MB(dlPeak), firstDayPeakMB: MB(firstDayPeak), wasmAfterLoadMB: MB(wasmLoad), wasmAfterAllMB: MB(wasmAll), outs };
  // 기준: 아이폰 사파리 WebContent 연성 한도 약 1.5GB(WebKit) 보다 여유 있게 — 크롬 렌더러 최고 1,300MB · wasm 700MB 미만
  r.pass = r.peakAllMB < 1300 && r.downloadPeakMB < 1000 && r.wasmAfterAllMB < 700 && /준비됨/.test(status) && outs.every(o => /번역 [\d.]+초/.test(o));
  console.log(JSON.stringify(r, null, 1)); process.exitCode = r.pass ? 0 : 1;
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', `mem-${LABEL}.json`), JSON.stringify(r, null, 1));
  await ctx.close(); srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(2); });
