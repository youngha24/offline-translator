# NLLB-600M 을 7개 언어용으로 낱말표 축소 (fp32 ONNX + 토크나이저)
import json, sys, numpy as np, onnx
from onnx import numpy_helper, helper
W = '/home/user/work'; OUT = f'{W}/pruned'; TH = int(sys.argv[1]) if len(sys.argv) > 1 else 3
import os; os.makedirs(f'{OUT}/onnx', exist_ok=True)
LANGS = ['kor_Hang', 'eng_Latn', 'jpn_Jpan', 'zho_Hans', 'zho_Hant', 'vie_Latn', 'khk_Cyrl', 'spa_Latn']
t = json.load(open(f'{W}/orig/tokenizer.json'))
vocab = t['model']['vocab']; id2tok = {i: s for s, i in vocab.items()}
merges = [m.split(' ', 1) if isinstance(m, str) else m for m in t['model']['merges']]
counts = np.load(f'{W}/counts.npy')
keep = {0, 1, 2, 3}
keep |= {i for i in range(len(counts)) if counts[i] >= TH and i in id2tok}
keep |= {i for s, i in vocab.items() if len(s) == 1}
added = {a['content']: a['id'] for a in t['added_tokens']}
keep |= {added[l] for l in LANGS}
# BPE 닫힘: 남긴 조각을 만드는 merge 의 양쪽 조각도 남긴다
by_result = {}
for a, b in merges: by_result.setdefault(a + b, []).append((a, b))
stack = [id2tok[i] for i in keep if i in id2tok]; seen = set(stack)
while stack:
    s = stack.pop()
    for a, b in by_result.get(s, []):
        for p in (a, b):
            if p in vocab and p not in seen:
                seen.add(p); stack.append(p); keep.add(vocab[p])
keep = sorted(keep); OLDV = 256206
assert keep[:4] == [0, 1, 2, 3]
newid = {o: n for n, o in enumerate(keep)}; NV = len(keep)
print('vocab', OLDV, '->', NV)
# 토크나이저
t['model']['vocab'] = {s: newid[i] for s, i in vocab.items() if i in newid}
nv = t['model']['vocab']
t['model']['merges'] = [f'{a} {b}' for a, b in merges if a in nv and b in nv and (a + b) in nv]
t['added_tokens'] = [dict(a, id=newid[a['id']]) for a in t['added_tokens'] if a['id'] in newid]
for v in t['post_processor']['special_tokens'].values(): v['ids'] = [newid[i] for i in v['ids']]
json.dump(t, open(f'{OUT}/tokenizer.json', 'w'), ensure_ascii=False)
tc = json.load(open(f'{W}/orig/tokenizer_config.json'))
if 'added_tokens_decoder' in tc: tc['added_tokens_decoder'] = {str(newid[int(k)]): v for k, v in tc['added_tokens_decoder'].items() if int(k) in newid}
tc.pop('mask_token', None)
json.dump(tc, open(f'{OUT}/tokenizer_config.json', 'w'), ensure_ascii=False, indent=1)
sm = json.load(open(f'{W}/orig/special_tokens_map.json'))
sm['additional_special_tokens'] = LANGS; sm.pop('mask_token', None)
json.dump(sm, open(f'{OUT}/special_tokens_map.json', 'w'), ensure_ascii=False, indent=1)
cfg = json.load(open(f'{W}/orig/config.json')); cfg['vocab_size'] = NV
json.dump(cfg, open(f'{OUT}/config.json', 'w'), indent=1)
open(f'{OUT}/generation_config.json', 'w').write(open(f'{W}/orig/generation_config.json').read())
json.dump({'keep_old_ids': keep}, open(f'{OUT}/keep_ids.json', 'w'))
idx = np.array(keep)
def fix_dims(g):
    for vi in list(g.output) + list(g.value_info):
        for d in vi.type.tensor_type.shape.dim:
            if d.dim_value == OLDV: d.dim_value = NV
def check_consts(g):
    for i in g.initializer:
        if i.data_type in (6, 7) and numpy_helper.to_array(i).size < 10 and OLDV in numpy_helper.to_array(i).ravel().tolist(): raise SystemExit('const ' + i.name)
    for n in g.node:
        for a in n.attribute:
            if a.t.dims == [] and a.t.data_type in (6, 7) and OLDV in numpy_helper.to_array(a.t).ravel().tolist(): raise SystemExit('const ' + n.name)
            if a.g.node: check_consts(a.g)
# 인코더
m = onnx.load(f'{W}/orig/onnx/encoder_model.onnx'); g = m.graph
for i in g.initializer:
    if i.name == 'embed_tokens.weight':
        i.CopyFrom(numpy_helper.from_array(numpy_helper.to_array(i)[idx], i.name))
fix_dims(g); check_consts(g)
onnx.save(m, f'{OUT}/onnx/encoder_model.onnx'); del m
# 디코더(merged): 공유 임베딩 자르기 + lm_head 는 미리 전치한 별도 가중치(양자화 가능하게)
m = onnx.load(f'{W}/orig/onnx/decoder_model_merged.onnx'); g = m.graph
for i in g.initializer:
    if i.name == 'model.shared.weight_merged_0':
        w = numpy_helper.to_array(i)[idx]
        i.CopyFrom(numpy_helper.from_array(w, i.name))
g.initializer.append(numpy_helper.from_array(np.ascontiguousarray(w.T), 'lm_head.weight_t'))
def fix_sub(sg):
    tr = [n for n in sg.node if n.op_type == 'Transpose' and list(n.input) == ['model.shared.weight_merged_0']]
    for n in tr:
        out = n.output[0]; sg.node.remove(n)
        for k in sg.node:
            for j, x in enumerate(k.input):
                if x == out: k.input[j] = 'lm_head.weight_t'
    fix_dims(sg)
    for n in sg.node:
        for a in n.attribute:
            if a.g.node: fix_sub(a.g)
fix_sub(g); check_consts(g)
onnx.save(m, f'{OUT}/onnx/decoder_model_merged.onnx')
print('ok')
