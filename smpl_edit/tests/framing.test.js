// smpl_edit/tests/framing.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bodyBounds, focusPlacement, relativeBearing, placeFromBearing } from '../framing.js';

const j = (pts) => { const a = new Float32Array(24 * 3); pts.forEach(([i, x, y, z]) => { a[i*3]=x; a[i*3+1]=y; a[i*3+2]=z; }); return a; };

test('bodyBounds returns center + radius over non-zero joints', () => {
  const joints = j([[0, 0, 0, 0], [1, 2, 0, 0]]);
  const b = bodyBounds(joints);
  assert.ok(b);
  assert.equal(b.center.length, 3);
  assert.ok(b.radius > 0);
});

test('bodyBounds centers on the AABB midpoint', () => {
  const joints = j([[0, -1, -1, -1], [1, 3, 5, 7]]);
  const b = bodyBounds(joints);
  assert.deepEqual(b.center.map((v) => Math.round(v)), [1, 2, 3]);
});

test('bodyBounds returns null for null/empty joints', () => {
  assert.equal(bodyBounds(null), null);
  assert.equal(bodyBounds(new Float32Array(0)), null);
});

test('focusPlacement keeps direction, moves target to center, scales distance with radius', () => {
  const view = { position: [0, 0, 10], target: [0, 0, 0] };
  const out = focusPlacement(view, [1, 1, 1], 2);
  assert.deepEqual(out.target, [1, 1, 1]);
  const dir = [out.target[0]-out.position[0], out.target[1]-out.position[1], out.target[2]-out.position[2]];
  const L = Math.hypot(...dir);
  assert.ok(Math.abs(dir[0]/L - 0) < 1e-9 && Math.abs(dir[1]/L - 0) < 1e-9 && Math.abs(dir[2]/L + 1) < 1e-9);
  assert.ok(L > 2);
});

test('focusPlacement falls back to a default direction when position==target', () => {
  const out = focusPlacement({ position: [5, 5, 5], target: [5, 5, 5] }, [0, 0, 0], 1);
  assert.deepEqual(out.target, [0, 0, 0]);
  assert.ok(Number.isFinite(out.position[0]) && Number.isFinite(out.position[1]) && Number.isFinite(out.position[2]));
  const d = Math.hypot(out.position[0], out.position[1], out.position[2]);
  assert.ok(d > 0);
});

test('relativeBearing returns unit direction (target→cam) and distance', () => {
  const b = relativeBearing([0, 0, 10], [0, 0, 0]);
  assert.ok(Math.abs(b.dir[0]) < 1e-9 && Math.abs(b.dir[1]) < 1e-9 && Math.abs(b.dir[2] - 1) < 1e-9);
  assert.ok(Math.abs(b.dist - 10) < 1e-9);
});

test('placeFromBearing reconstructs the camera position from center+bearing', () => {
  const b = relativeBearing([3, 4, 0], [0, 0, 0]); // dist 5, dir (0.6,0.8,0)
  const out = placeFromBearing(b, [1, 1, 1]);
  assert.ok(Math.hypot(out.position[0]-4, out.position[1]-5, out.position[2]-1) < 1e-6);
  assert.deepEqual(out.target, [1, 1, 1]);
});

test('relativeBearing degenerate (cam==target) falls back to +Z dir, dist>0', () => {
  const b = relativeBearing([2, 2, 2], [2, 2, 2]);
  assert.equal(b.dir.length, 3);
  assert.ok(b.dist > 0);
  assert.ok(Number.isFinite(b.dir[0]) && Number.isFinite(b.dir[1]) && Number.isFinite(b.dir[2]));
});
