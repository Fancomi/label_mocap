// smpl_core/mhr_pose.js — MHR 关节旋转通道(纯数学):PT 里哪些参数驱动哪个关节的哪个旋转通道。
// MHR 关节 j 的局部旋转 = prerot_j · Rz·Ry·Rx(e_j),e_j = 该关节 3 个旋转通道,由 PT 线性组合
// 204 维参数得到。编辑状态见 smpl_edit/mhr_pose_state.js。
import { eulerXYZToQuat, quatMultiply, quatNormalize } from './rotations.js';

const PER_JOINT = 7;
const POSE_OFFSET = 6;      // mhr_pose[i] = model_params[6 + i]
const POSE_COUNT = 130;
export const MHR_POSE_OFFSET = POSE_OFFSET;

// PT 按行索引:row → [[col, val]]
function ptRows(model) {
  if (model._ptRows) return model._ptRows;
  const rows = new Map();
  for (let k = 0; k < model.pt_val.length; k++) {
    const r = model.pt_row[k];
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push([model.pt_col[k], model.pt_val[k]]);
  }
  model._ptRows = rows;
  return rows;
}

// 关节 j 的可编辑旋转通道:[{ ch(0=rx,1=ry,2=rz), param(model_params 索引), coef }]。
// 只取姿态参数区间里系数绝对值最大、且 ≥ 0.5 的项作直驱;没有则该通道不可编辑。
export function mhrPoseChannels(model, j) {
  const rows = ptRows(model);
  const out = [];
  for (let ch = 0; ch < 3; ch++) {
    let best = null;
    for (const [col, val] of rows.get(j * PER_JOINT + 3 + ch) ?? []) {
      if (col < POSE_OFFSET || col >= POSE_OFFSET + POSE_COUNT) continue;
      if (!best || Math.abs(val) > Math.abs(best.coef)) best = { ch, param: col, coef: val };
    }
    if (best && Math.abs(best.coef) >= 0.5) out.push(best);
  }
  return out;
}

// rig 自带的参数范围(弧度):model_params 索引 → [min, max]。只收真正的区间(min < max);
// min == max 的是 rig 给自家求解器「锁住」的柔性/修正自由度(*_flexible 等),sam-3d-body 的输出普遍使用它们,
// 当硬限位会让现有数据无法编辑,所以不纳入。资产里没有限位数组时返回空表。
export function mhrParamRanges(model) {
  if (model._ranges) return model._ranges;
  const out = new Map();
  for (let k = 0; k < (model.limit_param?.length ?? 0); k++) {
    if (model.limit_max[k] > model.limit_min[k]) out.set(model.limit_param[k], [model.limit_min[k], model.limit_max[k]]);
  }
  model._ranges = out;
  return out;
}

// 关节 j 的 3 个旋转通道值(弧度),只由 mhr_pose 决定(root 参数只驱动 root 行)。
export function mhrJointEuler(model, j, pose) {
  const rows = ptRows(model);
  const e = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    for (const [col, val] of rows.get(j * PER_JOINT + 3 + ch) ?? []) {
      if (col >= POSE_OFFSET && col < POSE_OFFSET + POSE_COUNT) e[ch] += val * pose[col - POSE_OFFSET];
    }
  }
  return e;
}

// 关节 j 的局部旋转四元数 [x,y,z,w](姿态由 mhr_pose 给出)。
export function mhrLocalQuat(model, j, pose) {
  const p = model.joint_prerotations;
  const pre = [p[j * 4], p[j * 4 + 1], p[j * 4 + 2], p[j * 4 + 3]];
  return quatNormalize(quatMultiply(pre, eulerXYZToQuat(mhrJointEuler(model, j, pose))));
}

