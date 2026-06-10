import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectSrc, verticalFovDeg } from '../src/viewer/camera_modes.js';

test('projectSrc matches diving projection formula', () => {
  const p = projectSrc([0, 1, -10], { fx: 1850, fy: 1850, cx: 960, cy: 540 });
  assert.equal(p[0], 960);
  assert.equal(p[1], 355);
});

test('verticalFovDeg is positive', () => {
  assert.ok(verticalFovDeg(1080, 1850) > 0);
});
