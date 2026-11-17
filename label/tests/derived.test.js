import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reprojectKeypoints } from '../src/edit/derived.js';

const K = { fx: 1850, fy: 1850, cx: 960, cy: 540 };

test('reprojectKeypoints writes first 24 joints (x,y,conf=2), rest zero', () => {
  const joints = new Float32Array(24 * 3);
  for (let j = 0; j < 24; j++) { joints[j * 3] = 0; joints[j * 3 + 1] = 0; joints[j * 3 + 2] = -4; }
  const kps = reprojectKeypoints(joints, K, 52);
  assert.equal(kps.length, 52 * 3);
  assert.ok(Math.abs(kps[0] - 960) < 1e-6);
  assert.ok(Math.abs(kps[1] - 540) < 1e-6);
  assert.equal(kps[2], 2);
  assert.equal(kps[24 * 3], 0);
  assert.equal(kps[24 * 3 + 2], 0);
});

test('reprojectKeypoints marks behind-camera joints conf 0', () => {
  const joints = new Float32Array(24 * 3);
  joints[2] = 1; // joint 0 has z=+1 (behind)
  const kps = reprojectKeypoints(joints, K, 52);
  assert.equal(kps[2], 0);
});


test('reprojectKeypoints maps slot k to jointIdx[k] and accepts a project function', () => {
  const joints = new Float32Array(5 * 3);
  joints[4 * 3] = 7; joints[4 * 3 + 1] = 8; joints[4 * 3 + 2] = -1;
  const kps = reprojectKeypoints(joints, (X) => [X[0] * 10, X[1] * 10], 3, [4, 0]);
  assert.deepEqual(kps.slice(0, 3), [70, 80, 2]);
  assert.equal(kps.length, 9);
  assert.equal(kps[2 * 3 + 2], 0);   // 第 3 槽无关节
});

test('reprojectKeypoints: a null projection marks the slot invisible', () => {
  const kps = reprojectKeypoints(new Float32Array(3), () => null, 1, [0]);
  assert.deepEqual(kps, [0, 0, 0]);
});

test('bboxFromProjected skips unprojectable points and returns null when none project', async () => {
  const { bboxFromProjected } = await import('../src/edit/derived.js');
  const verts = new Float32Array([1, 2, 0, 5, 4, 0, 9, 9, 1]);
  const proj = (X) => (X[2] > 0 ? null : [X[0], X[1]]);
  assert.deepEqual(bboxFromProjected(verts, proj), [1, 2, 4, 2]);
  assert.equal(bboxFromProjected(verts, () => null), null);
});

test('occlusionFromMesh: a front-facing triangle between camera and joint occludes; back faces do not', async () => {
  const { occlusionFromMesh } = await import('../src/edit/derived.js');
  // 相机在原点看 −Z;三角形在 z = −1 平面,关节 0 在其后(z = −3),关节 1 在旁边不被挡。
  const verts = new Float32Array([-1, -1, -1, 1, -1, -1, 0, 1, -1]);
  const joints = new Float32Array([0, 0, -3, 5, 5, -3]);
  const front = new Int32Array([0, 1, 2]);   // 逆时针朝 +Z = 朝向相机
  const back = new Int32Array([0, 2, 1]);
  assert.deepEqual(occlusionFromMesh(joints, verts, front, [0, 0, 0], 3, [0, 1]), [1, 0, 0]);
  assert.deepEqual(occlusionFromMesh(joints, verts, back, [0, 0, 0], 2, [0, 1]), [0, 0]);
  // 关节就在三角形前方(未被挡)
  assert.deepEqual(occlusionFromMesh(new Float32Array([0, 0, -0.5]), verts, front, [0, 0, 0], 1, [0]), [0]);
});
