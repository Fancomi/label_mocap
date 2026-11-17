// label/src/edit/derived.js
import { projectPoint } from '../scene/projection.js';

// joints: flat Float32Array (J*3) in world coords. Returns Array(slots*3).
// Slot k ← skeleton joint jointIdx[k] projected (x, y, conf=2); behind-camera → conf 0; rest 0.
// project: 相机内参 K(单相机,相机在原点)或函数 X → [u,v] | null(多相机等)。
// jointIdx 缺省 = 前 24 个关节(SMPL 旧行为)。
export function reprojectKeypoints(joints, project, slots = 52, jointIdx = null) {
  const proj = typeof project === 'function'
    ? project
    : (X) => (X[2] >= 0 ? null : projectPoint(X, project));
  const idx = jointIdx ?? Array.from({ length: Math.min(24, Math.floor(joints.length / 3)) }, (_, i) => i);
  const out = new Array(slots * 3).fill(0);
  for (let k = 0; k < Math.min(slots, idx.length); k++) {
    const j = idx[k];
    const uv = proj([joints[j * 3], joints[j * 3 + 1], joints[j * 3 + 2]]);
    if (!uv) continue;
    out[k * 3] = uv[0]; out[k * 3 + 1] = uv[1]; out[k * 3 + 2] = 2;
  }
  return out;
}

// 顶点逐个投影后的轴对齐包围框 [x, y, w, h];project(X) → [u,v] | null。全部不可投影返回 null。
export function bboxFromProjected(verts, project) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 2 < verts.length; i += 3) {
    const uv = project([verts[i], verts[i + 1], verts[i + 2]]);
    if (!uv) continue;
    if (uv[0] < x0) x0 = uv[0]; if (uv[1] < y0) y0 = uv[1];
    if (uv[0] > x1) x1 = uv[0]; if (uv[1] > y1) y1 = uv[1];
  }
  return Number.isFinite(x0) ? [x0, y0, x1 - x0, y1 - y0] : null;
}

// 遮挡(纯函数,与原 three Raycaster + FrontSide 语义一致):从相机中心 camPos 向关节发射线,
// 若先碰到一个正面三角形(距离 < 关节距离 − eps)则该槽 = 1。只需「有没有更近的交点」,命中即停。
// vertices: V×3 世界坐标;faces: F×3 索引;slot k ← 关节 jointIdx[k]。
export function occlusionFromMesh(joints, vertices, faces, camPos, slots, jointIdx, eps = 0.02) {
  const nf = faces.length / 3;
  const tri = new Float32Array(nf * 9);   // 每个三角形:v0, e1 = v1−v0, e2 = v2−v0
  for (let f = 0; f < nf; f++) {
    const a = faces[f * 3] * 3, b = faces[f * 3 + 1] * 3, c = faces[f * 3 + 2] * 3, o = f * 9;
    tri[o] = vertices[a]; tri[o + 1] = vertices[a + 1]; tri[o + 2] = vertices[a + 2];
    tri[o + 3] = vertices[b] - vertices[a]; tri[o + 4] = vertices[b + 1] - vertices[a + 1]; tri[o + 5] = vertices[b + 2] - vertices[a + 2];
    tri[o + 6] = vertices[c] - vertices[a]; tri[o + 7] = vertices[c + 1] - vertices[a + 1]; tri[o + 8] = vertices[c + 2] - vertices[a + 2];
  }
  const [ox, oy, oz] = camPos;
  const out = new Array(slots).fill(0);
  for (let k = 0; k < Math.min(slots, jointIdx.length); k++) {
    const j = jointIdx[k];
    let dx = joints[j * 3] - ox, dy = joints[j * 3 + 1] - oy, dz = joints[j * 3 + 2] - oz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6) continue;
    dx /= dist; dy /= dist; dz /= dist;
    const tMax = dist - eps;
    for (let o = 0; o < tri.length; o += 9) {
      const e1x = tri[o + 3], e1y = tri[o + 4], e1z = tri[o + 5], e2x = tri[o + 6], e2y = tri[o + 7], e2z = tri[o + 8];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const DdN = -(dx * nx + dy * ny + dz * nz);   // > 0 ⇔ 正面(three: dir·n < 0)
      if (DdN <= 0) continue;
      const qx = ox - tri[o], qy = oy - tri[o + 1], qz = oz - tri[o + 2];
      // three Ray.intersectTriangle:b1 = D·(Q×e2), b2 = D·(e1×Q), t = Q·N,均乘 sign = −1
      const b1 = -(dx * (qy * e2z - qz * e2y) + dy * (qz * e2x - qx * e2z) + dz * (qx * e2y - qy * e2x));
      if (b1 < 0) continue;
      const b2 = -(dx * (e1y * qz - e1z * qy) + dy * (e1z * qx - e1x * qz) + dz * (e1x * qy - e1y * qx));
      if (b2 < 0 || b1 + b2 > DdN) continue;
      const t = (qx * nx + qy * ny + qz * nz) / DdN;
      if (t >= 0 && t < tMax) { out[k] = 1; break; }
    }
  }
  return out;
}
