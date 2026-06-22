import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RotationState } from '../rotation_state.js';
import { quatToAxisAngle } from '../../smpl_core/rotations.js';

const arrClose = (a, b, eps = 1e-5) => { assert.equal(a.length, b.length); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= eps, `${v} != ${b[i]}`)); };

test('fromAxisAngle stores root + 21 joints as quaternions', () => {
  const s = RotationState.fromAxisAngle({ root_rota: [0, 0, 0], body_pose: Array(63).fill(0) });
  arrClose(s.getJointQuat(0), [0, 0, 0, 1]);
  assert.equal(s.jointCount, 21);
});

test('toAxisAngle round-trips root_rota and body_pose', () => {
  const root = [0.1, -0.2, 0.3];
  const body = Array.from({ length: 63 }, (_, i) => (i % 7) * 0.01);
  const s = RotationState.fromAxisAngle({ root_rota: root, body_pose: body });
  const out = s.toAxisAngle();
  arrClose(out.root_rota, root);
  arrClose(out.body_pose, body);
});

test('setJointEuler updates the quaternion source', () => {
  const s = RotationState.fromAxisAngle({ root_rota: [0, 0, 0], body_pose: Array(63).fill(0) });
  s.setJointEuler(2, [0, Math.PI / 2, 0]);
  arrClose(quatToAxisAngle(s.getJointQuat(2)), [0, Math.PI / 2, 0]);
});

test('euler draft is preserved until quaternion changes elsewhere', () => {
  const s = RotationState.fromAxisAngle({ root_rota: [0, 0, 0], body_pose: Array(63).fill(0) });
  s.setJointEuler(0, [Math.PI, 0, 0]); // a pole-ish value
  arrClose(s.getJointEuler(0), [Math.PI, 0, 0]);
  s.setJointEuler(1, [0.1, 0, 0]);     // different joint changes
  arrClose(s.getJointEuler(0), [Math.PI, 0, 0]); // joint 0 draft intact
});
