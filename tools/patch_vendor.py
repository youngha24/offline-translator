# transformers.min.js(3.8.1) 고침: 인코더·디코더 세션을 동시에(Promise.all) 말고 차례로 만든다
# → 모델 파일 사본이 메모리에 한꺼번에 겹치지 않음(아이폰 사파리 최고 메모리 절감). 두 번 실행해도 안전.
import sys, pathlib
p = pathlib.Path(__file__).resolve().parent.parent / 'vendor' / 'transformers.min.js'
s = p.read_text(encoding='utf-8')
if '/*ot-seq*/' in s: print('이미 적용됨'); sys.exit(0)
head = 'async function D(e,t,n){return Object.fromEntries(await Promise.all(Object.keys(t).map((async o=>{'
tail = 'return[o,await(0,s.createInferenceSession)(i,d,u)]}))))}'
assert s.count(head) == 1 and s.count(tail) == 1, '패턴을 못 찾음 — transformers.js 판이 바뀌었나 확인'
s = s.replace(head, 'async function D(e,t,n){/*ot-seq*/const __r=[];for(const __k of Object.keys(t))__r.push(await(async o=>{')
s = s.replace(tail, 'return[o,await(0,s.createInferenceSession)(i,d,u)]})(__k));return Object.fromEntries(__r)}')
# 2) 세션을 만든 뒤 외부 데이터(가중치) JS 버퍼를 GC 기다리지 않고 바로 해제(ArrayBuffer.transfer(0) — 사파리 17.4+, 없으면 그냥 GC)
u_old = 's.unmountExternalData=()=>{delete s.Eb}'
assert s.count(u_old) == 1, 'unmountExternalData 패턴을 못 찾음'
s = s.replace(u_old, 's.unmountExternalData=()=>{s.Eb&&s.Eb.forEach((v=>{try{v.buffer.transfer&&v.buffer.transfer(0)}catch(e){}}));delete s.Eb}')
p.write_text(s, encoding='utf-8'); print('적용')
