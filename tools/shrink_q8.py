# int8 축소본을 더 줄인다(번역 결과는 compare.py 로 확인)
#  ① 디코더: 입력 임베딩(Gather)이 lm_head 의 int8 전치 가중치를 함께 쓴다(axis=1 Gather + Transpose) — 같은 행렬 사본 1개 제거
#  ② 인코더: 임베딩을 4bit 블록(32) 대칭 양자화 GatherBlockQuantized 로
# 사용: python3 tools/shrink_q8.py <입력 모델 폴더> <출력 모델 폴더>
import sys, os, shutil, numpy as np, onnx
from onnx import numpy_helper, helper, TensorProto
SRC, DST = sys.argv[1], sys.argv[2]
os.makedirs(f'{DST}/onnx', exist_ok=True)
for f in ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json']:
    shutil.copy(f'{SRC}/{f}', f'{DST}/{f}')

# ① 디코더
m = onnx.load(f'{SRC}/onnx/decoder_model_merged_quantized.onnx'); g = m.graph
I = {i.name: i for i in g.initializer}
A = lambda n: numpy_helper.to_array(I[n])
assert A('model.shared.weight_merged_0_scale') == A('lm_head.weight_t_scale') and A('model.shared.weight_merged_0_zero_point') == A('lm_head.weight_t_zero_point'), '척도/영점이 달라 공유 불가'
assert np.array_equal(A('model.shared.weight_merged_0_quantized').T, A('lm_head.weight_t_quantized')), 'int8 값이 달라 공유 불가'
def fix(sg):
    nodes = list(sg.node)
    for n in nodes:
        if n.op_type == 'Gather' and n.input[0] == 'model.shared.weight_merged_0_quantized':
            n.input[0] = 'lm_head.weight_t_quantized'
            n.attribute.append(helper.make_attribute('axis', 1))
            out = n.output[0]; mid = out + '_t'; n.output[0] = mid
            tr = helper.make_node('Transpose', [mid], [out], name=n.name + '_T', perm=[1, 2, 0])
            sg.node.insert(list(sg.node).index(n) + 1, tr)
        if n.op_type == 'DequantizeLinear' and n.input[1] == 'model.shared.weight_merged_0_scale':
            n.input[1] = 'lm_head.weight_t_scale'; n.input[2] = 'lm_head.weight_t_zero_point'
    for n in sg.node:
        for a in n.attribute:
            if a.g.node: fix(a.g)
fix(g)
for k in ['model.shared.weight_merged_0_quantized', 'model.shared.weight_merged_0_scale', 'model.shared.weight_merged_0_zero_point']:
    g.initializer.remove(I[k])
onnx.save(m, f'{DST}/onnx/decoder_model_merged_quantized.onnx'); del m

# ② 인코더 임베딩 4bit
m = onnx.load(f'{SRC}/onnx/encoder_model_quantized.onnx'); g = m.graph
I = {i.name: i for i in g.initializer}
q = numpy_helper.to_array(I['embed_tokens.weight_quantized']).astype(np.float32)
W = (q - float(numpy_helper.to_array(I['embed_tokens.weight_zero_point']))) * float(numpy_helper.to_array(I['embed_tokens.weight_scale']))
V, D = W.shape; B = 32
blk = W.reshape(V, D // B, B)
sc = np.abs(blk).max(-1) / 7.0; sc[sc == 0] = 1e-8
qi = np.clip(np.round(blk / sc[..., None]), -8, 7).astype(np.int8).reshape(V, D)
packed = ((qi[:, 0::2] & 0x0F) | ((qi[:, 1::2] & 0x0F) << 4)).astype(np.uint8)
data = helper.make_tensor('embed_tokens.weight_q4', TensorProto.INT4, [V, D], packed.tobytes(), raw=True)
scales = numpy_helper.from_array(sc.astype(np.float32), 'embed_tokens.weight_q4_scales')
for k in ['embed_tokens.weight_quantized', 'embed_tokens.weight_scale', 'embed_tokens.weight_zero_point']:
    g.initializer.remove(I[k])
g.initializer.extend([data, scales])
nodes = list(g.node)
gat = next(n for n in nodes if n.op_type == 'Gather' and n.input[0] == 'embed_tokens.weight_quantized')
deq = next(n for n in nodes if n.op_type == 'DequantizeLinear' and n.input[0] == gat.output[0])
gbq = helper.make_node('GatherBlockQuantized', ['embed_tokens.weight_q4', gat.input[1], 'embed_tokens.weight_q4_scales'], [deq.output[0]],
                       name='/embed_tokens/GatherBlockQuantized', domain='com.microsoft', gather_axis=0, quantize_axis=1, block_size=B)
idx = nodes.index(gat); g.node.remove(gat); g.node.remove(deq); g.node.insert(idx, gbq)
if not any(o.domain == 'com.microsoft' for o in m.opset_import): m.opset_import.append(helper.make_opsetid('com.microsoft', 1))
onnx.save(m, f'{DST}/onnx/encoder_model_quantized.onnx')
for f in ['encoder_model_quantized', 'decoder_model_merged_quantized']:
    print(f, os.path.getsize(f'{DST}/onnx/{f}.onnx'))
