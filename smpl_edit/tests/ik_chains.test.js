import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chainsFor, endEffectorChain, writeChainPositions } from '../ik_chains.js';

test('SMPL keeps four two-bone limb chains and a separate head chain', () => {
  const chains = chainsFor('smpl');
  assert.equal(chains.length, 5);
  for (const c of chains.filter(chain => chain.kind !== 'head')) {
    assert.equal(c.joints.length, 3);
    assert.equal(c.bodyIdx.length, 3);
    for (let i = 0; i < 3; i++) assert.equal(c.bodyIdx[i], c.joints[i] - 1);
  }
});

test('未知骨骼返回空数组(不抛错)', () => {
  assert.deepEqual(chainsFor('nope'), []);
});

test('resolveChains 按名字解析骨架索引与姿态序号;已解析数组原样返回', async () => {
  const { resolveChains } = await import('../ik_chains.js');
  const body = { jointNames: ['root', 'a', 'b', 'c'], poseJoints: [3, 1, 2] };
  const chains = resolveChains(body, [{ name: 'X', joints: ['a', 'b', 'c'] }, { name: 'Y', joints: ['a', 'zz', 'c'] }]);
  assert.deepEqual(chains, [{ name: 'X', joints: [1, 2, 3], bodyIdx: [1, 2, 0] }]);
  assert.equal(chainsFor(chains), chains);
  assert.equal(endEffectorChain(chains, 3).name, 'X');
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

test('head lookup uses the actual final chain joint', () => {
  const head = endEffectorChain('smpl', 15);
  assert.deepEqual(head.joints, [3, 6, 9, 12, 15]);
  assert.equal(endEffectorChain('smpl', 9), null);
});

test('chain guide uses the actual articulated world points through the solver joints', () => {
  const chain = endEffectorChain('smpl', 15);
  const joints = Float32Array.from({ length: 24 * 3 }, (_, i) => i);
  const positions = new Float32Array(chain.joints.length * 3);
  assert.equal(writeChainPositions(positions, chain, joints), true);
  assert.deepEqual([...positions], [9, 10, 11, 18, 19, 20, 27, 28, 29, 36, 37, 38, 45, 46, 47]);

  for (const index of chain.joints) joints[index * 3] += 5;
  assert.equal(writeChainPositions(positions, chain, joints), true);
  assert.deepEqual([...positions.filter((_, i) => i % 3 === 0)], [14, 23, 32, 41, 50]);
  assert.equal(writeChainPositions(positions, chain, joints.subarray(0, 46)), false);
  joints[29] = NaN;
  assert.equal(writeChainPositions(positions, chain, joints), false);
});
