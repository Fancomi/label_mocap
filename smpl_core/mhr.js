// smpl_core/mhr.js — MHR(LOD1)前向,纯数学,无 DOM。
// 逐行对照 tools/mhr/mhr_reference.py(它又对照 MHR 官方 TorchScript)。
// 与交付数据的生产设置一致:不做姿态修正、表情为零。
// 模型系:厘米、Y 上。资产由 tools/mhr/export_mhr_web_model.py 导出。

export const MHR_MODEL_PARAMS = 204;
export const MHR_IDENTITY = 45;
export const MHR_ROOT_JOINT = 1;   // 'root'(骨盆);关节 0 是 body_world

const PER_JOINT = 7;               // tx ty tz rx ry rz log2(scale)

function jointCount(model) { return model.parentsShape[0]; }

// identity 系数 → 静止网格(厘米)。体型不变时可缓存复用。
export function mhrRestShape(model, identity) {
  const out = new Float32Array(model.base_shape);
  const n = out.length;
  for (let k = 0; k < MHR_IDENTITY; k++) {
    const c = identity[k] ?? 0;
    if (c === 0) continue;
    const base = k * n;
    for (let i = 0; i < n; i++) out[i] += c * model.identity_vectors[base + i];
  }
  return out;
}

// model_params(204) → joint_params(127×7),稀疏 PT。
export function mhrJointParams(model, modelParams) {
  const jp = new Float64Array(jointCount(model) * PER_JOINT);
  for (let k = 0; k < model.pt_val.length; k++) {
    jp[model.pt_row[k]] += model.pt_val[k] * (modelParams[model.pt_col[k]] ?? 0);
  }
  return jp;
}

function qmul(a, ai, b, bi, out, oi) {
  const x1 = a[ai], y1 = a[ai + 1], z1 = a[ai + 2], w1 = a[ai + 3];
  const x2 = b[bi], y2 = b[bi + 1], z2 = b[bi + 2], w2 = b[bi + 3];
  out[oi] = w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2;
  out[oi + 1] = w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2;
  out[oi + 2] = w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2;
  out[oi + 3] = w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2;
}

function qnormalize(q, i) {
  const n = Math.hypot(q[i], q[i + 1], q[i + 2], q[i + 3]) || 1;
  q[i] /= n; q[i + 1] /= n; q[i + 2] /= n; q[i + 3] /= n;
}

// v' = v + 2·(w·(a×v) + a×(a×v)),写回 out[oi..oi+2]
function qrot(q, qi, x, y, z, out, oi) {
  const ax = q[qi], ay = q[qi + 1], az = q[qi + 2], w = q[qi + 3];
  const cx = ay * z - az * y, cy = az * x - ax * z, cz = ax * y - ay * x;
  const dx = ay * cz - az * cy, dy = az * cx - ax * cz, dz = ax * cy - ay * cx;
  out[oi] = x + 2 * (w * cx + dx);
  out[oi + 1] = y + 2 * (w * cy + dy);
  out[oi + 2] = z + 2 * (w * cz + dz);
}

// pymomentum euler_xyz_to_quaternion:R = Rz·Ry·Rx
function eulerXYZQuat(rx, ry, rz, out, oi) {
  const cr = Math.cos(rx / 2), sr = Math.sin(rx / 2);
  const cp = Math.cos(ry / 2), sp = Math.sin(ry / 2);
  const cy = Math.cos(rz / 2), sy = Math.sin(rz / 2);
  out[oi] = sr * cp * cy - cr * sp * sy;
  out[oi + 1] = cr * sp * cy + sr * cp * sy;
  out[oi + 2] = cr * cp * sy - sr * sp * cy;
  out[oi + 3] = cr * cp * cy + sr * sp * sy;
}

// joint_params → 各关节全局相似变换 { t(127×3), q(127×4 [x,y,z,w]), s(127) },厘米。
export function mhrSkeleton(model, jointParams) {
  const n = jointCount(model);
  const t = new Float64Array(n * 3), q = new Float64Array(n * 4), s = new Float64Array(n);
  const lq = new Float64Array(4), eq = new Float64Array(4), tmp = new Float64Array(3);
  for (let j = 0; j < n; j++) {
    const p = j * PER_JOINT;
    const lx = jointParams[p] + model.joint_offsets[j * 3];
    const ly = jointParams[p + 1] + model.joint_offsets[j * 3 + 1];
    const lz = jointParams[p + 2] + model.joint_offsets[j * 3 + 2];
    eulerXYZQuat(jointParams[p + 3], jointParams[p + 4], jointParams[p + 5], eq, 0);
    qmul(model.joint_prerotations, j * 4, eq, 0, lq, 0);
    qnormalize(lq, 0);
    const ls = 2 ** jointParams[p + 6];
    const par = model.parents[j];
    if (par < 0) {
      t[j * 3] = lx; t[j * 3 + 1] = ly; t[j * 3 + 2] = lz;
      q.set(lq, j * 4); s[j] = ls;
      continue;
    }
    qrot(q, par * 4, lx, ly, lz, tmp, 0);
    t[j * 3] = t[par * 3] + s[par] * tmp[0];
    t[j * 3 + 1] = t[par * 3 + 1] + s[par] * tmp[1];
    t[j * 3 + 2] = t[par * 3 + 2] + s[par] * tmp[2];
    qmul(q, par * 4, lq, 0, q, j * 4);
    s[j] = s[par] * ls;
  }
  return { t, q, s };
}

// 全局骨架 ∘ inverse_bind_pose → 每关节 3×4 矩阵(含缩放),再做 LBS。
export function mhrSkin(model, skel, rest) {
  const n = jointCount(model);
  const mats = new Float64Array(n * 12);
  const ibp = model.inverse_bind_pose;
  const bq = new Float64Array(4), cq = new Float64Array(4), tmp = new Float64Array(3);
  for (let j = 0; j < n; j++) {
    const o = j * 8;
    bq[0] = ibp[o + 3]; bq[1] = ibp[o + 4]; bq[2] = ibp[o + 5]; bq[3] = ibp[o + 6];
    qnormalize(bq, 0);
    qrot(skel.q, j * 4, ibp[o], ibp[o + 1], ibp[o + 2], tmp, 0);
    const sj = skel.s[j];
    const tx = skel.t[j * 3] + sj * tmp[0], ty = skel.t[j * 3 + 1] + sj * tmp[1], tz = skel.t[j * 3 + 2] + sj * tmp[2];
    qmul(skel.q, j * 4, bq, 0, cq, 0);
    qnormalize(cq, 0);
    const sc = sj * ibp[o + 7];
    const [x, y, z, w] = cq;
    const m = j * 12;
    mats[m] = sc * (1 - 2 * (y * y + z * z)); mats[m + 1] = sc * 2 * (x * y - w * z); mats[m + 2] = sc * 2 * (x * z + w * y); mats[m + 3] = tx;
    mats[m + 4] = sc * 2 * (x * y + w * z); mats[m + 5] = sc * (1 - 2 * (x * x + z * z)); mats[m + 6] = sc * 2 * (y * z - w * x); mats[m + 7] = ty;
    mats[m + 8] = sc * 2 * (x * z - w * y); mats[m + 9] = sc * 2 * (y * z + w * x); mats[m + 10] = sc * (1 - 2 * (x * x + y * y)); mats[m + 11] = tz;
  }
  const out = new Float32Array(rest.length);
  const { skin_joint: sj, skin_vert: sv, skin_weight: sw } = model;
  for (let k = 0; k < sw.length; k++) {
    const m = sj[k] * 12, v = sv[k] * 3, w = sw[k];
    const x = rest[v], y = rest[v + 1], z = rest[v + 2];
    out[v] += w * (mats[m] * x + mats[m + 1] * y + mats[m + 2] * z + mats[m + 3]);
    out[v + 1] += w * (mats[m + 4] * x + mats[m + 5] * y + mats[m + 6] * z + mats[m + 7]);
    out[v + 2] += w * (mats[m + 8] * x + mats[m + 9] * y + mats[m + 10] * z + mats[m + 11]);
  }
  return out;
}

// 模型系前向:{ vertices(V×3 cm), skeleton }。rest 可传入缓存的 mhrRestShape 结果。
export function forwardMhrModel(model, identity, modelParams, { rest } = {}) {
  const skeleton = mhrSkeleton(model, mhrJointParams(model, modelParams));
  const vertices = mhrSkin(model, skeleton, rest ?? mhrRestShape(model, identity));
  return { vertices, skeleton };
}
