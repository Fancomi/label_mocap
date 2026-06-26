import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hitKeypoint, hitBboxCorner, hitPerson } from '../src/hit_test.js';

const person = (id, bbox, kpts) => ({ id, bbox, keypoints: kpts });
const K = (overrides) => { const a = Array.from({ length: 17 }, () => [0, 0, 0]); Object.assign(a, overrides); return a; };

test('hitKeypoint：返回半径内最近的可见关节索引', () => {
  const p = person(1, null, K({ 0: [50, 50, 2], 5: [52, 52, 2] }));
  assert.equal(hitKeypoint(p, [51, 51], 5), 5);  // 52,52 更近
  assert.equal(hitKeypoint(p, [50, 50], 5), 0);
});

test('hitKeypoint：跳过 v=0 关节；超出半径返回 -1', () => {
  const p = person(1, null, K({ 3: [10, 10, 0], 4: [200, 200, 2] }));
  assert.equal(hitKeypoint(p, [10, 10], 5), -1);
});

test('hitBboxCorner：命中四角之一', () => {
  const p = person(1, [10, 10, 100, 100], K());
  assert.equal(hitBboxCorner(p, [10, 10], 6), 'tl');
  assert.equal(hitBboxCorner(p, [110, 110], 6), 'br');
  assert.equal(hitBboxCorner(p, [60, 60], 6), null);  // 中心不命中角
});

test('hitBboxCorner：无框返回 null', () => {
  assert.equal(hitBboxCorner(person(1, null, K()), [0, 0], 6), null);
});

test('hitPerson：点击落在某人框内或近其关键点 → 该人 id；多人取最近', () => {
  const ps = [
    person(1, [0, 0, 100, 100], K()),
    person(2, null, K({ 0: [300, 300, 2] })),
  ];
  assert.equal(hitPerson(ps, [50, 50], 10), 1);     // 框内
  assert.equal(hitPerson(ps, [301, 301], 10), 2);   // 近关键点
  assert.equal(hitPerson(ps, [900, 900], 10), null);
});
