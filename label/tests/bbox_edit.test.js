import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resizeBboxByCorner, projectBboxFromMesh } from '../src/edit/bbox_edit.js';

test('dragging the top-left corner updates x,y,w,h keeping opposite corner fixed', () => {
  const bbox = [100, 100, 200, 200]; // corners: TL(100,100) BR(300,300)
  const out = resizeBboxByCorner(bbox, 'tl', [120, 130]);
  assert.deepEqual(out, [120, 130, 180, 170]); // BR stays at 300,300
});

test('dragging bottom-right corner updates only w,h', () => {
  const bbox = [100, 100, 200, 200];
  const out = resizeBboxByCorner(bbox, 'br', [350, 360]);
  assert.deepEqual(out, [100, 100, 250, 260]);
});

test('resize normalizes so width/height stay non-negative', () => {
  const bbox = [100, 100, 200, 200];
  const out = resizeBboxByCorner(bbox, 'br', [50, 50]); // dragged past TL
  const [x, y, w, h] = out;
  assert.ok(w >= 0 && h >= 0);
  assert.equal(x, 50); assert.equal(y, 50);
});

test('projectBboxFromMesh returns a bbox enclosing projected verts', () => {
  const K = { fx: 1850, fy: 1850, cx: 960, cy: 540 };
  const verts = new Float32Array([-0.5, 0.5, -4, 0.5, -0.5, -4]);
  const bbox = projectBboxFromMesh(verts, K);
  assert.equal(bbox.length, 4);
  assert.ok(bbox[2] > 0 && bbox[3] > 0);
});
