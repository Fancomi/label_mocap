// smpl_edit/framing.js
// 取景纯逻辑:人体关节包围 + 「聚焦」相机摆位。无 DOM / 无 three.js。
// F 键聚焦与视角重置都基于此。joints 为 Float32Array(24*3) 世界坐标。
const DIST_FACTOR = 2.4; // 距离 = radius * DIST_FACTOR,使人体充满又留余白

// 人体 AABB 中心 + 包围半径(到中心的最大距离)。null/空返回 null。
export function bodyBounds(joints) {
  if (!joints || joints.length < 3) return null;
  const n = Math.floor(joints.length / 3);
  let minx = Infinity, miny = Infinity, minz = Infinity;
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = joints[i*3], y = joints[i*3+1], z = joints[i*3+2];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  const center = [(minx+maxx)/2, (miny+maxy)/2, (minz+maxz)/2];
  const radius = Math.max(
    Math.hypot(maxx-center[0], maxy-center[1], maxz-center[2]), 1e-3);
  return { center, radius };
}

// 保持相机朝向(position→target 方向),把 target 移到 center,
// 并沿该方向退开 radius*DIST_FACTOR。position==target 时落一个稳定默认方向。
export function focusPlacement(view, center, radius) {
  let dx = view.target[0]-view.position[0];
  let dy = view.target[1]-view.position[1];
  let dz = view.target[2]-view.position[2];
  let L = Math.hypot(dx, dy, dz);
  if (L < 1e-9) { dx = 0; dy = 0; dz = -1; L = 1; } // 退化:默认看向 -Z
  const ux = dx/L, uy = dy/L, uz = dz/L;            // 视线单位向量(由相机指向目标)
  const dist = Math.max(radius, 1e-3) * DIST_FACTOR;
  return {
    target: center.slice(),
    position: [center[0]-ux*dist, center[1]-uy*dist, center[2]-uz*dist],
  };
}
