// smpl_edit/tests/view_frame.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { viewFrame, cameraPlacement, axisVec, axisName, FRONT_OPTIONS } from '../view_frame.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const vclose = (a, b) => a.forEach((v, i) => close(v, b[i]));
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('viewFrame Z-up/X-front: right = up × front is right-handed', () => {
  const { up, front, right } = viewFrame('Z', 'X');
  vclose(up, [0, 0, 1]);
  vclose(front, [1, 0, 0]);
  vclose(right, [0, 1, 0]); // cross([0,0,1],[1,0,0]) = [0,1,0]
});

test('viewFrame basis is orthonormal for every valid up/front pair', () => {
  for (const [up, fronts] of Object.entries(FRONT_OPTIONS)) {
    for (const front of fronts) {
      const { up: u, front: f, right: r } = viewFrame(up, front);
      close(len(u), 1); close(len(f), 1); close(len(r), 1);
      close(dot(u, f), 0); close(dot(u, r), 0); close(dot(f, r), 0);
    }
  }
});

test('viewFrame throws when up === front', () => {
  assert.throws(() => viewFrame('Z', 'Z'), /differ/);
});

test('cameraPlacement: camera sits on +front side of target, raised along +up', () => {
  const target = [10, 20, 30];
  const { position, up, target: t } = cameraPlacement('Z', 'X', target, 2);
  vclose(t, target);
  vclose(up, [0, 0, 1]);
  // along +front(=+X) the camera x must exceed target x; along +up(=+Z) z must exceed
  assert.ok(position[0] > target[0], 'camera pulled back along +front (X)');
  assert.ok(position[2] > target[2], 'camera raised along +up (Z)');
});

test('cameraPlacement distance grows with radius', () => {
  const t = [0, 0, 0];
  const near = cameraPlacement('Y', 'Z', t, 1).position;
  const far = cameraPlacement('Y', 'Z', t, 10).position;
  assert.ok(Math.hypot(...far) > Math.hypot(...near));
});

test('axisVec returns unit axis, throws on unknown', () => {
  vclose(axisVec('Y'), [0, 1, 0]);
  assert.throws(() => axisVec('W'), /unknown axis/);
});

test('axisName returns the dominant-abs axis letter (inverse of axisVec)', () => {
  assert.equal(axisName([0, 1, 0]), 'Y');
  assert.equal(axisName([-0.98, 0.1, 0.05]), 'X'); // 近似轴仍判 X
  assert.equal(axisName([0.1, 0.2, -0.9]), 'Z');
});
