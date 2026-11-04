# 7개 언어 말뭉치에서 NLLB 토큰 사용 빈도를 센다 → counts.npy
import sys, numpy as np, pyarrow.parquet as pq
from tokenizers import Tokenizer
W = '/home/user/work'
tok = Tokenizer.from_file(f'{W}/orig/tokenizer.json')
V = tok.get_vocab_size(with_added_tokens=True)
counts = np.zeros(V, dtype=np.int64)
CAP = int(sys.argv[1]) if len(sys.argv) > 1 else 300000
def feed(lines, tag):
    lines = [l for l in lines if l and l.strip()]
    for i in range(0, len(lines), 5000):
        for e in tok.encode_batch(lines[i:i+5000], add_special_tokens=False):
            np.add.at(counts, e.ids, 1)
    print(tag, len(lines), flush=True)
for p in ['ko', 'ja', 'zh', 'vi', 'mn', 'es']:
    t = pq.read_table(f'{W}/corpus/en-{p}.parquet').column('translation').to_pylist()[:CAP]
    feed([r[p] for r in t], p); feed([r['en'] for r in t[:CAP // 6]], 'en/' + p)
wiki = pq.read_table(f'{W}/corpus/mn-wiki.parquet').column('text').to_pylist()
mn = [l for doc in wiki for l in doc.split('\n') if len(l) > 20][:CAP]
feed(mn, 'mn-wiki')
np.save(f'{W}/counts.npy', counts)
for th in [1, 2, 3, 5, 10, 20]:
    print('count>=', th, int((counts >= th).sum()))
