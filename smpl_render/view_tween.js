// smpl_render/view_tween.js — 2D 对齐 ↔ 3D 自由切换时的投影过渡(纯函数)。
// 视锥用单位深度处的四条边表示:{ l, r, t, b } = 相机系 x/(−z)、y/(−z) 的范围(t 在上,b 在下)。
// 过渡时画布填满容器,两端视锥都换算到「整个容器」上再线性插值:起点与 2D 画面(含缩放、填满、留边)
// 在屏幕上逐像素重合,终点就是 3D 视野,中间不跳。

// three PerspectiveCamera.updateProjectionMatrix 的视锥(zoom = 1,无 filmOffset)。
export function frustumOf({ fov, aspect, view = null }) {
  let t = Math.tan((fov * Math.PI) / 360);
  let h = 2 * t, w = aspect * h, l = -w / 2;
  if (view) {
    l += (view.offsetX * w) / view.fullWidth;
    t -= (view.offsetY * h) / view.fullHeight;
    w *= view.width / view.fullWidth;
    h *= view.height / view.fullHeight;
  }
  return { l, r: l + w, t, b: t - h };
}

// f 是画在容器内子矩形 rect(归一化,{ x0, y0, x1, y1 },y 向下)上的视锥 → 同一投影铺满整个容器时的视锥。
export function extendFrustum(f, { x0, y0, x1, y1 }) {
  const sx = (f.r - f.l) / (x1 - x0), sy = (f.t - f.b) / (y1 - y0);
  return { l: f.l - x0 * sx, r: f.r + (1 - x1) * sx, t: f.t + y0 * sy, b: f.b - (1 - y1) * sy };
}

export function lerpFrustum(a, b, k) {
  const m = (p, q) => p + (q - p) * k;
  return { l: m(a.l, b.l), r: m(a.r, b.r), t: m(a.t, b.t), b: m(a.b, b.b) };
}

// 任意(非对称)视锥 → PerspectiveCamera 参数:fov 取视锥的竖直张角(手柄尺寸公式按 fov 算,
// 这样过渡中手柄在屏幕上的大小连续),aspect = 1,setViewOffset(2, 2, x, y, w, h)。
export function viewOffsetFor(f) {
  const tY = (f.t - f.b) / 2;
  return { fov: (2 * Math.atan(tY) * 180) / Math.PI, x: f.l / tY + 1, y: 1 - f.t / tY, w: (f.r - f.l) / tY, h: 2 };
}
