# 말뭉치 안 쓴 줄(300000 이후)에서 원본/축소 토크나이저 분해가 같은 비율
import json, pyarrow.parquet as pq
from tokenizers import Tokenizer
W='/home/user/work'
a=Tokenizer.from_file(f'{W}/orig/tokenizer.json'); b=Tokenizer.from_file(f'{W}/pruned/tokenizer.json')
keep=json.load(open(f'{W}/pruned/keep_ids.json'))['keep_old_ids']
for p in ['ko','ja','zh','vi','es']:
    t=pq.read_table(f'{W}/corpus/en-{p}.parquet').column('translation').to_pylist()[300000:302000]
    for side in [p,'en']:
        L=[r[side] for r in t if r[side].strip()]
        same=sum([keep[i] for i in y.ids]==x.ids for x,y in zip(a.encode_batch(L,add_special_tokens=False),b.encode_batch(L,add_special_tokens=False)))
        print(p,side,f'{same}/{len(L)}')
w=pq.read_table(f'{W}/corpus/mn-wiki.parquet').column('text').to_pylist()
L=[l for d in w for l in d.split('\n') if len(l)>20][300000:302000]
same=sum([keep[i] for i in y.ids]==x.ids for x,y in zip(a.encode_batch(L,add_special_tokens=False),b.encode_batch(L,add_special_tokens=False)))
print('mn-wiki',f'{same}/{len(L)}')
