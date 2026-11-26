import assert from 'node:assert/strict';
import { test } from 'node:test';
import { viewPixelFromNative, nativePixelFromView, viewIntrinsics, rollQuat } from '../view_roll.js';

const K = { fx: 1500, fy: 1480, cx: 951, cy: 532 };
const W = 1920, H = 1080;
const close = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

// GL 相机系点 → 像素(同 label/src/scene/projection.js)
const project = ([x, y, z], k) => [k.fx * x / -z + k.cx, k.fy * -y / -z + k.cy];
// 四元数旋转向量
const rot = ([qx, qy, qz, qw], [x, y, z]) => {
  const cx = qy * z - qz * y, cy = qz * x - qx * z, cz = qx * y - qy * x;
  return [x + 2 * (qw * cx + qy * cz - qz * cy), y + 2 * (qw * cy + qz * cx - qx * cz), z + 2 * (qw * cz + qx * cy - qy * cx)];
};
const conj = ([x, y, z, w]) => [-x, -y, -z, w];

test('pixel mapping round-trips for every quarter turn', () => {
  for (let n = 0; n < 4; n++) {
    const [x, y] = viewPixelFromNative(n, 123.5, 456.25, W, H);
    const [u, v] = nativePixelFromView(n, x, y, W, H);
    close(u, 123.5); close(v, 456.25);
  }
  assert.deepEqual(viewPixelFromNative(1, 0, 0, W, H), [H, 0]);   // 原生左上 → 顺时针后在右上
});

test('rendering through the rolled camera + rotated K == rotating the native pixel (render/overlay agree)', () => {
  const pts = [[0.3, -0.2, -4], [-1.1, 0.7, -6], [0.05, 0.4, -2.5]];
  for (let n = 0; n < 4; n++) {
    const Kv = viewIntrinsics(n, K, W, H);
    const qInv = conj(rollQuat(n));                       // 相机转 q → 点在新相机系 = q⁻¹·p
    for (const p of pts) {
      const viaRoll = project(rot(qInv, p), Kv);
      const native = project(p, K);
      const viaPixel = viewPixelFromNative(n, native[0], native[1], W, H);
      close(viaRoll[0], viaPixel[0], 1e-6); close(viaRoll[1], viaPixel[1], 1e-6);
    }
    assert.deepEqual([Kv.w, Kv.h], n % 2 ? [H, W] : [W, H]);
  }
});
