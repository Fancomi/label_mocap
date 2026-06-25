import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseManifest, frameFileName } from '../src/io/manifest.js';

const RAW = {
  format: 'png-sequence', frame_pattern: 'frame_%06d.png', frame_count: 176, fps: 10,
  point_width: 800, point_height: 780, image_width: 800, image_height: 2340,
  png_channel_order: 'RGB_HIGH_MID_LOW', scale: 1000, center: 256,
};

test('parseManifest extracts decode params', () => {
  const m = parseManifest(RAW);
  assert.equal(m.frameCount, 176);
  assert.equal(m.pointWidth, 800);
  assert.equal(m.pointHeight, 780);
  assert.equal(m.scale, 1000);
  assert.equal(m.center, 256);
  assert.equal(m.fps, 10);
});

test('frameFileName formats %06d', () => {
  assert.equal(frameFileName('frame_%06d.png', 0), 'frame_000000.png');
  assert.equal(frameFileName('frame_%06d.png', 175), 'frame_000175.png');
});

test('parseManifest throws on wrong format', () => {
  assert.throws(() => parseManifest({ format: 'avi' }), /png-sequence/);
});

test('parseManifest throws naming each missing required field', () => {
  const bad = { ...RAW }; delete bad.frame_count; delete bad.scale;
  assert.throws(() => parseManifest(bad), /frame_count.*scale|scale.*frame_count/);
});

test('parseManifest throws on frame_count <= 0 (empty sequence not silently黑屏)', () => {
  assert.throws(() => parseManifest({ ...RAW, frame_count: 0 }), /frame_count/);
});
