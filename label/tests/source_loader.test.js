import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFrames, isPortrait } from '../src/io/source_loader.js';

test('union: image-seq + full data → one frame per image, all with annotations', () => {
  const frames = buildFrames({
    background: { kind: 'image_sequence', count: 3 },
    dataFrameIndices: [0, 1, 2],
  });
  assert.equal(frames.length, 3);
  assert.deepEqual(frames.map((f) => f.hasData), [true, true, true]);
  assert.deepEqual(frames.map((f) => f.hasBackground), [true, true, true]);
});

test('image-seq + no data → frames exist, all empty', () => {
  const frames = buildFrames({ background: { kind: 'image_sequence', count: 2 }, dataFrameIndices: [] });
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map((f) => f.hasData), [false, false]);
});

test('no background + data → frame count from max data id + 1', () => {
  const frames = buildFrames({ background: null, dataFrameIndices: [0, 2] });
  assert.equal(frames.length, 3);
  assert.deepEqual(frames.map((f) => f.hasBackground), [false, false, false]);
  assert.deepEqual(frames.map((f) => f.hasData), [true, false, true]);
});

test('partial data over image-seq marks only annotated indices', () => {
  const frames = buildFrames({ background: { kind: 'image_sequence', count: 4 }, dataFrameIndices: [1, 3] });
  assert.deepEqual(frames.map((f) => f.hasData), [false, true, false, true]);
});

test('neither background nor data throws', () => {
  assert.throws(() => buildFrames({ background: null, dataFrameIndices: [] }), /no content/i);
});

test('isPortrait true when image height > width', () => {
  assert.equal(isPortrait({ width: 1080, height: 1920 }), true);
  assert.equal(isPortrait({ width: 1920, height: 1080 }), false);
});

test('frame axis is position-based, not image-id value', () => {
  const frames = buildFrames({ background: { kind: 'image_sequence', count: 3 }, dataFrameIndices: [2] });
  assert.deepEqual(frames.map((f) => f.hasData), [false, false, true]);
});
