// smpl_edit/mhr_pose_state.js — MHR 身体姿态的编辑状态。与 rotation_state.js 同接口,
// 编辑器(姿态手柄、欧拉面板、整体手柄)不区分模型。
//
// 实测每个可编辑关节的每个可编辑通道都有一个系数最大(通常为 1)的「直驱参数」,其余项(如脊柱
// 跨节耦合)视为常量。拖手柄得到目标局部四元数后,只在该关节的直驱参数上做高斯-牛顿最小二乘:
// 3 自由度关节精确命中;肘、膝等 1–2 自由度关节自动投影到可行子空间。twist 辅助关节由 PT 自动
// 跟随。整体朝向沿用 root_rota(轴角),与 SMPL 语义一致。
import {
  axisAngleToQuat, quatToAxisAngle, eulerXYZToQuat, quatToEulerXYZ,
  quatMultiply, quatConjugate, quatNormalize,
} from '../smpl_core/rotations.js';
import { mhrPoseChannels, mhrJointEuler, mhrLocalQuat, mhrParamRanges, MHR_POSE_OFFSET as POSE_OFFSET } from '../smpl_core/mhr_pose.js';

// 旋转误差(目标相对当前,局部系)的旋转向量,3 维。
function rotError(q, qT) {
  let d = quatMultiply(quatConjugate(q), qT);
  if (d[3] < 0) d = d.map((v) => -v);
  return quatToAxisAngle(quatNormalize(d));
}

function solve3(A, b) {   // 小对称正定线性方程组,高斯消元(n ≤ 3)
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export class MhrPoseState {
  // poseJoints:姿态按钮序号 k → 骨架关节索引(BodyModel.poseJoints)
  // limits:编辑时遵守 rig 的关节范围(见 mhrParamRanges)。已越界的数据不会被拉回,只是不能再往外拖。
  constructor(model, poseJoints, { root_rota, mhr_pose }, { limits = true } = {}) {
    this._model = model;
    this._ranges = limits ? mhrParamRanges(model) : new Map();
    this._joints = poseJoints;
    this._channels = poseJoints.map((j) => mhrPoseChannels(model, j));
    this._rootQ = axisAngleToQuat(root_rota);
    this._pose = Array.from(mhr_pose);
    this._draftRoot = null;   // 整体欧拉防跳缓存(同 RotationState)
  }

  get jointCount() { return this._joints.length; }
  // 第 k 个姿态关节可编辑的通道(0=rx,1=ry,2=rz)。
  editableChannels(k) { return this._channels[k].map((c) => c.ch); }

  getRootQuat() { return this._rootQ; }
  setRootQuat(q) { this._rootQ = q; this._draftRoot = null; }
  getRootEuler() { return this._draftRoot ?? quatToEulerXYZ(this._rootQ); }
  setRootEuler(e) { this._rootQ = eulerXYZToQuat(e); this._draftRoot = e.slice(); }

  _localQuat(j) { return mhrLocalQuat(this._model, j, this._pose); }

  getJointQuat(k) { return this._localQuat(this._joints[k]); }

  // 欧拉视图 = 该关节自己的 MHR 旋转通道(不可编辑的通道只读显示)。
  getJointEuler(k) { return mhrJointEuler(this._model, this._joints[k], this._pose); }
  setJointEuler(k, e) {
    const cur = this.getJointEuler(k);
    const start = this._pose.slice();
    for (const { ch, param, coef } of this._channels[k]) {
      this._pose[param - POSE_OFFSET] += (e[ch] - cur[ch]) / coef;
    }
    this._clampTo(start, this._channels[k].map((c) => c.param - POSE_OFFSET));
    this._draftRoot = null;
  }

  // 第 k 个关节各可编辑通道的范围(弧度,null = 无限位),面板显示用。
  channelRanges(k) {
    return this._channels[k].map((c) => ({ ch: c.ch, range: this._ranges.get(c.param) ?? null, coef: c.coef }));
  }

  // 把 idx 里的参数夹回范围;范围外起步的参数只允许往回走:[min(lo, 起点), max(hi, 起点)]。
  _clampTo(start, idx) {
    for (const i of idx) {
      const r = this._ranges.get(i + POSE_OFFSET);
      if (!r) continue;
      const lo = Math.min(r[0], start[i]), hi = Math.max(r[1], start[i]);
      this._pose[i] = Math.min(hi, Math.max(lo, this._pose[i]));
    }
  }

  // 目标局部四元数 → 直驱参数最小二乘。
  setJointQuat(k, qT) {
    const j = this._joints[k];
    const chans = this._channels[k];
    if (!chans.length) return;
    const idx = chans.map((c) => c.param - POSE_OFFSET);
    const start = this._pose.slice();
    const h = 1e-6;
    for (let it = 0; it < 12; it++) {
      const r = rotError(this._localQuat(j), qT);
      if (Math.hypot(...r) < 1e-9) break;
      const J = idx.map((i) => {
        const keep = this._pose[i];
        this._pose[i] = keep + h;
        const rp = rotError(this._localQuat(j), qT);
        this._pose[i] = keep;
        return [0, 1, 2].map((a) => (rp[a] - r[a]) / h);
      });   // J[p][a] = ∂r_a/∂x_p
      const A = idx.map((_, p) => idx.map((__, q) => J[p][0] * J[q][0] + J[p][1] * J[q][1] + J[p][2] * J[q][2] + (p === q ? 1e-9 : 0)));
      const b = idx.map((_, p) => -(J[p][0] * r[0] + J[p][1] * r[1] + J[p][2] * r[2]));
      const dx = solve3(A, b);
      idx.forEach((i, p) => { this._pose[i] += dx[p]; });
      this._clampTo(start, idx);   // 投影梯度:每步夹回范围,其余自由度继续逼近目标
    }
    this._draftRoot = null;
  }

  // 外部(体型面板的柔性长度)整体改了 mhr_pose 时同步进来。
  setPoseParams(pose) { this._pose = Array.from(pose); }

  toAxisAngle() {
    return { root_rota: quatToAxisAngle(this._rootQ), mhr_pose: this._pose.slice() };
  }
}
