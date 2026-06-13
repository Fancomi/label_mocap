import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localFromWorldGizmo, worldGizmoFromLocal } from '../src/edit/gizmo_frame.js';
import { axisAngleToQuat, quatMultiply, quatToMat3, mat3ToQuat, quatNormalize } from '../../smpl_core/rotations.js';

const close = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const quatClose = (a, b) => { const d = Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]); close(d, 1); };

test('round-trip: worldGizmoFromLocal then localFromWorldGizmo recovers the local quat', () => {
  const qParentWorld = axisAngleToQuat([0.3, -1.0, 0.5]);
  const qLocal = axisAngleToQuat([0.2, 0.1, -0.4]);
  const qWorld = worldGizmoFromLocal(qParentWorld, qLocal);
  const back = localFromWorldGizmo(qParentWorld, qWorld);
  quatClose(back, qLocal);
});

test('with identity parent, gizmo world quat equals local quat', () => {
  const qLocal = axisAngleToQuat([0.5, 0, 0]);
  const qWorld = worldGizmoFromLocal([0, 0, 0, 1], qLocal);
  quatClose(qWorld, qLocal);
  quatClose(localFromWorldGizmo([0, 0, 0, 1], qWorld), qLocal);
});

test('a world-space delta about a parent-rotated joint maps to the correct local change', () => {
  const qParent = axisAngleToQuat([0, 0, Math.PI / 2]);
  const qLocal0 = [0, 0, 0, 1];
  const qWorld0 = worldGizmoFromLocal(qParent, qLocal0);
  const dWorld = axisAngleToQuat([Math.PI / 6, 0, 0]);
  const qWorldNew = quatMultiply(dWorld, qWorld0);
  const qLocalNew = localFromWorldGizmo(qParent, qWorldNew);
  quatClose(worldGizmoFromLocal(qParent, qLocalNew), qWorldNew);
});
