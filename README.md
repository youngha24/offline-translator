# 오프라인 번역 (아이폰 홈 화면용 PWA)

한국어 ↔ 영어 · 일본어 · 중국어(간체) · 베트남어 · 몽골어 · 스페인어 글자 번역.
처음 한 번만 번역 모델(475MB)을 받아 기기에 저장하고, 그 뒤에는 **인터넷 없이** 아이폰 안에서 번역합니다.
입력한 글은 기기 밖으로 나가지 않습니다. 외부 연결은 서비스워커와 CSP 가 차단하고, 분석·오류 수집 SDK 는 없습니다.

## 아이폰에 설치 (처음 1회)
1. 사파리에서 앱 주소(GitHub Pages: `https://youngha24.github.io/offline-translator/`)를 엽니다.
2. **와이파이에서** «모델 받기»를 누릅니다(약 475MB, 1~3분). 끊기면 «이어 받기»로 받은 조각부터 다시 받습니다.
3. 공유 › **홈 화면에 추가**. 이후에는 비행기 모드에서도 홈 화면 아이콘으로 엽니다.
   - 사파리 탭보다 홈 화면 앱으로 쓰는 쪽이 저장 공간이 덜 지워집니다(앱이 «지워지지 않게 고정»을 요청합니다).

## 무인 운행
- 실행에 PC·서버·클라우드가 필요 없습니다. GitHub Pages(정적 파일)에서 한 번 받으면 아이폰 혼자 동작합니다.
- 앱 파일은 서비스워커가, 모델은 Cache Storage 가 기기에 저장합니다. 앱을 고치면 `sw.js` 의 `VERSION` 을 올려야 기기에 새 판이 들어갑니다(다음 실행 때 자동 교체).
- 푸시할 때마다 Actions `test` 가 단위시험·모델 조각 검사·화면/오프라인/메모리 시험을 돌립니다.

## 모델
Meta **NLLB-200 distilled 600M**(CC-BY-NC 4.0, 비상업)을 이 앱용으로 줄인 판입니다.

| 판 | 크기 | 브라우저 wasm 메모리 | 렌더러 최고(크롬, 매일 사용) | 번역 속도 |
|---|---|---|---|---|
| 원본 int8 (Xenova) | 869MB | — | — | — |
| 낱말표 축소 int8 | 576MB | 1,225MB | 1,927MB | 1.4~2.5초/문장 |
| 축소 4bit(MatMulNBits) | 422MB | — | 1,769MB | 8~16초/문장(wasm 느림 → 탈락) |
| **채택: 축소 int8 + 임베딩 공유·4bit + 외부 데이터** | **475MB** | **617MB** | **1,223MB** | **1.4~2.5초/문장** |

- 낱말표: 256,206 → 75,622개(7개 언어 말뭉치 opus-100·몽골어 위키백과에서 3회 이상 쓰인 조각 + 모든 한 글자 조각 + BPE 중간 조각).
  fp32 비교에서 원본과 **24/24 문장 동일**, 시험에 안 쓴 22,000줄 토큰 분해 98~99.9% 동일(나머지는 드문 낱말이 더 잘게 나뉠 뿐 unk 없음).
- 아이폰 사파리 기준: WebKit 의 WebContent 연성 한도 약 1.5GB(넘으면 메모리 압박 때 강제 종료), 아이폰 기기군 경성 한도 2,048MB 보고.
  그래서 시험 기준을 «크롬 렌더러 최고 1,300MB · wasm 700MB 미만»으로 잡았습니다(`tests/mem.cjs`).
- 메모리 절감 고침(재현: `tools/patch_vendor.py`): transformers.js 가 인코더·디코더를 동시에 만들던 것을 차례로,
  세션 생성 뒤 가중치 JS 버퍼 즉시 해제. 모델 받기는 스트리밍 저장 + 조금씩 SHA-256(받기 최고 291MB).

### 모델 다시 만들기 (Linux · Python 3 · `pip install onnx onnxruntime onnx_ir tokenizers pyarrow numpy`)
작업 폴더 `/home/user/work`(스크립트 안 경로)에 `Xenova/nllb-200-distilled-600M` 의 fp32 ONNX·토크나이저와 opus-100 말뭉치를 받은 뒤:
```bash
python3 tools/count_tokens.py 300000
```
```bash
python3 tools/prune.py 3
```
```bash
python3 tools/quant.py int8
```
```bash
python3 tools/shrink_q8.py /home/user/work/pruned /home/user/work/shrunk
```
```bash
python3 tools/to_external.py /home/user/work/shrunk _quantized
```
```bash
python3 tools/split_model.py /home/user/work/shrunk q8
```
```bash
python3 tools/verify_models.py
```
번역 비교: `tools/compare.py`, 토큰 분해 비교: `tools/tokcheck.py`.

## 시험
```bash
node --test tests/split.test.mjs tests/sha256.test.mjs
```
```bash
node tests/e2e.cjs models main
```
```bash
node tests/mem.cjs models main
```
- `e2e.cjs`: 아이폰 14 Pro Max 화면 · 깨진 조각 거부(3회 재시도)·이어 받기 · 13개 방향 번역 · 외부 요청 0건 · 외부 fetch 차단 ·
  **비행기 모드**(서버 끄고 오프라인 → 다시 열기 · 새로 실행 · 번역) · 아이폰 SE 화면 넘침 없음 · 누름 크기 44px.
- `mem.cjs`: 받아 둔 상태에서 새로 열기 → 불러오기 + 번역 3건의 렌더러·wasm 최고 메모리(기준 넘으면 실패).
- 실기기(아이폰) 시험은 이 저장소 밖에서 해야 합니다. 시험은 크롬(Playwright)으로 아이폰 화면을 흉내 낸 것입니다.

## 파일
`index.html` 화면 · `app.js` 화면 동작·받기 · `models.js` 모델 조각 저장/읽기 · `worker.js` 번역 일꾼 · `split.js` 문장 나누기 ·
`sha256.js` 조금씩 SHA-256 · `sw.js` 오프라인·외부 차단 · `vendor/` transformers.js 3.8.1(Apache-2.0, 고침 적용) · ONNX Runtime Web(MIT) ·
`models/` 모델 조각(40MB, GitHub 한 파일 100MB 한도) · `tools/` 만들기·검사 · `tests/` 시험.

## 라이선스
- 모델: NLLB-200 — CC-BY-NC 4.0(`models/LICENSE-NLLB.txt`). **비상업 용도만.**
- transformers.js — Apache-2.0(`vendor/LICENSE-transformers.txt`) · ONNX Runtime — MIT(`vendor/LICENSE-onnxruntime.txt`).
