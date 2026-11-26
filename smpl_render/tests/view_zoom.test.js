import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeWindow, zoomAtSolve, imageToCanvasNorm, canvasNormToImage, clampPan } from '../view_zoom.js';

const K = { imageW: 1920, imageH: 1080, cx: 960, cy: 540 };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('z=1 窗口 = 基准窗口(主点居中时左上为 0、全尺寸)', () => {
  const w = computeWindow({ ...K, zoom: 1, panX: 0, panY: 0 });
  close(w.winX, 0); close(w.winY, 0); close(w.winW, 1920); close(w.winH, 1080);
});

test('主点偏移时 z=1 窗口左上 = imageW/2−cx', () => {
  const w = computeWindow({ imageW: 1920, imageH: 1080, cx: 900, cy: 500, zoom: 1, panX: 0, panY: 0 });
  close(w.winX, 60); close(w.winY, 40);
});

test('z=2 窗口为半尺寸,pan=0 时贴基准左上', () => {
  const w = computeWindow({ ...K, zoom: 2, panX: 0, panY: 0 });
  close(w.winW, 960); close(w.winH, 540);
  close(w.winX, 0); close(w.winY, 0);
});

test('pan 钳制:窗口不超出基准窗口右/下边界', () => {
  const w = computeWindow({ ...K, zoom: 2, panX: 5000, panY: 5000 });
  close(w.winX, 960); close(w.winY, 540);
});

test('pan 钳制:不超出左/上边界', () => {
  const w = computeWindow({ ...K, zoom: 2, panX: -5000, panY: -5000 });
  close(w.winX, 0); close(w.winY, 0);
});

test('imageToCanvasNorm / canvasNormToImage round-trip', () => {
  const win = computeWindow({ ...K, zoom: 3, panX: 200, panY: 100 });
  const [u, v] = imageToCanvasNorm(1000, 600, win);
  const [ix, iy] = canvasNormToImage(u, v, win);
  close(ix, 1000); close(iy, 600);
});

test('zoomAtSolve:在 (u,v) 处放大,该图像点缩放后仍落在同一 (u,v)', () => {
  const before = computeWindow({ ...K, zoom: 1, panX: 0, panY: 0 });
  const u = 0.3, v = 0.7;
  const [ix, iy] = canvasNormToImage(u, v, before);
  const { panX, panY } = zoomAtSolve({ ...K, zoom: 1, panX: 0, panY: 0, u, v, factor: 2 });
  const after = computeWindow({ ...K, zoom: 2, panX, panY });
  const [u2, v2] = imageToCanvasNorm(ix, iy, after);
  close(u2, u, 1e-4); close(v2, v, 1e-4);
});

test('zoom 钳制在 [1, 8]', () => {
  const lo = zoomAtSolve({ ...K, zoom: 1, panX: 0, panY: 0, u: 0.5, v: 0.5, factor: 0.5 });
  assert.equal(lo.zoom, 1);
  const hi = zoomAtSolve({ ...K, zoom: 8, panX: 0, panY: 0, u: 0.5, v: 0.5, factor: 2 });
  assert.equal(hi.zoom, 8);
});

test('clampPan 把越界 pan 收敛到有效区间(消除死区);幂等', () => {
  const a = clampPan({ ...K, zoom: 2, panX: 99999, panY: 99999 });
  // z=2、主点居中:窗口半尺寸,有效 pan 上限 = imageW − winW = 960(基准左上为 0)
  close(a.panX, 960); close(a.panY, 540);
  const b = clampPan({ ...K, zoom: 2, panX: a.panX, panY: a.panY });
  close(b.panX, a.panX); close(b.panY, a.panY); // 幂等:已钳制的值再钳不变
  const lo = clampPan({ ...K, zoom: 2, panX: -99999, panY: -99999 });
  close(lo.panX, 0); close(lo.panY, 0);
});

test('角落放大:zoomAtSolve 越界 pan 经 clampPan 收敛到有效区间', () => {
  const r = zoomAtSolve({ ...K, zoom: 1, panX: 0, panY: 0, u: 0, v: 0, factor: 2 });
  const c = clampPan({ ...K, zoom: r.zoom, panX: r.panX, panY: r.panY });
  // 主点居中、z=2:有效 pan ∈ [0, 960]×[0,540];左上角放大定点应收敛到 0
  close(c.panX, 0); close(c.panY, 0);
});

test('cover(aspect): portrait image in a wide canvas fills width, crops height, can zoom out to the whole image', async () => {
  const { zoomRange, centeredPan } = await import('../view_zoom.js');
  const P = { imageW: 1080, imageH: 1920, cx: 540, cy: 960, aspect: 1.6 };
  const c = centeredPan(P);
  const w = computeWindow({ ...P, zoom: 1, ...c });
  close(w.winW, 1080); close(w.winH, 1080 / 1.6);
  close(w.winY, (1920 - 1080 / 1.6) / 2);                       // 默认居中
  const [zmin] = zoomRange(P);
  close(zmin, (1080 / 1.6) / 1920);
  const out = computeWindow({ ...P, zoom: zmin, panX: 999, panY: 999 });
  close(out.winH, 1920); assert.ok(out.winW > 1080);            // 看到整幅,横向超出部分居中
  close(out.winX, (1080 - out.winW) / 2);
  const z = zoomAtSolve({ ...P, zoom: 1, ...c, u: 0.5, v: 0.5, factor: 0.01 });
  close(z.zoom, zmin);
});

test('aspect omitted keeps the contain behaviour exactly', () => {
  const a = computeWindow({ ...K, zoom: 2, panX: 100, panY: 50 });
  const b = computeWindow({ ...K, zoom: 2, panX: 100, panY: 50, aspect: undefined });
  assert.deepEqual(a, b);
});
