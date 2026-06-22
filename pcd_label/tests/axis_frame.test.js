import assert from 'node:assert/strict';
import { test } from 'node:test';
import { axisFrameMatrix, applyMat3, AXIS_OPTIONS } from '../src/scene/axis_frame.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const vclose = (a, b) => a.forEach((v, i) => close(v, b[i]));

test('Z-up / X-front maps data up(+Z)->+Y and front(+X)->-Z', () => {
  const M = axisFrameMatrix('Z', 'X');
  vclose(applyMat3(M, [0, 0, 1]), [0, 1, 0]);
  vclose(applyMat3(M, [1, 0, 0]), [0, 0, -1]);
});

test('Y-up / Z-front is identity-up and front(+Z)->-Z', () => {
  const M = axisFrameMatrix('Y', 'Z');
  vclose(applyMat3(M, [0, 1, 0]), [0, 1, 0]);
  vclose(applyMat3(M, [0, 0, 1]), [0, 0, -1]);
});

test('matrix is orthonormal (rows unit length, mutually perpendicular)', () => {
  const M = axisFrameMatrix('Z', 'X');
  const r0 = [M[0], M[1], M[2]], r1 = [M[3], M[4], M[5]], r2 = [M[6], M[7], M[8]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  close(dot(r0, r0), 1); close(dot(r1, r1), 1); close(dot(r2, r2), 1);
  close(dot(r0, r1), 0); close(dot(r1, r2), 0); close(dot(r0, r2), 0);
});

test('AXIS_OPTIONS lists valid front axes per up axis', () => {
  assert.deepEqual(AXIS_OPTIONS.Z, ['X', 'Y']);
  assert.deepEqual(AXIS_OPTIONS.Y, ['X', 'Z']);
});
