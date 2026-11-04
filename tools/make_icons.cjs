// 아이콘 PNG 만들기 (180·192·512) — node tools/make_icons.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const s of [180, 192, 512]) {
    await p.setViewportSize({ width: s, height: s });
    await p.setContent(`<body style="margin:0"><div style="width:${s}px;height:${s}px;background:linear-gradient(135deg,#2f6bff,#1b3fae);display:flex;align-items:center;justify-content:center;font:700 ${s*0.36}px -apple-system,'Noto Sans CJK KR',sans-serif;color:#fff;letter-spacing:-${s*0.01}px">가<span style="font-size:${s*0.3}px;opacity:.85;margin-left:${s*0.02}px">A</span></div></body>`);
    await p.screenshot({ path: `${__dirname}/../icons/icon-${s}.png` });
  }
  await b.close();
})();
