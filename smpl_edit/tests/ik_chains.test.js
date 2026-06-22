import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chainsFor, endEffectorChain } from '../ik_chains.js';

test('chainsFor(smpl) 返回 4 条链,各含三关节,bodyIdx = joints − 1', () => {
  const chains = chainsFor('smpl');
  assert.equal(chains.length, 4);
  for (const c of chains) {
    assert.equal(c.joints.length, 3);
    assert.equal(c.bodyIdx.length, 3);
    for (let i = 0; i < 3; i++) assert.equal(c.bodyIdx[i], c.joints[i] - 1);
  }
});

test('未知骨骼返回空数组(不抛错)', () => {
  assert.deepEqual(chainsFor('mhr'), []);
});

test('endEffectorChain 命中末端关节,返回其链', () => {
  const lWrist = endEffectorChain('smpl', 20);
  assert.ok(lWrist);
  assert.equal(lWrist.name, 'L_Arm');
  assert.deepEqual(lWrist.joints, [16, 18, 20]);
});

test('非末端关节返回 null', () => {
  assert.equal(endEffectorChain('smpl', 18), null);
  assert.equal(endEffectorChain('smpl', 0), null);
});

test('四个末端:L/R 腕(20,21)、L/R 踝(7,8)', () => {
  for (const j of [20, 21, 7, 8]) assert.ok(endEffectorChain('smpl', j), `joint ${j} 应是末端`);
});
