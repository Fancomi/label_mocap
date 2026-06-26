import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fitScale, scaleOf, clampCenter, transform, screenToImg, imgToScreen, zoomAt, ZOOM_MIN,
} from '../src/viewport.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// 视口 800×600，图像 1600×600（宽图）：fit 受宽限制 → 0.5；短边(高)留白。
const V = { vw: 800, vh: 600, imgW: 1600, imgH: 600 };

test('fitScale：长边顶边，取较小比例', () => {
  close(fitScale(800, 600, 1600, 600), 0.5);    // 宽限制
  close(fitScale(600, 800, 600, 1600), 0.5);    // 高限制（竖图）
});

test('zoom=1 时 scale=fit，中心锁图像中心', () => {
  close(scaleOf(V.vw, V.vh, V.imgW, V.imgH, 1), 0.5);
  // 短边(高 600×0.5=300<600)锁中线 cy=300；长边(宽 1600×0.5=800=vw)锁中线 cx=800
  const c = clampCenter({ ...V, zoom: 1, cx: 0, cy: 0 });
  close(c.cx, 800); close(c.cy, 300);
});

test('transform + 互逆映射', () => {
  const t = transform({ ...V, zoom: 1, cx: 800, cy: 300 });
  close(t.scale, 0.5);
  // 图像中心 → 视口中心
  const [sx, sy] = imgToScreen(800, 300, t);
  close(sx, 400); close(sy, 300);
  const [ix, iy] = screenToImg(sx, sy, t);
  close(ix, 800); close(iy, 300);
});

test('放大后短边可平移覆盖（不再被 fit 窗口切割）', () => {
  // zoom=2 → scale=1，图像 1600×600，视口 800×600：两轴都比视口大，可平移。
  const z = 2;
  // 想看图像左上角附近：中心点 (200,150)，钳制后应允许（half=400/300，落在 [400, ...] ? ）
  const c = clampCenter({ ...V, zoom: z, cx: 0, cy: 0 });
  // scale=1：halfW=400 → cx∈[400,1200]；halfH=300 → cy∈[300,300]（600×1=600=vh 恰好锁中线）
  close(c.cx, 400); close(c.cy, 300);
  const c2 = clampCenter({ ...V, zoom: z, cx: 9999, cy: 9999 });
  close(c2.cx, 1200); close(c2.cy, 300);
});

test('clampCenter：图像小于视口的轴锁中线、大于的轴限定无黑边', () => {
  // zoom=1，高 300<600 → cy 永远锁 300，无论传入
  for (const cy of [-100, 0, 5000]) {
    close(clampCenter({ ...V, zoom: 1, cx: 800, cy }).cy, 300);
  }
});

test('zoomAt：光标下的图像点缩放后保持不动', () => {
  const st = { ...V, zoom: 1, cx: 800, cy: 300 };
  const t0 = transform(st);
  const sx = 200, sy = 150;
  const before = screenToImg(sx, sy, t0);
  const next = zoomAt(st, sx, sy, 2);
  const t1 = transform({ ...V, ...next });
  const after = screenToImg(sx, sy, t1);
  close(after[0], before[0]); close(after[1], before[1]);
  close(next.zoom, 2);
});

test('ZOOM_MIN=1（fit 为最小，不会缩得比贴边更小）', () => {
  const next = zoomAt({ ...V, zoom: 1, cx: 800, cy: 300 }, 400, 300, 0.1);
  close(next.zoom, ZOOM_MIN);
});
