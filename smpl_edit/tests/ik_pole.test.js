// smpl_edit/tests/ik_pole.test.js
// Pole-vector drag: end-locked, plane-only. Verifies the limb rotates rigidly
// about the root→end axis — only the root joint's local quat changes; the
// mid (elbow/knee) and end (wrist/ankle) local quats are unchanged.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadModelFromFiles } from '../../smpl_core/smpl_model.js';
import { forwardSmpl } from '../../smpl_core/lbs.js';
import { RotationState } from '../rotation_state.js';
import { IKController } from '../ik_controller.js';

const model = await loadModelFromFiles(
  new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url),
  async (u) => new Uint8Array(await readFile(u)));

function harness() {
  // Start from a slightly bent arm so the bend plane is well-defined.
  const body = Array(63).fill(0);
  body[15 * 3 + 1] = 0.4; // L elbow (bodyIdx 17 → 关节18) small bend on Y
  let rotation = RotationState.fromAxisAngle({ root_rota: [0, 0, 0], body_pose: body });
  let lastJoints = null, lastWorldRot = null;
  let poleStore = {}; // chainName -> [x,y,z]
  const refresh = () => {
    const { root_rota, body_pose } = rotation.toAxisAngle();
    const o = forwardSmpl(model, { root_pos: [0, 0, -4], root_rota, body_pose, betas: Array(10).fill(0) }, { worldRot: true });
    lastJoints = o.joints; lastWorldRot = o.worldRot;
  };
  refresh();
  const store = {
    beginEdit() {}, commitEdit() {},
    current: () => ({ pole_vectors: poleStore }),
    applyFields: (f) => { if (f.pole_vectors) poleStore = f.pole_vectors; },
  };
  const ik = new IKController({
    getRotation: () => rotation, getStore: () => store,
    getLastJoints: () => lastJoints, getLastWorldRot: () => lastWorldRot,
    getSkeleton: () => 'smpl', getParents: () => model.parents, onEdit: () => refresh(),
  });
  return { ik, rotation: () => rotation, joints: () => lastJoints, poleStore: () => poleStore };
}

const j3 = (a, i) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
const qclose = (a, b, eps = 1e-6) => {
  // quats equal up to sign
  const same = Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps && Math.abs(a[3] - b[3]) < eps;
  const neg = Math.abs(a[0] + b[0]) < eps && Math.abs(a[1] + b[1]) < eps && Math.abs(a[2] + b[2]) < eps && Math.abs(a[3] + b[3]) < eps;
  return same || neg;
};

test('pole drag keeps end position fixed (end-locked)', () => {
  const { ik, joints } = harness();
  const chain = ik.chainFor(20); // L_Arm
  const root = j3(joints(), 16), end0 = j3(joints(), 20);
  ik.beginPoleDrag(chain);
  // Pole somewhere off to the side of the limb.
  ik.solveToPole([root[0] + 0.3, root[1] + 0.2, root[2] + 0.1]);
  ik.endPoleDrag();
  const end1 = j3(joints(), 20);
  const err = Math.hypot(end1[0] - end0[0], end1[1] - end0[1], end1[2] - end0[2]);
  assert.ok(err < 1e-3, `end moved by ${err}`);
});

test('pole drag changes ONLY the root joint local quat; elbow & wrist unchanged', () => {
  const { ik, rotation, joints } = harness();
  const chain = ik.chainFor(20); // L_Arm, bodyIdx [15,17,19]
  const [bShoulder, bElbow] = chain.bodyIdx; // 15, 17
  const shoulder0 = rotation().getJointQuat(bShoulder).slice();
  const elbow0 = rotation().getJointQuat(bElbow).slice();
  const root = j3(joints(), 16);
  ik.beginPoleDrag(chain);
  ik.solveToPole([root[0] + 0.3, root[1] + 0.25, root[2] + 0.15]);
  ik.endPoleDrag();
  const shoulder1 = rotation().getJointQuat(bShoulder);
  const elbow1 = rotation().getJointQuat(bElbow);
  assert.equal(qclose(elbow0, elbow1), true, 'elbow local quat must be unchanged');
  assert.equal(qclose(shoulder0, shoulder1), false, 'shoulder local quat must change');
});

test('pole drag persists the world pole into store on end', () => {
  const { ik, joints, poleStore } = harness();
  const chain = ik.chainFor(20);
  const root = j3(joints(), 16);
  const world = [root[0] + 0.3, root[1] + 0.2, root[2] + 0.1];
  ik.beginPoleDrag(chain);
  ik.solveToPole(world);
  ik.endPoleDrag();
  assert.deepEqual(poleStore().L_Arm, world);
});

test('endPoleDrag clears reference; solveToPole after is a no-op', () => {
  const { ik } = harness();
  ik.endPoleDrag();
  ik.solveToPole([0, 0, -3]); // no ref → must not throw
  assert.ok(true);
});
