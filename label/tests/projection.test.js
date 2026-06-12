import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectPoint, bboxFromPoints } from '../src/scene/projection.js';

const K = { fx: 1850, fy: 1850, cx: 960, cy: 540 };

test('projectPoint maps a point in front of the camera to pixels', () => {
  const [u, v] = projectPoint([0, 0, -4], K);
  assert.ok(Math.abs(u - 960) < 1e-6);
  assert.ok(Math.abs(v - 540) < 1e-6);
});

test('projectPoint flips Y (up) to image-down', () => {
  const [, v] = projectPoint([0, 1, -4], K);
  assert.ok(v < 540);
});

test('projectPoint throws for points at or behind the camera', () => {
  assert.throws(() => projectPoint([0, 0, 0], K), /behind camera/);
  assert.throws(() => projectPoint([0, 0, 1], K), /behind camera/);
});

test('bboxFromPoints returns [x, y, w, h] enclosing all projected verts', () => {
  const verts = new Float32Array([-0.5, 0.5, -4, 0.5, -0.5, -4]);
  const bbox = bboxFromPoints(verts, K);
  const [x, y, w, h] = bbox;
  assert.ok(w > 0 && h > 0);
  assert.ok(Math.abs((x + w / 2) - 960) < 1e-3);
  assert.ok(Math.abs((y + h / 2) - 540) < 1e-3);
});
