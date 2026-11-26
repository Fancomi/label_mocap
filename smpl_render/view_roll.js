// smpl_render/view_roll.js — 2D 对齐视角的「显示旋转」(纯数学,零 three)。
// 只改怎么看:相机绕光轴转 n×90°(顺时针看图),内参/尺寸随之换成转后的画面;
// 存储的 K、bbox、关键点、人体参数仍是原生方向。见 docs/CONTRACTS.md「显示旋转」。
//
// 约定(与 data_rotation.js#rotateKn 一致,像素边界模型):顺时针一步 (u,v) → (h − v, u),宽高互换。
// 相机系(GL,Y 上、−Z 前):画面顺时针转 90° ⇔ 相机绕自身 +Z 转 +90°。
import { rotateKn } from './data_rotation.js';

export const normSteps = (n) => ((Math.round(n) % 4) + 4) % 4;

// 原生像素 → 显示像素(顺时针 n 步)。w,h = 原生尺寸。
export function viewPixelFromNative(n, u, v, w, h) {
  let x = u, y = v, W = w, H = h;
  for (let i = 0; i < normSteps(n); i++) { [x, y] = [H - y, x]; [W, H] = [H, W]; }
  return [x, y];
}

// 显示像素 → 原生像素(上式的逆)。
export function nativePixelFromView(n, x, y, w, h) {
  const k = normSteps(n);
  // 逐步逆转:先算出每一步的尺寸,再从最后一步往回退。逆一步:(x', y') → (y', H − x'),H = 该步之前的高。
  const dims = [[w, h]];
  for (let i = 0; i < k; i++) { const [W, H] = dims[i]; dims.push([H, W]); }
  let u = x, v = y;
  for (let i = k - 1; i >= 0; i--) { const [, H] = dims[i]; [u, v] = [v, H - u]; }
  return [u, v];
}

// 转后的画面内参与尺寸 { fx, fy, cx, cy, w, h }。
export function viewIntrinsics(n, K, w, h) { return rotateKn(K, w, h, normSteps(n)); }

// 相机绕自身 +Z 转 n×90° 的四元数 [x,y,z,w];显示相机朝向 = 数据相机朝向 · rollQuat(n)。
export function rollQuat(n) {
  const a = normSteps(n) * Math.PI / 4;   // 半角
  return [0, 0, Math.sin(a), Math.cos(a)];
}
