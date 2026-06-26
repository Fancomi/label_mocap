import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resizeBboxByCorner, normRect, bboxFromKeypoints } from '../src/bbox_geom.js';

test('resizeBboxByCorner：拖右下角', () => {
  assert.deepEqual(resizeBboxByCorner([10, 10, 20, 20], 'br', [50, 60]), [10, 10, 40, 50]);
});

test('resizeBboxByCorner：拖左上角，对角固定', () => {
  assert.deepEqual(resizeBboxByCorner([10, 10, 20, 20], 'tl', [5, 5]), [5, 5, 25, 25]);
});

test('resizeBboxByCorner：拖动越过对角仍得正矩形', () => {
  assert.deepEqual(resizeBboxByCorner([10, 10, 20, 20], 'br', [0, 0]), [0, 0, 10, 10]);
});

test('normRect：两点 → [x,y,w,h]，规整顺序', () => {
  assert.deepEqual(normRect(50, 60, 10, 20), [10, 20, 40, 40]);
});

test('bboxFromKeypoints：取 v>0 点包围盒 + 边距，裁到图像内（minPad=0 时按比例）', () => {
  const kpts = [[20, 30, 2], [60, 80, 1], [0, 0, 0], [10, 10, 0]];
  // 可见点 x:[20,60] y:[30,80]，margin 0.05 → mx=2 my=2.5；minPad=0 取消下限
  const b = bboxFromKeypoints(kpts, { width: 200, height: 200, margin: 0.05, minPad: 0 });
  assert.deepEqual(b, [18, 27.5, 44, 55]);
});

test('bboxFromKeypoints：边距裁剪不出界', () => {
  const kpts = [[0, 0, 2], [200, 200, 2]];
  const b = bboxFromKeypoints(kpts, { width: 200, height: 200, margin: 0.5 });
  assert.deepEqual(b, [0, 0, 200, 200]);
});

test('bboxFromKeypoints：单点/共线退化也得正宽高（minPad 保底）', () => {
  // 单点：跨度 0，minPad=4 → 8×8 框，中心仍在点上
  assert.deepEqual(bboxFromKeypoints([[50, 80, 2]], { width: 1000, height: 1000 }), [46, 76, 8, 8]);
  // 竖直共线：x 跨度 0 → 宽度由 minPad 撑出正值
  const b = bboxFromKeypoints([[50, 80, 2], [50, 200, 1]], { width: 1000, height: 1000 });
  assert.ok(b[2] > 0 && b[3] > 0, `degenerate bbox must be non-zero: ${b}`);
});

test('bboxFromKeypoints：无可见点返回 null', () => {
  assert.equal(bboxFromKeypoints([[1, 2, 0], [3, 4, 0]], { width: 100, height: 100 }), null);
});
