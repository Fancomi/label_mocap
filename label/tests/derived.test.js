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

