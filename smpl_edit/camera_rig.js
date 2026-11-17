// smpl_edit/camera_rig.js — 多相机(纯逻辑,无 DOM/three)。
//
// 数据侧(文档 cameras[]):各相机原生参数,原样存储,不含任何旋转烘焙 ——
//   { id, width, height, cam_K:{fx,fy,cx,cy}, R:[9], t:[3], view_rotation_deg, video, fps }
//   R,t:OpenCV「原生相机 ← 公共系」,x_cv = R·p_common + t,米;width/height/cam_K 为原生像素网格。
//   view_rotation_deg:显示时的整幅顺时针旋转(0/90/180/270,−90 = 270)。这是下发数据时写好的
//   显示配置,标注员不需要也不能改;它只影响「怎么看」,不改存储的 bbox/位姿。
// 世界系:公共系的 GL 版(F = diag(1,−1,−1)),Y 上、−Z 深度 —— 与单视角「相机在原点」约定一致。
//
// 视图相机 = 把显示旋转折进外参与内参后的「转正」针孔相机:
//   K_view = P·K·R_rotᵀ,R_view = R_rot·R,t_view = R_rot·t(P = 像素旋转,R_rot = 相机系旋转)。
// 下游(渲染、投影、bbox 派生)只看视图相机,和普通单相机完全一样。

const F = [1, 0, 0, 0, -1, 0, 0, 0, -1];

function mul3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return o;
}
function mulVec3(m, v) {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}
const transpose3 = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export function normalizeRotation(deg = 0) {
  const d = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  if (Math.abs(deg - Math.round(deg / 90) * 90) > 1e-9) throw new Error(`view_rotation_deg 必须是 90 的整数倍: ${deg}`);
  return d;
}

// 顺时针 deg 的整幅旋转:像素变换 P(3×3,作用于 [u,v,1],含像素中心的 w−1/h−1 偏移)、
// 相机系旋转 R_rot、转正后尺寸。与 sam3d 数据包 pixel_upright_from_native 约定一致。
export function viewRotation(deg, w, h) {
  switch (normalizeRotation(deg)) {
    case 0: return { P: [1, 0, 0, 0, 1, 0, 0, 0, 1], R: [1, 0, 0, 0, 1, 0, 0, 0, 1], width: w, height: h };
    case 90: return { P: [0, -1, h - 1, 1, 0, 0, 0, 0, 1], R: [0, -1, 0, 1, 0, 0, 0, 0, 1], width: h, height: w };
    case 180: return { P: [-1, 0, w - 1, 0, -1, h - 1, 0, 0, 1], R: [-1, 0, 0, 0, -1, 0, 0, 0, 1], width: w, height: h };
    default: return { P: [0, 1, 0, -1, 0, w - 1, 0, 0, 1], R: [0, 1, 0, -1, 0, 0, 0, 0, 1], width: h, height: w };
  }
}

function applyPixel(P, [u, v]) {
  return [P[0] * u + P[1] * v + P[2], P[3] * u + P[4] * v + P[5]];
}
function invertPixel(P) {
  // P = [A | b],A 为正交整数阵 → P⁻¹ = [Aᵀ | −Aᵀb]
  const At = [P[0], P[3], P[1], P[4]];
  return [At[0], At[1], -(At[0] * P[2] + At[1] * P[5]), At[2], At[3], -(At[2] * P[2] + At[3] * P[5]), 0, 0, 1];
}

export class CameraRig {
  constructor(cameras) {
    if (!Array.isArray(cameras) || cameras.length === 0) throw new Error('CameraRig 需要至少一个相机');
    this._cams = new Map();
    for (const c of cameras) this._cams.set(c.id, CameraRig._build(c));
  }

  // 文档没有 cameras 时返回 null:单视角旧数据,沿用现有单相机路径。
  static fromDoc(raw) {
    return Array.isArray(raw?.cameras) && raw.cameras.length ? new CameraRig(raw.cameras) : null;
  }

  static _build(c) {
    const rot = viewRotation(c.view_rotation_deg ?? 0, c.width, c.height);
    const { fx, fy, cx, cy } = c.cam_K;
    const K = [fx, 0, cx, 0, fy, cy, 0, 0, 1];
    const Kv = mul3(mul3(rot.P, K), transpose3(rot.R));
    const Rv = mul3(rot.R, c.R);
    const tv = mulVec3(rot.R, c.t);
    // 世界(GL) → 视图相机(GL):x = F·(R_view·F·X + t_view)
    const R = mul3(mul3(F, Rv), F);
    const t = mulVec3(F, tv);
    return {
      id: c.id, raw: c, rotationDeg: normalizeRotation(c.view_rotation_deg ?? 0),
      nativeSize: [c.width, c.height], pixelViewFromNative: rot.P, pixelNativeFromView: invertPixel(rot.P),
      width: rot.width, height: rot.height,
      K: { fx: Kv[0], fy: Kv[4], cx: Kv[2], cy: Kv[5] },
      R, t,
    };
  }

  ids() { return [...this._cams.keys()]; }
  has(id) { return this._cams.has(id); }
  // 视图相机:{ id, width, height, K, R(世界→相机,行主序 9), t, rotationDeg, raw }
  view(id) {
    const v = this._cams.get(id);
    if (!v) throw new Error(`未知相机: ${id}`);
    return v;
  }

  worldToCam(id, X) {
    const { R, t } = this.view(id);
    const p = mulVec3(R, X);
    return [p[0] + t[0], p[1] + t[1], p[2] + t[2]];
  }

  // 相机在世界系中的位姿(相机→世界):供 three.js 相机 matrixWorld 使用。
  camToWorld(id) {
    const { R, t } = this.view(id);
    const Rt = transpose3(R);
    const c = mulVec3(Rt, t);
    return { R: Rt, t: [-c[0], -c[1], -c[2]] };
  }

  // 世界点 → 视图像素(转正后画面);相机背后返回 null。约定同 label/src/scene/projection.js。
  project(id, X) {
    const [x, y, z] = this.worldToCam(id, X);
    if (z >= 0) return null;
    const { fx, fy, cx, cy } = this.view(id).K;
    return [fx * x / (-z) + cx, fy * (-y) / (-z) + cy];
  }

  // 像素在「原生(存储)」与「视图(显示)」之间互转。
  viewPixelFromNative(id, uv) { return applyPixel(this.view(id).pixelViewFromNative, uv); }
  nativePixelFromView(id, uv) { return applyPixel(this.view(id).pixelNativeFromView, uv); }

  // bbox [x,y,w,h]:存储用原生像素,显示用视图像素。90° 倍数旋转下轴对齐框仍是轴对齐框。
  bboxViewFromNative(id, b) { return this._mapBox(this.view(id).pixelViewFromNative, b); }
  bboxNativeFromView(id, b) { return this._mapBox(this.view(id).pixelNativeFromView, b); }
  _mapBox(P, [x, y, w, h]) {
    // 角点用像素边界(含 +1)而非像素中心,使框与像素网格精确对应后再变换。
    const a = applyPixel(P, [x, y]);
    const b = applyPixel(P, [x + w - 1, y + h - 1]);
    const x0 = Math.min(a[0], b[0]); const y0 = Math.min(a[1], b[1]);
    return [x0, y0, Math.abs(a[0] - b[0]) + 1, Math.abs(a[1] - b[1]) + 1];
  }
}
