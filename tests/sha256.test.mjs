import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Sha256 } from '../sha256.js';
test('조각으로 넣어도 표준 SHA-256 과 같다', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 200003]) {
    const d = randomBytes(n), s = new Sha256();
    for (let i = 0; i < n; i += 7777) s.update(d.subarray(i, i + 7777));
    assert.equal(s.hex(), createHash('sha256').update(d).digest('hex'), `길이 ${n}`);
  }
});
