import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences } from '../split.js';
const texts = a => a.map(x => x.text);
test('라틴 문장: 부호 뒤 공백에서 자름, 소수점은 안 자름', () => {
  assert.deepEqual(texts(splitSentences('It costs 3.5 dollars. Is it ok? Yes!')), ['It costs 3.5 dollars.', ' Is it ok?', ' Yes!', '']);
});
test('한중일 부호는 공백 없이 자름 + 닫는 괄호 붙임', () => {
  assert.deepEqual(texts(splitSentences('明日です。「はい。」行く？')), ['明日です。', '「はい。」', '行く？', '']);
});
test('줄바꿈 유지', () => {
  const r = splitSentences('안녕하세요.\n\n좋네요');
  assert.deepEqual(r.map(x => [x.text, x.nl]), [['안녕하세요.', false], ['', true], ['', true], ['좋네요', true]]);
});
