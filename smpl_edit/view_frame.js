// smpl_edit/view_frame.js
// 通用「观察坐标系」转换模块(纯函数,无 three.js)。
//
// 职责:把用户选择的「上轴 up + 前轴 front」映射成一组正交单位基,以及由此推导的
// 相机摆位(位置 + up 向量)。它只描述【观察者】如何看世界,绝不旋转任何几何——
// 点云 / SMPL 始终活在原始数据系,本模块产出的只是相机参数。
//
// 约定:
//  - 轴名为 'X' | 'Y' | 'Z'(正方向)。up 与 front 必须是不同的轴(互相垂直)。
//  - right = up × front,构成右手系 {right, up, -front_view};这样相机沿 +front
//    退开看向 target 时,屏幕上「右」= right、「上」= up,左右/上下拖拽方向一致。

const UNIT = { X: [0, 0, 0], Y: [0, 0, 0], Z: [0, 0, 0] };
UNIT.X = [1, 0, 0]; UNIT.Y = [0, 1, 0]; UNIT.Z = [0, 0, 1];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function axisVec(name) {
  const v = UNIT[name];
  if (!v) throw new Error(`unknown axis: ${name}`);
  return v.slice();
}

// 给定上轴,返回与之垂直、可作为前轴的另两个轴(供 UI 下拉联动)。
export const FRONT_OPTIONS = { X: ['Y', 'Z'], Y: ['X', 'Z'], Z: ['X', 'Y'] };

// 上轴/前轴 → 正交基。返回 { up, front, right } 三个单位向量(数据系)。
// up 与 front 必须不同(垂直);否则抛错。
export function viewFrame(up, front) {
  if (up === front) throw new Error(`up and front must differ: ${up}/${front}`);
  const u = axisVec(up);
  const f = axisVec(front);
  const right = cross(u, f);          // 右手:right = up × front
  return { up: u, front: f, right };
}

// 由观察系推导相机摆位。相机沿 +front 退开 target 距离 dist,并沿 +up 抬高一点,
// 得到一个稳定的 3/4 俯视(视线不平行于 up,避免起始即万向锁)。
//  - target: 环绕中心(数据系坐标)[x,y,z]
//  - radius: 点云包围半径,决定退开距离
//  - tilt:   抬高比例(默认 0.35)
// 返回 { position:[x,y,z], up:[x,y,z], target:[x,y,z] }。
export function cameraPlacement(up, front, target, radius, tilt = 0.35) {
  const fr = viewFrame(up, front);
  const r = (Number.isFinite(radius) && radius > 0) ? radius : 1;
  const dist = r * 2.2 + 1;
  const position = add(add(target, scale(fr.front, dist)), scale(fr.up, dist * tilt));
  return { position, up: fr.up.slice(), target: target.slice() };
}

// 工具导出(供需要时复用)。
export const _internal = { cross, dot, sub, add, scale };
