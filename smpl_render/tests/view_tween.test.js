import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frustumOf, extendFrustum, lerpFrustum, viewOffsetFor } from '../view_tween.js';

const near = (a, b) => {
  for (const k of ['l', 'r', 't', 'b']) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${k}: ${a[k]} != ${b[k]}`);
};

test('viewOffsetFor reproduces an asymmetric frustum through the three.js formula', () => {
  const f = { l: -0.31, r: 0.52, t: 0.4, b: -0.12 };
  const o = viewOffsetFor(f);
  near(frustumOf({ fov: o.fov, aspect: 1, view: { fullWidth: 2, fullHeight: 2, offsetX: o.x, offsetY: o.y, width: o.w, height: o.h } }), f);
});

test('extendFrustum keeps every on-screen pixel of the sub-rect fixed', () => {
  // 2D 画布(16:9 竖向留边居中)里缩放后的窗口,铺到 1:1 容器上。
  const f = frustumOf({ fov: 30, aspect: 16 / 9, view: { fullWidth: 1920, fullHeight: 1080, offsetX: 400, offsetY: 200, width: 960, height: 540 } });
  const rect = { x0: 0, y0: 0.21875, x1: 1, y1: 0.78125 };
  const e = extendFrustum(f, rect);
  // 子矩形内的点 (u, v) 在两种画法下射线方向一致。
  for (const [u, v] of [[0.2, 0.3], [0.9, 0.7]]) {
    const su = (u - rect.x0) / (rect.x1 - rect.x0), sv = (v - rect.y0) / (rect.y1 - rect.y0);
    assert.ok(Math.abs((f.l + su * (f.r - f.l)) - (e.l + u * (e.r - e.l))) < 1e-12);
    assert.ok(Math.abs((f.t - sv * (f.t - f.b)) - (e.t - v * (e.t - e.b))) < 1e-12);
  }
  near(extendFrustum(f, { x0: 0, y0: 0, x1: 1, y1: 1 }), f);
});

test('lerpFrustum hits both ends', () => {
  const a = { l: -1, r: 1, t: 0.5, b: -0.5 }, b = { l: -0.2, r: 0.4, t: 0.3, b: 0 };
  near(lerpFrustum(a, b, 0), a);
  near(lerpFrustum(a, b, 1), b);
});
