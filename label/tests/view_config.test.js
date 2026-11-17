import assert from 'node:assert/strict';
import { test } from 'node:test';
import { viewConfigOf } from '../src/io/view_config.js';

const ORB1 = {
  id: 'orb1', width: 1280, height: 720, cam_K: { fx: 749, fy: 749.1, cx: 635, cy: 355.6 },
  R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], view_rotation_deg: 90, video: 'x_orb1.mp4', fps: 30,
};
const doc = {
  info: { body_model: 'mhr' }, cameras: [ORB1, { ...ORB1, id: 'zcam2', fps: 60, video: 'x_zcam2.mp4' }],
  images: [{ id: 0, views: { orb1: 0, zcam2: null } }, { id: 1, views: { orb1: 1, zcam2: 3 } }, { id: 2 }],
};

test('single-view docs have no view config (legacy path)', () => {
  assert.equal(viewConfigOf({ images: [] }), null);
});

test('primary camera comes from cameras[0] with upright size and data-driven video/fps', () => {
  const c = viewConfigOf(doc);
  assert.equal(c.cameraId, 'orb1');
  assert.deepEqual([c.width, c.height], [720, 1280]);
  assert.equal(c.rotationDeg, 90);
  assert.equal(c.video, 'x_orb1.mp4');
  assert.equal(c.fps, 30);
  assert.ok(c.pose.t.every((x) => Math.abs(x) < 1e-12));
});

test('decodeIndex follows images[].views, falls back to position, keeps null gaps', () => {
  const side = viewConfigOf(doc, 'zcam2');
  assert.equal(side.decodeIndex(0), null);
  assert.equal(side.decodeIndex(1), 3);
  assert.equal(side.decodeIndex(2), 2);
});

test('projectNative returns native (unrotated) pixels', () => {
  const c = viewConfigOf(doc);
  const X = [0.1, -0.2, -3];   // GL 世界 = orb1 相机系
  const [u, v] = c.projectNative(X);
  assert.ok(Math.abs(u - (749 * 0.1 / 3 + 635)) < 1e-6);
  assert.ok(Math.abs(v - (749.1 * 0.2 / 3 + 355.6)) < 1e-6);
  assert.equal(c.projectNative([0, 0, 1]), null);
});
