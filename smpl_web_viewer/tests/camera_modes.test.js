import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectSrc, verticalFovDeg, viewOffsetForCamera } from '../src/viewer/camera_modes.js';

test('projectSrc matches diving projection formula', () => {
  const p = projectSrc([0, 1, -10], { fx: 1850, fy: 1850, cx: 960, cy: 540 });
  assert.equal(p[0], 960);
  assert.equal(p[1], 355);
});

test('verticalFovDeg is positive', () => {
  assert.ok(verticalFovDeg(1080, 1850) > 0);
});

test('projectSrc rejects points behind or on the camera plane', () => {
  assert.throws(
    () => projectSrc([0, 1, 0], { fx: 1850, fy: 1850, cx: 960, cy: 540 }),
    /points behind camera \(Z>=0\) cannot be projected in src coords/
  );
  assert.throws(
    () => projectSrc([0, 1, 1], { fx: 1850, fy: 1850, cx: 960, cy: 540 }),
    /points behind camera \(Z>=0\) cannot be projected in src coords/
  );
});

test('verticalFovDeg requires positive finite inputs', () => {
  for (const args of [[0, 1850], [-1, 1850], [1080, 0], [1080, -1], [Infinity, 1850], [1080, NaN]]) {
    assert.throws(() => verticalFovDeg(...args), /positive finite/);
  }
});

test('viewOffsetForCamera handles non-centered principal point', () => {
  assert.deepEqual(viewOffsetForCamera(1920, 1080, { cx: 900, cy: 500 }), {
    fullWidth: 1920,
    fullHeight: 1080,
    x: 60,
    y: 40,
    width: 1920,
    height: 1080,
  });
});
