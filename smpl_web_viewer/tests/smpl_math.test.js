import assert from 'node:assert/strict';
import { test } from 'node:test';
import { axisAngleToMat3, mat4FromRt, mat4Mul, transformPoint } from '../src/smpl/math3d.js';

test('axisAngleToMat3 returns identity for zero vector', () => {
  assert.deepEqual(Array.from(axisAngleToMat3([0, 0, 0])).map(x => +x.toFixed(6)), [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ]);
});

test('axisAngleToMat3 rotates around z axis', () => {
  const r = axisAngleToMat3([0, 0, Math.PI / 2]);
  const p = transformPoint(mat4FromRt(r, [0, 0, 0]), [1, 0, 0]);
  assert.ok(Math.abs(p[0]) < 1e-6);
  assert.ok(Math.abs(p[1] - 1) < 1e-6);
});

test('mat4FromRt stores row-major translation in the last column', () => {
  const m = mat4FromRt([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ], [4, 5, 6]);
  assert.deepEqual(Array.from(m), [
    1, 0, 0, 4,
    0, 1, 0, 5,
    0, 0, 1, 6,
    0, 0, 0, 1
  ]);
});

test('mat4Mul composes translations', () => {
  const a = [1,0,0,1, 0,1,0,2, 0,0,1,3, 0,0,0,1];
  const b = [1,0,0,4, 0,1,0,5, 0,0,1,6, 0,0,0,1];
  const out = mat4Mul(a, b);
  assert.deepEqual(Array.from(out.slice(3, 12).filter((_, i) => i % 4 === 0)), [5, 7, 9]);
});
