import assert from 'node:assert/strict';
import { test } from 'node:test';
import { turbo, normalizeRange } from '../src/scene/colormap.js';

test('turbo returns rgb in [0,1] and is monotonic-ish at ends', () => {
  const lo = turbo(0), hi = turbo(1);
  for (const c of [...lo, ...hi]) assert.ok(c >= 0 && c <= 1);
  assert.ok(lo[2] > lo[0]);
  assert.ok(hi[0] > hi[2]);
});

test('normalizeRange clamps to [0,1] with given lo/hi', () => {
  assert.equal(normalizeRange(5, 0, 10), 0.5);
  assert.equal(normalizeRange(-3, 0, 10), 0);
  assert.equal(normalizeRange(99, 0, 10), 1);
  assert.equal(normalizeRange(5, 5, 5), 0);
});
