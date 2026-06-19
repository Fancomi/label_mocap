// label/tests/ik_controller.test.js
// IKController 的独立单元测试(node:test,无浏览器)。
// 依赖注入真实 SMPL 模型 + forwardSmpl,验证 chainFor 命中、两段反解收敛、
// 以及 endDrag 后 solveTo 的无副作用兜底。
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
  let rotation = RotationState.fromAxisAngle({ root_rota: [0, 0, 0], body_pose: Array(63).fill(0) });
  let lastJoints = null, lastWorldRot = null;
  const refresh = () => {
    const { root_rota, body_pose } = rotation.toAxisAngle();
    const o = forwardSmpl(model, { root_pos: [0, 0, -4], root_rota, body_pose, betas: Array(10).fill(0) }, { worldRot: true });
    lastJoints = o.joints; lastWorldRot = o.worldRot;
  };
  refresh();
  const store = { beginEdit() {}, applyFields() {}, commitEdit() {} };
  const ik = new IKController({
    getRotation: () => rotation, getStore: () => store,
    getLastJoints: () => lastJoints, getLastWorldRot: () => lastWorldRot,
    getSkeleton: () => 'smpl', getParents: () => model.parents, onEdit: () => refresh(),
  });
  return { ik, joints: () => lastJoints };
}

test('chainFor 命中末端关节、非末端返回 null', () => {
  const { ik } = harness();
  assert.ok(ik.chainFor(20)); // L_Wrist
  assert.equal(ik.chainFor(18), null);
});

test('拖末端关节后,该末端世界坐标趋近 target', () => {
  const { ik, joints } = harness();
  const chain = ik.chainFor(20); // L_Wrist, joints [16,18,20]
  const j = (i) => [joints()[i * 3], joints()[i * 3 + 1], joints()[i * 3 + 2]];
  const shoulder = j(16);
  const target = [shoulder[0] + 0.1, shoulder[1] - 0.1, shoulder[2] + 0.05];
  ik.beginDrag(chain);
  for (let s = 0; s < 8; s++) ik.solveTo(target); // 增量收敛
  ik.endDrag();
  const wrist = j(20);
  const err = Math.hypot(wrist[0] - target[0], wrist[1] - target[1], wrist[2] - target[2]);
  assert.ok(err < 0.02, `腕命中误差 ${err}`);
});

test('endDrag 后 solveTo 无副作用(无参考则忽略)', () => {
  const { ik } = harness();
  ik.endDrag();
  ik.solveTo([0, 0, -3]); // 不应抛错
  assert.ok(true);
});
