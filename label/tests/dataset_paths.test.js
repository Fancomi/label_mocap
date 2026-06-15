import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyEntries, DATA_JSON_PATH } from '../src/io/dataset_paths.js';

test('canonical data json path is json_results/player_0/player_0.json', () => {
  assert.equal(DATA_JSON_PATH, 'json_results/player_0/player_0.json');
});

test('classify finds json, sorted images, and no video', () => {
  const r = classifyEntries([
    'json_results/player_0/player_0.json',
    'images/0001.jpg', 'images/0000.jpg', 'images/0002.jpg',
  ]);
  assert.equal(r.jsonPath, 'json_results/player_0/player_0.json');
  assert.deepEqual(r.imagePaths, ['images/0000.jpg', 'images/0001.jpg', 'images/0002.jpg']);
  assert.equal(r.videoPath, null);
});

test('classify finds a single video and no images', () => {
  const r = classifyEntries(['clip.mp4']);
  assert.equal(r.videoPath, 'clip.mp4');
  assert.deepEqual(r.imagePaths, []);
  assert.equal(r.jsonPath, null);
});

test('image-only folder: jsonPath null but writeJsonPath is the canonical target', () => {
  const r = classifyEntries(['images/0000.jpg', 'images/0001.jpg']);
  assert.equal(r.jsonPath, null);
  assert.equal(r.writeJsonPath, 'json_results/player_0/player_0.json');
});

test('images may sit at the directory root (no images/ prefix)', () => {
  const r = classifyEntries(['0000.jpg', '0001.jpg']);
  assert.deepEqual(r.imagePaths, ['0000.jpg', '0001.jpg']);
});

test('prefers mp4 over other video extensions, ignores non-media', () => {
  const r = classifyEntries(['a.mp4', 'notes.txt', 'b.webm']);
  assert.equal(r.videoPath, 'a.mp4');
});

test('images sort numerically, not lexicographically (2 before 10)', () => {
  const r = classifyEntries(['images/10.jpg', 'images/2.jpg', 'images/1.jpg']);
  assert.deepEqual(r.imagePaths, ['images/1.jpg', 'images/2.jpg', 'images/10.jpg']);
});
