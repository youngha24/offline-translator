// 전체 시험: 아이폰 화면 · 처음 받기 · 번역 7개 언어 · 메모리 최고치 · 외부 요청 0 · 비행기 모드(서버 끔 + 오프라인)
// 사용: node tests/e2e.cjs [models 폴더] [이름]   (결과: tests/out/<이름>.json, 스크린샷 tests/out/*.png)
const { chromium, devices } = require('playwright');
const { spawn, execSync } = require('child_process');
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const MODELS = process.argv[2] || path.join(ROOT, 'models');
const LABEL = process.argv[3] || 'main';
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 8800 + Math.floor(Math.random() * 100);
const URL0 = `http://127.0.0.1:${PORT}/`;

const CASES = [
  ['kor_Hang', 'eng_Latn', '이 근처에 약국이 어디 있는지 알려 주시겠어요?', /pharmacy/i],
  ['eng_Latn', 'kor_Hang', 'Could you tell me where the nearest subway station is?', /지하철/],
  ['jpn_Jpan', 'kor_Hang', '明日の会議は午後三時からです。', /회의/],
  ['zho_Hans', 'kor_Hang', '我明天早上要去机场。', /공항/],
  ['vie_Latn', 'kor_Hang', 'Xin lỗi, nhà vệ sinh ở đâu ạ?', /화장실/],
  ['khk_Cyrl', 'kor_Hang', 'Сайн байна уу? Таны нэр хэн бэ?', /이름/],
  ['spa_Latn', 'kor_Hang', '¿Dónde puedo comprar un billete de autobús?', /버스/],
  ['kor_Hang', 'jpn_Jpan', '오늘 날씨가 정말 좋네요.', /天気/],
  ['kor_Hang', 'zho_Hans', '오늘 날씨가 정말 좋네요.', /天气/],
  ['kor_Hang', 'vie_Latn', '오늘 날씨가 정말 좋네요.', /thời tiết/i],
  ['kor_Hang', 'khk_Cyrl', '오늘 날씨가 정말 좋네요.', /[А-Яа-яӨөҮү]/],
  ['kor_Hang', 'spa_Latn', '오늘 날씨가 정말 좋네요.', /(tiempo|día|dia)/i],
  ['kor_Hang', 'eng_Latn', '안녕하세요. 만나서 반갑습니다.\n내일 다시 연락드릴게요.', /\n/],
];

function serve() {
  const p = spawn('python3', [path.join(ROOT, 'tools/serve.py'), String(PORT), MODELS], { stdio: 'ignore' });
  return p;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 새로 고침(받기 완료 뒤)으로 문맥이 바뀌어도 준비될 때까지 기다린다
async function waitReady(page, timeout = 600000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      await page.waitForFunction(() => document.body.dataset.ready === '1' || /오류|실패/.test(document.body.innerText), null, { timeout: Math.max(1000, end - Date.now()) });
      return;
    } catch (e) { if (!/destroyed|navigat|Target closed/i.test(String(e))) throw e; await sleep(300); }
  }
  throw new Error('준비 시간 초과');
}

// 렌더러(화면+번역 일꾼) 프로세스 메모리 표본
function rendererRss() {
  try {
    return execSync("ps -eo rss=,args= | grep -- '--type=renderer' | grep -v grep", { encoding: 'utf8' })
      .trim().split('\n').map(l => parseInt(l.trim().split(/\s+/)[0], 10) * 1024).filter(Boolean);
  } catch { return []; }
}
function sampler() {
  const s = { peak: 0, peakSum: 0, last: 0, t: null };
  s.t = setInterval(() => { const r = rendererRss(); const m = Math.max(0, ...r); const sum = r.reduce((a, b) => a + b, 0);
    s.peak = Math.max(s.peak, m); s.peakSum = Math.max(s.peakSum, sum); s.last = m; }, 150);
  return s;
}

async function translate(page, src, tgt, text) {
  await page.selectOption('#src', src); await page.selectOption('#tgt', tgt);
  await page.fill('#input', text);
  const t0 = Date.now();
  await page.click('#go');
  await page.waitForFunction(() => /^번역 [\d.]+초/.test(document.getElementById('status').textContent) || /오류/.test(document.getElementById('status').textContent), null, { timeout: 180000 });
  const status = await page.textContent('#status');
  if (/오류/.test(status)) throw new Error(status);
  return { out: await page.textContent('#output'), ms: Date.now() - t0 };
}

async function layoutCheck(page, name) {
  return page.evaluate(name => {
    const vw = innerWidth, over = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width && el.offsetParent !== null && (r.right > vw + 0.5 || r.left < -0.5)) over.push(el.tagName + '#' + el.id);
    }
    const small = [...document.querySelectorAll('button, select')].filter(b => b.offsetParent !== null && b.getBoundingClientRect().height < 44).map(b => b.id);
    return { name, vw, scrollW: document.documentElement.scrollWidth, over, small };
  }, name);
}

(async () => {
  const res = { label: LABEL, models: MODELS, checks: [], translations: [] };
  const ok = (name, pass, detail = '') => { res.checks.push({ name, pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, detail); };
  let srv = serve(); await sleep(800);
  const man = JSON.parse(fs.readFileSync(path.join(MODELS, 'manifest.json')));
  res.modelBytes = man.total; res.dtype = man.dtype;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14 Pro Max'] });
  const reqs = []; ctx.on('request', r => reqs.push(r.url()));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const shot = n => page.screenshot({ path: path.join(OUT, `${LABEL}-${n}.png`) });

  // 1) 첫 실행: 받기 화면
  await page.goto(URL0);
  await page.waitForSelector('#setup:not([hidden])');
  await page.waitForFunction(() => /MB/.test(document.getElementById('setupInfo').textContent));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready, null, { timeout: 10000 });
  await shot('1-setup');
  ok('첫 화면 = 모델 받기', true, await page.textContent('#setupInfo'));
  res.checks.push(await layoutCheck(page, 'setup'));

  // 2-0) 깨진 조각이 오면: 3번 다시 받아도 깨짐 → «받기 실패» + 이어 받기 단추 (받은 조각은 남음)
  const BAD = '**/models/nllb-7/onnx/encoder_model_quantized.onnx_data.part01';
  let badHits = 0;
  await ctx.route(BAD, async route => { badHits++; const r = await route.fetch(); const b = await r.body(); b[1000] ^= 0xff; await route.fulfill({ response: r, body: b }); });
  await page.click('#dl');
  await page.waitForFunction(() => /받기 실패/.test(document.getElementById('dlText').textContent), null, { timeout: 300000 });
  const failText = await page.textContent('#dlText');
  ok('깨진 조각 거부(검사값)', /검사값 불일치/.test(failText) && badHits === 3, `${failText} · 시도 ${badHits}회`);
  ok('이어 받기 단추', /이어 받기/.test(await page.textContent('#dl')));
  await ctx.unroute(BAD);

  // 2) 이어 받기 → 불러오기 (메모리 표본)
  const mem = sampler(); const tDl = Date.now();
  await page.click('#dl');
  await page.waitForFunction(() => document.getElementById('dlBar').value > 0.3, null, { timeout: 300000 });
  await shot('2-downloading');
  await waitReady(page);
  res.downloadAndLoadMs = Date.now() - tDl;
  ok('받기 + 불러오기 완료', await page.evaluate(() => document.body.dataset.ready === '1'), await page.textContent('#status'));
  res.memAfterLoad = mem.last; res.memPeakLoad = mem.peak;

  // 3) 번역 13건
  for (const [s, t, text, re] of CASES) {
    const r = await translate(page, s, t, text);
    res.translations.push({ s, t, text, ...r });
    ok(`번역 ${s}→${t}`, re.test(r.out) && r.out.trim().length > 0, `${r.out.replace(/\n/g, '⏎')} (${r.ms}ms)`);
  }
  res.memPeakAll = mem.peak; res.memPeakSumAll = mem.peakSum;
  await shot('3-translated');
  res.checks.push(await layoutCheck(page, 'app'));

  // 4) 외부 요청 0 + 외부 fetch 차단 확인
  const ext = reqs.filter(u => !u.startsWith(URL0) && !u.startsWith('data:') && !u.startsWith('blob:'));
  ok('외부 요청 0건', ext.length === 0, ext.slice(0, 5).join(' '));
  const blocked = await page.evaluate(async () => { try { await fetch('https://example.com/'); return false; } catch { return true; } });
  ok('외부 fetch 차단', blocked);

  // 5) 비행기 모드: 서버 끄고 오프라인 → 다시 열기 → 번역
  srv.kill(); await sleep(500);
  await ctx.setOffline(true);
  const tOff = Date.now();
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === '1' || /오류/.test(document.body.innerText), null, { timeout: 300000 });
  res.offlineLoadMs = Date.now() - tOff;
  ok('오프라인 다시 열기 → 모델 불러옴', await page.evaluate(() => document.body.dataset.ready === '1'), await page.textContent('#status'));
  ok('오프라인 표시', await page.isVisible('#net'));
  const off = await translate(page, 'kor_Hang', 'eng_Latn', '비행기 안에서도 번역이 됩니다.');
  ok('오프라인 번역', /plane|flight|airplane|aircraft/i.test(off.out), off.out);
  await shot('4-offline');
  // 새 탭(앱 새로 실행)도 오프라인으로
  const p2 = await ctx.newPage(); await p2.goto(URL0);
  await p2.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 300000 });
  ok('오프라인 새로 실행', true);
  await p2.close();

  // 6) 작은 아이폰(SE) 화면 배치
  const se = await browser.newContext({ ...devices['iPhone SE'], offline: false });
  const sp = await se.newPage(); srv = serve(); await sleep(800);
  await sp.goto(URL0); await sp.waitForSelector('#setup:not([hidden])');
  res.checks.push(await layoutCheck(sp, 'setup-SE'));
  await sp.screenshot({ path: path.join(OUT, `${LABEL}-5-se.png`) });
  srv.kill();

  clearInterval(mem.t);
  for (const c of res.checks.filter(c => c.vw)) {
    ok(`화면 넘침 없음 (${c.name} ${c.vw}px)`, c.scrollW <= c.vw && c.over.length === 0, c.over.join(','));
    ok(`누름 크기 44px 이상 (${c.name})`, c.small.length === 0, c.small.join(','));
  }
  ok('페이지 오류 없음', errs.length === 0, errs.join(' | '));
  const fails = res.checks.filter(c => c.pass === false);
  res.pass = fails.length === 0;
  console.log(`메모리: 불러온 뒤 ${(res.memAfterLoad / 1048576).toFixed(0)}MB · 최고 ${(res.memPeakAll / 1048576).toFixed(0)}MB (렌더러 합 최고 ${(res.memPeakSumAll / 1048576).toFixed(0)}MB)`);
  console.log(`결과: ${res.pass ? '전부 통과' : fails.length + '건 실패'}`);
  fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(res, null, 1));
  await browser.close();
  process.exit(res.pass ? 0 : 1);
})().catch(e => { console.error('시험 중단:', e); process.exit(2); });
