# ONNX 가중치를 외부 데이터(<이름>.onnx_data)로 분리 — 브라우저 wasm 힙에 모델 파일 사본이 안 생기게
# 사용: python3 tools/to_external.py <모델 폴더> <접미사 예: _quantized>
import sys, os, onnx
D, SUF = sys.argv[1], sys.argv[2]
for n in ['encoder_model', 'decoder_model_merged']:
    f = f'{D}/onnx/{n}{SUF}.onnx'; loc = f'{n}{SUF}.onnx_data'
    m = onnx.load(f)
    if os.path.exists(f'{D}/onnx/{loc}'): os.remove(f'{D}/onnx/{loc}')
    onnx.save_model(m, f, save_as_external_data=True, all_tensors_to_one_file=True, location=loc, size_threshold=1024)
    print(n, os.path.getsize(f), os.path.getsize(f'{D}/onnx/{loc}'))
