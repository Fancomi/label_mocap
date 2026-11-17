// smpl_edit/pose_state.js — 按人体模型创建姿态编辑状态(四元数权威,euler 为视图)。
// 第 k 个状态关节 ↔ 骨架关节 body.poseJoints[k],与姿态 tab 的关节按钮一一对应。
import { RotationState } from './rotation_state.js';
import { MhrPoseState } from './mhr_pose_state.js';

// opts.limits:MHR 编辑时遵守 rig 关节范围(默认开)。SMPL 无限位。
export function createPoseState(body, fields, opts = {}) {
  if (body.name === 'mhr') return new MhrPoseState(body.model, body.poseJoints, fields, opts);
  return RotationState.fromAxisAngle({ root_rota: fields.root_rota, body_pose: fields.body_pose });
}
