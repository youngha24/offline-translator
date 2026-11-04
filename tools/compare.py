# 원본 vs 축소(vs 양자화) 번역 비교: 탐욕 디코딩, 12개 방향
import sys, json, numpy as np, onnxruntime as ort
from tokenizers import Tokenizer
W = '/home/user/work'
S = {
 'kor_Hang': ['오늘 날씨가 정말 좋네요. 같이 산책하러 갈까요?', '이 근처에 약국이 어디 있는지 알려 주시겠어요?', '기차가 30분 늦게 도착한다고 합니다.'],
 'eng_Latn': ['Could you tell me where the nearest subway station is?', 'I would like to change my reservation to next Friday.'],
 'jpn_Jpan': ['すみません、この電車は東京駅に止まりますか。', '明日の会議は午後三時からです。'],
 'zho_Hans': ['请问这附近有没有便宜的饭店？', '我明天早上要去机场。'],
 'vie_Latn': ['Xin lỗi, nhà vệ sinh ở đâu ạ?', 'Tôi muốn đặt một phòng cho hai người.'],
 'khk_Cyrl': ['Сайн байна уу? Таны нэр хэн бэ?', 'Энэ автобус төв талбай руу явах уу?'],
 'spa_Latn': ['¿Dónde puedo comprar un billete de autobús?', 'Mi hermana vive en Madrid desde hace cinco años.'],
}
PAIRS = [(s, 'kor_Hang') for s in S if s != 'kor_Hang'] + [('kor_Hang', d) for d in S if d != 'kor_Hang']
class M:
    def __init__(s, d, enc, dec):
        o = ort.SessionOptions(); o.intra_op_num_threads = 8
        s.tok = Tokenizer.from_file(f'{d}/tokenizer.json')
        s.e = ort.InferenceSession(f'{d}/onnx/{enc}', o); s.d = ort.InferenceSession(f'{d}/onnx/{dec}', o)
        s.pk = [i.name for i in s.d.get_inputs() if i.name.startswith('past_key_values')]
    def tr(s, text, src, tgt, maxlen=96):
        ids = [s.tok.token_to_id(src)] + s.tok.encode(text, add_special_tokens=False).ids + [2]
        ii = np.array([ids], dtype=np.int64); am = np.ones_like(ii)
        h = s.e.run(None, {'input_ids': ii, 'attention_mask': am})[0]
        out = [2, s.tok.token_to_id(tgt)]; past = None
        for step in range(maxlen):
            feed = {'encoder_attention_mask': am, 'encoder_hidden_states': h}
            if past is None:
                feed['input_ids'] = np.array([out], dtype=np.int64); feed['use_cache_branch'] = np.array([False])
                for n in s.pk: feed[n] = np.zeros((1, 16, 0, 64), np.float32)
            else:
                feed['input_ids'] = np.array([[out[-1]]], dtype=np.int64); feed['use_cache_branch'] = np.array([True]); feed.update(past)
            r = s.d.run(None, feed); names = [o.name for o in s.d.get_outputs()]
            nxt = int(r[0][0, -1].argmax()); out.append(nxt)
            newp = {n.replace('present', 'past_key_values'): v for n, v in zip(names[1:], r[1:])}
            if past is not None:  # 교차주의 캐시는 첫 회 값 유지
                for k in newp:
                    if 'encoder' in k: newp[k] = past[k]
            past = newp
            if nxt == 2: break
        return s.tok.decode(out[2:], skip_special_tokens=True)
if __name__ == '__main__':
    specs = [a.split(':') for a in sys.argv[1:]]  # dir:enc:dec
    ms = [M(f'{W}/{d}', e, dd) for d, e, dd in specs]
    res = {}; same = 0; tot = 0
    for src, tgt in PAIRS:
        for text in S[src] if src != 'kor_Hang' else S['kor_Hang'][:2]:
            outs = [m.tr(text, src, tgt) for m in ms]
            tot += 1; same += all(o == outs[0] for o in outs[1:])
            print(f'[{src}->{tgt}] {text}'); [print('   ', i, o) for i, o in enumerate(outs)]
    print(f'SAME {same}/{tot}')
