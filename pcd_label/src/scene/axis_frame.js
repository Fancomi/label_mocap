// pcd_label/src/scene/axis_frame.js
// 数据坐标系 → three.js 显示系（up=+Y, front=-Z, right=+X）的基变换。
const UNIT = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
export const AXIS_OPTIONS = { Z: ['X', 'Y'], Y: ['X', 'Z'] };

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function axisFrameMatrix(up, front) {
  const u = UNIT[up];
  const f = UNIT[front];
  const right = cross(f, u);
  const negF = [-f[0], -f[1], -f[2]];
  return [
    right[0], right[1], right[2],
    u[0], u[1], u[2],
    negF[0], negF[1], negF[2],
  ];
}

export function applyMat3(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
  ];
}
