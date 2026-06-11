import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  detectOrientation,
  loadLocalA1SequenceFromFileList,
  loadLocalA1SequenceFromFiles,
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

test('viewer html uses relative paths for pages subdirectory hosting', async () => {
  const html = await readFile(new URL('../smpl_viewer/viewer.html', import.meta.url), 'utf8');
  assert.match(html, /src="\.\/viewer\.js"/);
  assert.match(html, /"three": "\.\/vendor\/three\.module\.js"/);
  assert.doesNotMatch(html, /src="\/viewer\.js"/);
  assert.doesNotMatch(html, /"\/smpl_viewer\//);
  assert.doesNotMatch(html, /"\/smpl_web_viewer\//);
});

test('file-list loader reads selected a1 directory without directory handles', async () => {
  const files = [
    fakeFile('a1/json_results/player_0/player_0.json', JSON.stringify({
      annotations: [validAnnotation({ image_id: 0 }), validAnnotation({ image_id: 1 })],
    })),
    fakeFile('a1/images/000001.jpg', 'jpg-1'),
    fakeFile('a1/images/000002.jpg', 'jpg-2'),
  ];

  const seq = await loadLocalA1SequenceFromFileList(files);
  assert.equal(seq.name, 'a1');
  assert.equal(seq.n_frames, 2);
  assert.equal(seq.images.length, 2);
  assert.deepEqual(seq.frames.map((frame) => frame.frame), [0, 1]);
});

test('file-list loader accepts manually selected json and images', async () => {
  const files = [
    fakeFile('', JSON.stringify({ annotations: [validAnnotation({ image_id: 4 })] }), 'player_0.json'),
    fakeFile('', 'jpg-1', '000001.jpg'),
  ];

  const seq = await loadLocalA1SequenceFromFileList(files);
  assert.equal(seq.name, 'sequence');
  assert.equal(seq.n_frames, 1);
  assert.equal(seq.images.length, 1);
  assert.equal(seq.frames[0].frame, 4);
});

test('separate-file loader accepts json and image selections', async () => {
  const json = fakeFile('', JSON.stringify({ records: [validAnnotation({ image_id: 9 })] }), 'player_0.json');
  const images = [
    fakeFile('', 'jpg-2', '000002.jpg'),
    fakeFile('', 'jpg-1', '000001.jpg'),
    fakeFile('', 'ignore', 'notes.txt'),
  ];

  const seq = await loadLocalA1SequenceFromFiles(json, images);
  assert.equal(seq.name, 'sequence');
  assert.equal(seq.n_frames, 1);
  assert.deepEqual(seq.images.map((file) => file.name), ['000001.jpg', '000002.jpg']);
  assert.equal(seq.frames[0].frame, 9);
});

function fakeFile(path, text, name = path.split('/').at(-1)) {
  return {
    name,
    webkitRelativePath: path,
    async text() {
      return text;
    },
  };
}
