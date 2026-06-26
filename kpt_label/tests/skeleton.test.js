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

test('order 为合法置换，且深度优先（同侧连续、眼后接同侧耳）', () => {
  assert.equal(COCO17.order.length, 17);
  assert.deepEqual([...COCO17.order].sort((a, b) => a - b), Array.from({ length: 17 }, (_, i) => i));
  const pos = (i) => COCO17.order.indexOf(i);
  // 左眼(1) 紧接 左耳(3)，而非右眼(2)
  assert.equal(COCO17.order[pos(1) + 1], 3);
  // 左臂 肩(5)→肘(7)→腕(9) 连续递进
  assert.ok(pos(5) < pos(7) && pos(7) < pos(9));
  // 左臂整体先于右臂
  assert.ok(pos(9) < pos(6));
  // 左腿 髋(11)→膝(13)→踝(15) 连续，且先于右腿
  assert.ok(pos(11) < pos(13) && pos(13) < pos(15) && pos(15) < pos(12));
});
