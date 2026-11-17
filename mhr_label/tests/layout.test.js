import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutRects, letterbox, bestGrid, hitRect, FREE_SPLIT } from '../src/layout.js';

const PORTRAIT = 9 / 16;
const opts = { camIds: ['zcam1', 'zcam2'], W: 1400, H: 1000, aspect: PORTRAIT };

test('mode A: 3D free view on the left, aligned videos on the right', () => {
  const r = layoutRects('A', opts);
  assert.deepEqual(r.map((x) => x.kind), ['free', 'aligned', 'aligned']);
  assert.equal(r[0].w, FREE_SPLIT);
  assert.ok(r.slice(1).every((x) => x.x >= FREE_SPLIT - 1e-12));
});

test('mode B: two portrait videos go side by side, covering the canvas', () => {
  const r = layoutRects('B', opts);
  assert.deepEqual(r.map((x) => x.camId), ['zcam1', 'zcam2']);
  assert.equal(r[0].y, r[1].y);
  assert.ok(Math.abs(r[0].w + r[1].w - 1) < 1e-12);
});

test('mode C: only the focused camera, falls back to the first', () => {
  assert.deepEqual(layoutRects('C', { ...opts, focusId: 'zcam2' }).map((x) => x.camId), ['zcam2']);
  assert.deepEqual(layoutRects('C', { ...opts, focusId: 'nope' }).map((x) => x.camId), ['zcam1']);
});

test('single camera works in every mode', () => {
  for (const m of ['A', 'B', 'C']) assert.ok(layoutRects(m, { ...opts, camIds: ['zcam2'] }).some((x) => x.camId === 'zcam2'));
});

test('bestGrid stacks landscape images and lines up portrait ones', () => {
  assert.equal(bestGrid(2, 1000, 1000, PORTRAIT).cols, 2);
  assert.equal(bestGrid(2, 1000, 1000, 16 / 9).cols, 1);
});

test('letterbox keeps aspect and stays centred inside the rect', () => {
  const rect = { x: 0.5, y: 0, w: 0.5, h: 1 };
  const b = letterbox(rect, 1000, 1000, PORTRAIT);
  assert.ok(Math.abs((b.w * 1000) / (b.h * 1000) - PORTRAIT) < 1e-9);
  assert.ok(Math.abs(b.x - rect.x - (rect.w - b.w) / 2) < 1e-12);
  assert.equal(hitRect(0.75, 0.5, [rect]), rect);
  assert.equal(hitRect(0.25, 0.5, [rect]), null);
});
