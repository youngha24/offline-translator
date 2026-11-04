# int8(동적) 와 q4(MatMulNBits, 임베딩은 int8) 만들기
import sys, onnx
from onnxruntime.quantization import quantize_dynamic, QuantType
W='/home/user/work/pruned/onnx'; mode=sys.argv[1]
for n in ['encoder_model', 'decoder_model_merged']:
    src=f'{W}/{n}.onnx'
    if mode=='int8':
        quantize_dynamic(src, f'{W}/{n}_quantized.onnx', weight_type=QuantType.QUInt8, per_channel=False, reduce_range=False,
                         op_types_to_quantize=['MatMul','Gather'], extra_options={'EnableSubgraph': True})
    else:
        from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
        m=onnx.load(src)
        q=MatMulNBitsQuantizer(m, block_size=32, is_symmetric=True, accuracy_level=None); q.process()
        tmp=f'{W}/{n}_q4tmp.onnx'; q.model.save_model_to_file(tmp, use_external_data_format=False)
        quantize_dynamic(tmp, f'{W}/{n}_q4.onnx', weight_type=QuantType.QUInt8, op_types_to_quantize=['Gather'], extra_options={'EnableSubgraph': True})
        import os; os.remove(tmp)
    print(n, 'done', flush=True)
