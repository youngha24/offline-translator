import { cachedManifest, fetchManifest, missingParts, downloadModel, deleteModel } from './models.js';

const LANGS = [
  ['kor_Hang', '한국어'], ['eng_Latn', '영어'], ['jpn_Jpan', '일본어'], ['zho_Hans', '중국어(간체)'],
  ['vie_Latn', '베트남어'], ['khk_Cyrl', '몽골어'], ['spa_Latn', '스페인어'],
];
const $ = id => document.getElementById(id);
const el = { setup: $('setup'), app: $('app'), dl: $('dl'), dlBox: $('dlBox'), dlBar: $('dlBar'), dlText: $('dlText'),
  setupInfo: $('setupInfo'), src: $('src'), tgt: $('tgt'), swap: $('swap'), input: $('input'), go: $('go'), clear: $('clear'),
  output: $('output'), copy: $('copy'), status: $('status'), store: $('store'), net: $('net'), reset: $('reset') };
const MB = b => `${Math.round(b / 1048576)}MB`;
const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
                set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));

function showNet() { el.net.hidden = navigator.onLine; }
addEventListener('online', showNet); addEventListener('offline', showNet); showNet();

for (const sel of [el.src, el.tgt]) for (const [code, name] of LANGS) sel.add(new Option(name, code));
el.src.value = store.get('src', 'kor_Hang'); el.tgt.value = store.get('tgt', 'eng_Latn');
function fixPair(changed) {
  if (el.src.value === el.tgt.value) {
    const other = changed === el.src ? el.tgt : el.src;
    other.value = changed.value === 'kor_Hang' ? 'eng_Latn' : 'kor_Hang';
  }
  store.set('src', el.src.value); store.set('tgt', el.tgt.value);
}
el.src.onchange = () => fixPair(el.src); el.tgt.onchange = () => fixPair(el.tgt);
el.swap.onclick = () => {
  [el.src.value, el.tgt.value] = [el.tgt.value, el.src.value]; fixPair(el.src);
  if (el.output.textContent && !busy) { el.input.value = el.output.textContent; el.output.textContent = ''; el.copy.disabled = true; }
};
el.clear.onclick = () => { el.input.value = ''; el.output.textContent = ''; el.copy.disabled = true; el.input.focus(); };
el.copy.onclick = async () => {
  try { await navigator.clipboard.writeText(el.output.textContent); el.status.textContent = '복사했습니다'; }
  catch { el.status.textContent = '복사하지 못했습니다'; }
};

async function showStorage() {
  try {
    const est = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const eng = document.body.dataset.wasm ? ` · 엔진 메모리 ${MB(+document.body.dataset.wasm)}` : '';
    el.store.textContent = `저장 사용 ${MB(est.usage)} / 가능 ${MB(est.quota)}${persisted ? ' · 지워지지 않게 고정됨' : ''}${eng}`;
  } catch { el.store.textContent = ''; }
}

// 번역 일꾼
let worker = null, ready = false, busy = false, seq = 0;
function startWorker() {
  worker = new Worker('worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') {
      ready = true; el.go.disabled = false;
      el.status.textContent = `준비됨 (불러오기 ${(data.ms / 1000).toFixed(1)}초)`;
      document.body.dataset.ready = '1'; document.body.dataset.wasm = data.wasm; showStorage();
    } else if (data.type === 'partial' && data.id === seq) {
      el.output.textContent = data.text;
    } else if (data.type === 'done' && data.id === seq) {
      busy = false; el.go.disabled = false; el.copy.disabled = !data.text; document.body.dataset.wasm = data.wasm;
      el.output.textContent = data.text;
      el.status.textContent = `번역 ${((performance.now() - t0) / 1000).toFixed(1)}초`;
    } else if (data.type === 'error') {
      busy = false; el.go.disabled = !ready;
      el.status.textContent = `오류: ${data.message}`;
    }
  };
  worker.onerror = e => { el.status.textContent = `일꾼 오류: ${e.message || '알 수 없음'} — 앱을 다시 열어 주세요`; };
  el.status.textContent = '모델 불러오는 중… (처음 몇 초 걸립니다)';
  worker.postMessage({ type: 'load' });
}
let t0 = 0;
el.go.onclick = () => {
  const text = el.input.value.trim();
  if (!text || !ready || busy) return;
  busy = true; el.go.disabled = true; el.copy.disabled = true; t0 = performance.now();
  el.output.innerHTML = '<span class="pending">번역 중…</span>';
  el.status.textContent = '';
  worker.postMessage({ type: 'translate', id: ++seq, text, src: el.src.value, tgt: el.tgt.value });
};
el.input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) el.go.click(); });

async function startDownload(man) {
  el.dl.disabled = true; el.dlBox.hidden = false;
  try { if (navigator.storage.persist) await navigator.storage.persist(); } catch {}
  try {
    const est = await navigator.storage.estimate();
    if (est.quota && est.quota - est.usage < man.total * 1.1) throw new Error(`저장 공간 부족(필요 ${MB(man.total)}, 남음 ${MB(est.quota - est.usage)})`);
    await downloadModel(man, (d, t) => { el.dlBar.value = d / t; el.dlText.textContent = `${MB(d)} / ${MB(t)}`; });
    // 받기 때 쌓인 메모리를 비우고 불러오도록 새로 연다(아이폰 첫날 최고 메모리 낮추기)
    el.dlText.textContent = '받기 완료 — 앱을 다시 엽니다…';
    location.reload();
  } catch (e) {
    el.dl.disabled = false; el.dl.textContent = '이어 받기';
    el.dlText.textContent = `받기 실패: ${e.message} — 받은 조각은 저장돼 있으니 «이어 받기»를 누르세요`;
  }
}

el.reset.onclick = async () => {
  if (!confirm('저장된 번역 모델을 지울까요? 다시 쓰려면 인터넷에서 다시 받아야 합니다.')) return;
  worker?.terminate(); await deleteModel(); location.reload();
};

async function main() {
  let man = await cachedManifest();
  if (man && (await missingParts(man)).length === 0) {
    el.app.hidden = false; startWorker(); showStorage(); return;
  }
  el.setup.hidden = false;
  try { man = await fetchManifest(); }
  catch { el.setupInfo.textContent = '인터넷에 연결된 뒤 다시 열어 주세요. 처음 한 번은 모델을 받아야 합니다.'; el.dl.disabled = true; return; }
  const left = (await missingParts(man)).reduce((s, p) => s + p.size, 0);
  el.setupInfo.textContent = `번역 모델(${MB(man.total)})을 이 기기에 저장합니다. 받은 뒤에는 인터넷 없이 동작합니다. 와이파이에서 받으세요.`;
  if (left < man.total) el.dl.textContent = `이어 받기 (남은 ${MB(left)})`;
  el.dl.onclick = () => startDownload(man);
  showStorage();
}
main();
