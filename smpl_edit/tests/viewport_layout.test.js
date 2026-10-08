// smpl_edit/tests/viewport_layout.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeRects, hitTest, glRect } from '../viewport_layout.js';

test('single preset → one full-frame rect named main', () => {
  const rects = computeRects('single', { v: 0.7, h: 0.5 });
  assert.equal(rects.length, 1);
  assert.deepEqual(rects[0], { name: 'main', x: 0, y: 0, w: 1, h: 1 });
});

test('tri preset → main left, side top-right, front bottom-right; widths/heights sum to full', () => {
  const rects = computeRects('tri', { v: 0.7, h: 0.5 });
  const main = rects.find((r) => r.name === 'main');
  const side = rects.find((r) => r.name === 'side');
  const front = rects.find((r) => r.name === 'front');
  assert.deepEqual(main, { name: 'main', x: 0, y: 0, w: 0.7, h: 1 });
  assert.equal(side.x, 0.7);
  assert.ok(Math.abs(side.w - 0.3) < 1e-9);
  assert.equal(side.y, 0); assert.ok(Math.abs(side.h - 0.5) < 1e-9);
  assert.ok(Math.abs(front.y - 0.5) < 1e-9); assert.ok(Math.abs(front.h - 0.5) < 1e-9);
});

test('unknown preset falls back to tri', () => {
  const rects = computeRects('whatever', { v: 0.7, h: 0.5 });
  assert.equal(rects.length, 3);
  assert.ok(rects.find((r) => r.name === 'main'));
});

test('hitTest returns the rect name under a normalized point', () => {
  const rects = computeRects('tri', { v: 0.7, h: 0.5 });
  assert.equal(hitTest(0.3, 0.5, rects), 'main');
  assert.equal(hitTest(0.85, 0.2, rects), 'side');
  assert.equal(hitTest(0.85, 0.8, rects), 'front');
});

test('hitTest returns null outside all rects', () => {
  const rects = [{ name: 'main', x: 0, y: 0, w: 0.5, h: 0.5 }];
  assert.equal(hitTest(0.9, 0.9, rects), null);
});

// glRect 的入参必须是 CSS 像素:renderer.setViewport/setScissor 内部再乘 pixelRatio,
// 传绘制缓冲(device)像素会让 scissor 翻倍 → 视图串图。这里锁住翻转与单位契约。
test('glRect maps normalized rect to CSS-pixel GL rect with Y flipped', () => {
  const rects = computeRects('tri', { v: 0.7, h: 0.5 });
  const cssW = 1200, cssH = 800;
  assert.deepEqual(glRect(rects.find((r) => r.name === 'main'), cssW, cssH), { x: 0, y: 0, w: 840, h: 800 });
  // side 在上半(norm y=0)→ GL 底边 y = cssH/2
  assert.deepEqual(glRect(rects.find((r) => r.name === 'side'), cssW, cssH), { x: 840, y: 400, w: 360, h: 400 });
  // front 在下半(norm y=0.5)→ GL 底边 y = 0
  assert.deepEqual(glRect(rects.find((r) => r.name === 'front'), cssW, cssH), { x: 840, y: 0, w: 360, h: 400 });
});

test('glRect stays inside the CSS box at dpr>1 (device px would overflow)', () => {
  const rects = computeRects('tri', { v: 0.7, h: 0.5 });
  const cssW = 1200, cssH = 800, dpr = 2;
  const buffer = { w: cssW * dpr, h: cssH * dpr };
  for (const r of rects) {
    const g = glRect(r, cssW, cssH);
    // 换算到 GL 实际生效的矩形(= 入参 × pixelRatio)后,必须落在绘制缓冲内
    assert.ok(g.x * dpr + g.w * dpr <= buffer.w, `${r.name} overflows x`);
    assert.ok(g.y * dpr + g.h * dpr <= buffer.h, `${r.name} overflows y`);
    // 反向对照:拿绘制缓冲像素当入参(修复前的写法)会溢出
    const bad = glRect(r, buffer.w, buffer.h);
    assert.ok(bad.x * dpr + bad.w * dpr > buffer.w || r.name !== 'main');
  }
});
