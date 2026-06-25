// smpl_edit/tests/viewport_layout.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeRects, hitTest } from '../viewport_layout.js';

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
