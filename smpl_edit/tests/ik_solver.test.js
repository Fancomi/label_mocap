import assert from 'node:assert/strict';
import { test } from 'node:test';
import { solveTwoBoneIK, shortestArcQuat } from '../ik_solver.js';
import { quatToMat3 } from '../../smpl_core/rotations.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const close = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

const ROOT = [0, 0, 0];
const MID0 = [1, 0, 0];
const END0 = [2, 0, 0];
const POLE = [0, 1, 0];

test('可达目标:末端精确命中 target', () => {
  const target = [1, 1, 0];
  const { mid, end } = solveTwoBoneIK({ root: ROOT, mid: MID0, end: END0, target, pole: POLE });
  close(dist(end, target), 0);
  close(dist(ROOT, mid), 1);
  close(dist(mid, end), 1);
});

test('不等长骨段(a≠b)可达:命中 target 且保持各段长', () => {
  // 上臂长 2,前臂长 1。防止 a↔b 对称的公式写法回归。
  const mid0 = [2, 0, 0];
  const end0 = [3, 0, 0];
  const target = [2, 1.5, 0];
  const { mid, end } = solveTwoBoneIK({ root: ROOT, mid: mid0, end: end0, target, pole: POLE });
  close(dist(end, target), 0);
  close(dist(ROOT, mid), 2);
  close(dist(mid, end), 1);
});

test('不可达(过远):肢体伸直,末端落在 root→target 射线上 a+b 处', () => {
  const target = [10, 0, 0];
  const { mid, end } = solveTwoBoneIK({ root: ROOT, mid: MID0, end: END0, target, pole: POLE });
  close(dist(ROOT, end), 2);
  close(dist(ROOT, mid), 1);
  close(dist(mid, end), 1);
  close(mid[1], 0); close(mid[2], 0);
});

test('过近:clamp 到 |a-b|,无 NaN', () => {
  const target = [0.001, 0, 0];
  const { mid, end } = solveTwoBoneIK({ root: ROOT, mid: MID0, end: END0, target, pole: POLE });
  assert.ok(Number.isFinite(mid[0]) && Number.isFinite(end[0]) && Number.isFinite(mid[1]));
});

test('pole 决定弯曲方向:肘偏向 pole 一侧', () => {
  const target = [1, 0, 0];
  const up = solveTwoBoneIK({ root: ROOT, mid: MID0, end: END0, target, pole: [0, 1, 0] });
  const down = solveTwoBoneIK({ root: ROOT, mid: MID0, end: END0, target, pole: [0, -1, 0] });
  assert.ok(up.mid[1] > 0, `pole+Y 肘应在 +Y: ${up.mid}`);
  assert.ok(down.mid[1] < 0, `pole-Y 肘应在 -Y: ${down.mid}`);
});

test('退化(肩腕重合 / 零臂)不抛错', () => {
  const r = solveTwoBoneIK({ root: ROOT, mid: ROOT, end: ROOT, target: [1, 0, 0], pole: POLE });
  assert.ok(Number.isFinite(r.mid[0]) && Number.isFinite(r.end[0]));
});

test('pole 是方向向量:肢体整体平移、pole 同向平移不变时,肘相对解一致', () => {
  // root 不在原点。pole 作为方向(相对 root 的偏移)传入,弯曲平面应只由方向决定,
  // 不随肢体世界位置漂移。controller 传的就是 sub(mid,root) 这种相对向量。
  const off = [5, -3, 2];
  const at = (p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
  const a = solveTwoBoneIK({ root: ROOT, mid: MID0, end: END0, target: [1, 0, 0], pole: [0, 1, 0] });
  const b = solveTwoBoneIK({ root: at(ROOT), mid: at(MID0), end: at(END0), target: at([1, 0, 0]), pole: [0, 1, 0] });
  // 肘相对各自 root 的偏移应一致(平移不变)
  const relA = [a.mid[0] - ROOT[0], a.mid[1] - ROOT[1], a.mid[2] - ROOT[2]];
  const relB = [b.mid[0] - at(ROOT)[0], b.mid[1] - at(ROOT)[1], b.mid[2] - at(ROOT)[2]];
  close(relA[0], relB[0]); close(relA[1], relB[1]); close(relA[2], relB[2]);
});

test('shortestArcQuat 把单位向量 from 旋到 to', () => {
  const q = shortestArcQuat([1, 0, 0], [0, 1, 0]);
  const m = quatToMat3(q);
  close(m[0], 0); close(m[3], 1); close(m[6], 0);
});

test('shortestArcQuat 同向返回单位四元数', () => {
  const q = shortestArcQuat([1, 0, 0], [2, 0, 0]);
  close(q[0], 0); close(q[1], 0); close(q[2], 0); close(Math.abs(q[3]), 1);
});

test('shortestArcQuat 反向(180°)仍是合法单位四元数', () => {
  const q = shortestArcQuat([1, 0, 0], [-1, 0, 0]);
  close(Math.hypot(q[0], q[1], q[2], q[3]), 1);
});
