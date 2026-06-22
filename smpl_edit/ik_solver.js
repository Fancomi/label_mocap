// smpl_edit/ik_solver.js
// 两段解析 IK(余弦定理)+ 最短弧四元数。纯几何:点用 [x,y,z],四元数 [x,y,z,w]。
// 零 three.js / 零 SMPL —— 对任何两段肢体成立。
import { quatNormalize } from '../smpl_core/rotations.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function norm(a) { const l = len(a); return l < 1e-9 ? [0, 0, 0] : scale(a, 1 / l); }
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// 单位向量 from → to 的最短弧旋转四元数。
export function shortestArcQuat(from, to) {
  const f = norm(from); const t = norm(to);
  const d = clamp(dot(f, t), -1, 1);
  if (d > 1 - 1e-8) return [0, 0, 0, 1];
  if (d < -1 + 1e-8) {
    let axis = cross([1, 0, 0], f);
    if (len(axis) < 1e-6) axis = cross([0, 1, 0], f);
    axis = norm(axis);
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(f, t);
  return quatNormalize([c[0], c[1], c[2], 1 + d]);
}

// 解两段 IK。root/mid/end 是当前三关节世界坐标,target 是末端目标,pole 决定弯曲平面。
// 返回中段(肘)与末端(腕)的新世界坐标,保持两段骨长。
export function solveTwoBoneIK({ root, mid, end, target, pole }) {
  const a = len(sub(mid, root));
  const b = len(sub(end, mid));
  if (a < 1e-9 || b < 1e-9) return { mid: mid.slice(), end: end.slice() };

  const toTarget = sub(target, root);
  let d = len(toTarget);
  const dir = d < 1e-9 ? [1, 0, 0] : scale(toTarget, 1 / d);
  // 下界留 1e-6 防止 a==b 时 alpha 退化;上界允许精确伸直
  d = clamp(d, Math.abs(a - b) + 1e-6, a + b);

  let bend = sub(pole, scale(dir, dot(pole, dir)));
  if (len(bend) < 1e-6) {
    bend = sub([0, 1, 0], scale(dir, dot([0, 1, 0], dir)));
    if (len(bend) < 1e-6) bend = sub([1, 0, 0], scale(dir, dot([1, 0, 0], dir)));
  }
  bend = norm(bend);

  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const alpha = Math.acos(cosA);
  const newMid = add(root, add(scale(dir, a * Math.cos(alpha)), scale(bend, a * Math.sin(alpha))));
  const newEnd = add(root, scale(dir, d));
  return { mid: newMid, end: newEnd };
}
