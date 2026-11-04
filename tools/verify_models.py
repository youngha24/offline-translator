# models/manifest.json 과 조각 파일(크기·sha256)이 맞는지 확인 — CI 와 올리기 전에 실행
import hashlib, json, os, sys
R = os.path.join(os.path.dirname(__file__), '..', 'models')
man = json.load(open(os.path.join(R, 'manifest.json'))); bad = 0
for f in man['files']:
    assert sum(p['size'] for p in f['parts']) == f['size'], f['path']
    for p in f['parts']:
        fp = os.path.join(R, man['model'], p['path'])
        d = open(fp, 'rb').read() if os.path.exists(fp) else b''
        if len(d) != p['size'] or hashlib.sha256(d).hexdigest() != p['sha256']:
            print('불일치', p['path']); bad += 1
        if len(d) >= 100 * 1024 * 1024: print('100MB 초과', p['path']); bad += 1
assert man['total'] == sum(f['size'] for f in man['files'])
print('조각', sum(len(f['parts']) for f in man['files']), '개', '정상' if not bad else f'{bad}건 오류', man['version'])
sys.exit(1 if bad else 0)
