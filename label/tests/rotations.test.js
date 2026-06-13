import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  axisAngleToQuat, quatToAxisAngle,
  eulerXYZToQuat, quatToEulerXYZ,
  quatToMat3, quatMultiply, quatNormalize,
} from '../../smpl_core/rotations.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const arrClose = (a, b, eps = 1e-6) => { assert.equal(a.length, b.length); a.forEach((v, i) => close(v, b[i], eps)); };

test('axis-angle ↔ quat round-trips for a generic rotation', () => {
  const aa = [0.3, -1.1, 0.7];
  const q = axisAngleToQuat(aa);
  arrClose(quatToAxisAngle(q), aa);
});

test('zero axis-angle maps to identity quat', () => {
  arrClose(axisAngleToQuat([0, 0, 0]), [0, 0, 0, 1]);
});

test('euler XYZ ↔ quat round-trips away from gimbal lock', () => {
  const e = [0.4, 0.2, -0.9];
  arrClose(quatToEulerXYZ(eulerXYZToQuat(e)), e, 1e-5);
});

test('quatToMat3 gives a proper rotation matrix (orthonormal, det 1)', () => {
  const m = quatToMat3(axisAngleToQuat([0, Math.PI / 2, 0])); // 90° about Y
  // rotates +X(1,0,0) to -Z(0,0,-1)
  arrClose([m[0], m[3], m[6]], [0, 0, -1], 1e-6);
});

test('quatMultiply composes rotations (q2 after q1)', () => {
  const q1 = axisAngleToQuat([0, 0, Math.PI / 2]);
  const q2 = axisAngleToQuat([0, 0, Math.PI / 2]);
  const aa = quatToAxisAngle(quatNormalize(quatMultiply(q2, q1)));
  close(Math.hypot(...aa), Math.PI, 1e-6);
});

import { mat3ToQuat, quatConjugate } from '../../smpl_core/rotations.js';

test('mat3ToQuat inverts quatToMat3 round-trip', () => {
  const q = quatNormalize([0.2, -0.5, 0.3, 0.78]);
  const m = quatToMat3(q);
  const q2 = mat3ToQuat(m);
  const dot = Math.abs(q[0]*q2[0] + q[1]*q2[1] + q[2]*q2[2] + q[3]*q2[3]);
  assert.ok(Math.abs(dot - 1) < 1e-5, `dot ${dot}`);
});

test('quatConjugate of a unit quat is its inverse (q * q* = identity)', () => {
  const q = quatNormalize([0.2, -0.5, 0.3, 0.78]);
  const qc = quatConjugate(q);
  const p = quatMultiply(q, qc);
  assert.ok(Math.abs(p[0]) < 1e-6 && Math.abs(p[1]) < 1e-6 && Math.abs(p[2]) < 1e-6);
  assert.ok(Math.abs(p[3] - 1) < 1e-6);
});
