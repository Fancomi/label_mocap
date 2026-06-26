import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COCO17, getSkeleton } from '../src/skeleton.js';

test('COCO17 有 17 个关节，名称不重复', () => {
  assert.equal(COCO17.names.length, 17);
  assert.equal(new Set(COCO17.names).size, 17);
});

test('flip_idx 长度 = 关节数，且为合法置换', () => {
  assert.equal(COCO17.flip_idx.length, 17);
  const sorted = [...COCO17.flip_idx].sort((a, b) => a - b);
  assert.deepEqual(sorted, Array.from({ length: 17 }, (_, i) => i));
});

test('flip_idx 对称：flip(flip(i)) === i', () => {
  COCO17.flip_idx.forEach((j, i) => assert.equal(COCO17.flip_idx[j], i));
});

test('edges 索引合法（0..16）', () => {
  for (const [a, b] of COCO17.edges) {
    assert.ok(a >= 0 && a < 17 && b >= 0 && b < 17, `bad edge ${a},${b}`);
  }
});

test('layout 覆盖全部关节，坐标归一化到 [0,1]', () => {
  assert.equal(COCO17.layout.length, 17);
  for (const p of COCO17.layout) {
    assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, `bad layout ${p.name}`);
    assert.ok(COCO17.names.includes(p.name), `unknown joint ${p.name}`);
  }
});

test('getSkeleton 默认返回 COCO17', () => {
  assert.equal(getSkeleton('coco17'), COCO17);
  assert.equal(getSkeleton(), COCO17);
});
