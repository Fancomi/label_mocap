import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  detectOrientation,
  normalizeAnnotationFrame,
  sequenceLabel,
} from '../smpl_viewer/local_data.js';

function validAnnotation(overrides = {}) {
  return {
    image_id: 7,
    root_pos: [1, 2, -5],
    root_rota: [0.1, 0.2, 0.3],
    body_pose: Array(63).fill(0),
    betas: Array(10).fill(0),
    ...overrides,
  };
}

test('normalizeAnnotationFrame maps json_results annotation to SMPL web frame', () => {
  const frame = normalizeAnnotationFrame(validAnnotation(), 3);

  assert.equal(frame.frame, 7);
  assert.deepEqual(frame.root_pos, [1, 2, -5]);
  assert.deepEqual(frame.root_rota, [0.1, 0.2, 0.3]);
  assert.equal(frame.body_pose.length, 63);
  assert.equal(frame.betas.length, 10);
  assert.deepEqual(Object.keys(frame), ['frame', 'root_pos', 'root_rota', 'body_pose', 'betas']);
});

test('normalizeAnnotationFrame falls back to sequence index for missing image id', () => {
  const annotation = validAnnotation();
  delete annotation.image_id;

  assert.equal(normalizeAnnotationFrame(annotation, 3).frame, 3);
});

test('detectOrientation mirrors legacy diving heuristic', () => {
  const wide = Array.from({ length: 60 }, (_, i) => [i, i % 2, -5]);
  const tall = Array.from({ length: 60 }, (_, i) => [i % 2, i, -5]);
  assert.equal(detectOrientation(wide), true);
  assert.equal(detectOrientation(tall), false);
});

test('sequenceLabel matches legacy src/name display', () => {
  assert.equal(sequenceLabel({ src: '10m', name: 'abc', n_frames: 12, portrait: true }), '10m/abc (12f, portrait)');
  assert.equal(sequenceLabel({ src: '10m', name: 'abc', n_frames: 12, portrait: false }), '10m/abc (12f)');
});

test('viewer html loads viewer module from smpl_viewer path', async () => {
  const html = await readFile(new URL('../smpl_viewer/viewer.html', import.meta.url), 'utf8');
  assert.match(html, /src="\/smpl_viewer\/viewer\.js"/);
  assert.doesNotMatch(html, /src="\/viewer\.js"/);
});
