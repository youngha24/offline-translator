# 모델 파일을 40MB 조각으로 나누고 models/manifest.json 을 쓴다 (GitHub 한 파일 100MB 한도)
# 사용: python3 tools/split_model.py <축소모델 폴더> <q8|q4>
import hashlib, json, os, shutil, sys
SRC, DTYPE = sys.argv[1], sys.argv[2]
SUF = {'q8': '_quantized', 'q4': '_q4'}[DTYPE]
ROOT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), '..', 'models'); NAME = 'nllb-7'
OUT = os.path.join(ROOT, NAME); PART = 40 * 1024 * 1024
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(f'{OUT}/onnx')
files = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json',
         f'onnx/encoder_model{SUF}.onnx', f'onnx/decoder_model_merged{SUF}.onnx']
for x in list(files):  # 외부 데이터 파일이 있으면 함께
    if os.path.exists(os.path.join(SRC, x + '_data')): files.append(x + '_data')
man = {'model': NAME, 'dtype': DTYPE, 'external': any(f.endswith('_data') for f in files), 'files': []}
for f in files:
    data = open(os.path.join(SRC, f), 'rb').read(); parts = []
    for k in range(0, max(len(data), 1), PART):
        b = data[k:k + PART]; pn = f'{f}.part{len(parts):02d}'
        open(os.path.join(OUT, pn), 'wb').write(b)
        parts.append({'path': pn, 'size': len(b), 'sha256': hashlib.sha256(b).hexdigest()})
    man['files'].append({'path': f, 'size': len(data), 'parts': parts})
man['total'] = sum(x['size'] for x in man['files'])
man['version'] = hashlib.sha256(json.dumps(man['files']).encode()).hexdigest()[:12]
json.dump(man, open(os.path.join(ROOT, 'manifest.json'), 'w'), indent=1)
print(NAME, DTYPE, man['total'], 'bytes', sum(len(x['parts']) for x in man['files']), 'parts', man['version'])
