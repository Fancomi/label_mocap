import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyEntries, DATA_JSON_PATH, basename } from '../src/io/dataset_paths.js';

test('canonical diving json path constant', () => {
  assert.equal(DATA_JSON_PATH, 'json_results/player_0/player_0.json');
});

test('existing diving json → save in place to it', () => {
  const r = classifyEntries(['images/0000.jpg', 'images/0001.jpg', 'json_results/player_0/player_0.json'], { rootName: 'test_data' });
  assert.equal(r.jsonPath, 'json_results/player_0/player_0.json');
  assert.equal(r.writeJsonPath, 'json_results/player_0/player_0.json');
});

test('images subfolder, no json → sibling <subfolder>.json at parent root', () => {
  const r = classifyEntries(['images/0000.jpg', 'images/0001.jpg'], { rootName: 'datas' });
  assert.equal(r.jsonPath, null);
  assert.equal(r.dataItemName, 'images');
  assert.equal(r.writeJsonPath, 'images.json');
});

test('re-open after sibling save: images.json now exists → load it in place', () => {
  const r = classifyEntries(['images/0000.jpg', 'images.json'], { rootName: 'datas' });
  assert.equal(r.jsonPath, 'images.json');
  assert.equal(r.writeJsonPath, 'images.json');
});

test('video in dir, no json → <videoBasename>.json', () => {
  const r = classifyEntries(['foo.mp4'], { rootName: 'datas' });
  assert.equal(r.videoPath, 'foo.mp4');
  assert.equal(r.dataItemName, 'foo');
  assert.equal(r.writeJsonPath, 'foo.json');
});

test('video flow with explicit videoName override', () => {
  const r = classifyEntries([], { rootName: 'datas', videoName: '10m_clip.mp4' });
  assert.equal(r.dataItemName, '10m_clip');
  assert.equal(r.writeJsonPath, '10m_clip.json');
});

test('re-open after video save: <name>.json exists → in place', () => {
  const r = classifyEntries(['foo.mp4', 'foo.json'], { rootName: 'datas' });
  assert.equal(r.jsonPath, 'foo.json');
});

test('loose images at parent root, no subfolder → rootName.json', () => {
  const r = classifyEntries(['0000.jpg', '0001.jpg'], { rootName: 'mydata' });
  assert.equal(r.dataItemName, 'mydata');
  assert.equal(r.writeJsonPath, 'mydata.json');
});

test('images numeric sort (2 before 10)', () => {
  const r = classifyEntries(['images/10.jpg', 'images/2.jpg', 'images/1.jpg'], { rootName: 'd' });
  assert.deepEqual(r.imagePaths, ['images/1.jpg', 'images/2.jpg', 'images/10.jpg']);
});

test('basename helper', () => { assert.equal(basename('a/b/c.json'), 'c.json'); });
