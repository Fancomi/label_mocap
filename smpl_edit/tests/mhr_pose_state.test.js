import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadModelFromFiles } from '../../smpl_core/smpl_model.js';
import { createMhrBody } from '../../smpl_core/body_model.js';
import { quatMultiply, quatConjugate, mat3ToQuat, eulerXYZToQuat } from '../../smpl_core/rotations.js';
import { createPoseState } from '../pose_state.js';

const model = await loadModelFromFiles(new URL('../../smpl_web_viewer/public/models/mhr_lod1.meta.json', import.meta.url),
  async (u) => new Uint8Array(await readFile(u)));
const body = createMhrBody(model);
const k = (name) => body.poseJoints.indexOf(body.jointNames.indexOf(name));
const angle = (a, b) => { const d = quatMultiply(quatConjugate(a), b); return 2 * Math.acos(Math.min(1, Math.abs(d[3]))); };
const fields = () => ({ ...body.defaultFields(), mhr_pose: Array.from({ length: 130 }, (_, i) => Math.sin(i * 1.7) * 0.2) });

test('3-DOF joint (shoulder) reaches an arbitrary target exactly', () => {
  const st = createPoseState(body, fields());
  const target = quatMultiply(st.getJointQuat(k('l_uparm')), eulerXYZToQuat([0.3, -0.4, 0.5]));
  st.setJointQuat(k('l_uparm'), target);
  assert.ok(angle(st.getJointQuat(k('l_uparm')), target) < 1e-6);
});

test('1-DOF joint (elbow) projects onto its bend axis and only moves l_elbow_bend', () => {
  const f = fields();
  const st = createPoseState(body, f);
  const before = st.toAxisAngle().mhr_pose;
  const q0 = st.getJointQuat(k('l_lowarm'));
  st.setJointQuat(k('l_lowarm'), quatMultiply(q0, eulerXYZToQuat([0.2, 0.1, 0.6])));   // 目标含不可达分量
  const after = st.toAxisAngle().mhr_pose;
  const changed = after.map((v, i) => (Math.abs(v - before[i]) > 1e-9 ? model.meta.parameter_names[i + 6] : null)).filter(Boolean);
  assert.deepEqual(changed, ['l_elbow_bend']);
  assert.ok(Math.abs(after[model.meta.parameter_names.indexOf('l_elbow_bend') - 6] - before[model.meta.parameter_names.indexOf('l_elbow_bend') - 6] - 0.6) < 0.05);
});

test('state local quats agree with forward world rotations (parent · local = child)', () => {
  const f = fields();
  const st = createPoseState(body, f);
  const { worldRot } = body.forward({ ...f, ...st.toAxisAngle() }, { worldRot: true });
  const W = (j) => mat3ToQuat(worldRot.slice(j * 9, j * 9 + 9));
  for (const name of ['l_uparm', 'r_upleg', 'c_neck', 'l_wrist']) {
    const j = body.poseJoints[k(name)];
    assert.ok(angle(quatMultiply(W(body.parents[j]), st.getJointQuat(k(name))), W(j)) < 1e-3, name);   // worldRot 是 float32,acos 近 1 处精度约 1e-4 rad
  }
});

test('euler view edits only editable channels; root round-trips', () => {
  const st = createPoseState(body, { ...fields(), root_rota: [0.1, 0.2, -0.3] });
  assert.deepEqual(st.editableChannels(k('l_lowarm')), [2]);
  const e = st.getJointEuler(k('l_lowarm'));
  st.setJointEuler(k('l_lowarm'), [e[0] + 1, e[1], e[2] + 0.25]);
  const e2 = st.getJointEuler(k('l_lowarm'));
  assert.ok(Math.abs(e2[0] - e[0]) < 1e-12 && Math.abs(e2[2] - e[2] - 0.25) < 1e-9);
  const rr = st.toAxisAngle().root_rota;
  [0.1, 0.2, -0.3].forEach((v, i) => assert.ok(Math.abs(rr[i] - v) < 1e-9));
});

test('hands toggle adds finger pose joints', () => {
  const withHands = createMhrBody(model, { showHands: true });
  const has = (b, n) => b.poseJoints.includes(b.jointNames.indexOf(n));
  assert.ok(has(withHands, 'l_index1'));
  assert.ok(!has(body, 'l_index1'));
});

test('rig limits: knee cannot hyper-extend; out-of-range data is not snapped, only kept from going further', async () => {
  const { mhrParamRanges } = await import('../../smpl_core/mhr_pose.js');
  const knee = model.meta.parameter_names.indexOf('l_knee_bend');
  const [lo, hi] = mhrParamRanges(model).get(knee);
  assert.ok(lo === 0 && hi > 2.5, 'knee bends one way only');
  const f = { ...body.defaultFields() };
  const st = createPoseState(body, f);
  const e = st.getJointEuler(k('l_lowleg'));
  st.setJointEuler(k('l_lowleg'), [e[0], e[1], -1.0]);           // 反关节
  assert.equal(st.toAxisAngle().mhr_pose[knee - 6], 0);
  const free = createPoseState(body, f, { limits: false });
  free.setJointEuler(k('l_lowleg'), [e[0], e[1], -1.0]);
  assert.ok(free.toAxisAngle().mhr_pose[knee - 6] < -0.9);
  const out = { ...f, mhr_pose: f.mhr_pose.map((v, i) => (i === knee - 6 ? -0.3 : v)) };   // 数据本身已越界
  const st2 = createPoseState(body, out);
  st2.setJointEuler(k('l_lowleg'), [0, 0, -0.5]);
  assert.ok(Math.abs(st2.toAxisAngle().mhr_pose[knee - 6] + 0.3) < 1e-12, 'not pushed further out');
  st2.setJointEuler(k('l_lowleg'), [0, 0, -0.1]);
  assert.ok(Math.abs(st2.toAxisAngle().mhr_pose[knee - 6] + 0.1) < 1e-12, 'can move back toward the range');
});

test('locked flexible params (min == max) are not treated as hard limits', async () => {
  const { mhrParamRanges } = await import('../../smpl_core/mhr_pose.js');
  const fx = model.meta.parameter_names.indexOf('l_foot_ry_flexible');
  assert.equal(mhrParamRanges(model).has(fx), false);
});

test('IK on MHR: wrist reaches a reachable target; elbow stays a hinge within rig limits', async () => {
  const { IKController } = await import('../ik_controller.js');
  const { resolveChains } = await import('../ik_chains.js');
  const chains = resolveChains(body);
  assert.deepEqual(chains.map((c) => c.name), ['L_Arm', 'R_Arm', 'L_Leg', 'R_Leg']);
  const f = { ...body.defaultFields(), root_pos: [0, 0, -3] };
  let st = createPoseState(body, f);
  let out = body.forward({ ...f, ...st.toAxisAngle() }, { worldRot: true });
  const fields = { ...f };
  const store = { current: () => fields, applyFields: (x) => Object.assign(fields, x) };
  const ik = new IKController({
    getRotation: () => st, getStore: () => store, getLastJoints: () => out.joints, getLastWorldRot: () => out.worldRot,
    getSkeleton: () => chains, getParents: () => body.parents, onEdit: () => {},
  });
  const arm = chains[0];
  const P = (j) => [out.joints[j * 3], out.joints[j * 3 + 1], out.joints[j * 3 + 2]];
  const [s, e, w] = arm.joints.map(P);
  // 目标:手腕朝肩方向收回 25%(要求屈肘)
  const target = w.map((v, d) => v + (s[d] - v) * 0.25);
  ik.beginDrag(arm);
  ik.solveTo(target);
  ik.endDrag();
  out = body.forward(fields);
  const err = Math.hypot(...P(arm.joints[2]).map((v, d) => v - target[d]));
  assert.ok(err < 0.03, `wrist error ${err.toFixed(3)} m`);
  const bend = model.meta.parameter_names.indexOf('l_elbow_bend') - 6;
  assert.ok(fields.mhr_pose[bend] >= -0.5 && fields.mhr_pose[bend] <= 2.0, 'elbow inside rig range');
  void e;
});

test('gizmo drag far past a limit stays continuous (no flip between the two ends)', async () => {
  const { incrementalTarget } = await import('../gizmo_frame.js');
  for (const name of ['l_lowleg', 'l_wrist', 'l_uparm']) {
    const kk = k(name);
    const st = createPoseState(body, body.defaultFields());
    const q0 = st.getJointQuat(kk);
    let prevT = null, prevP = st.toAxisAngle().mhr_pose, maxJump = 0;
    for (let a = 0; a <= 6.2; a += 0.02) {
      const qT = quatMultiply(q0, [0, 0, Math.sin(a / 2), Math.cos(a / 2)]);
      st.setJointQuat(kk, incrementalTarget(prevT, qT, st.getJointQuat(kk)));
      prevT = qT;
      const p = st.toAxisAngle().mhr_pose;
      maxJump = Math.max(maxJump, ...p.map((v, i) => Math.abs(v - prevP[i])));
      prevP = p;
    }
    assert.ok(maxJump < 0.05, `${name} jump ${(maxJump * 57.3).toFixed(1)}°`);
  }
});
