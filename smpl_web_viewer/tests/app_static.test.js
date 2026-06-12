import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('app imports scene, worker, model loader, and sequence loader', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /from '\.\/viewer\/scene\.js'/);
  assert.match(app, /from '\.\.\/\.\.\/smpl_core\/smpl_model\.js'/);
  assert.match(app, /from '\.\/data\/sequence_loader\.js'/);
  assert.match(app, /from '\.\/debug\/reference_mesh\.js'/);
  assert.match(app, /new Worker\(new URL\('\.\.\/\.\.\/smpl_core\/smpl_worker\.js'/);
});

test('scene applies camera principal point view offsets', async () => {
  const scene = await readFile(new URL('../src/viewer/scene.js', import.meta.url), 'utf8');
  assert.match(scene, /viewOffsetForCamera/);
  assert.match(scene, /\.setViewOffset\(/);
});

test('app ignores stale worker frame results', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /\?\?\s*playback\.frame/);
  assert.match(app, /if \(!pendingFrames\.has\(msg\.requestId\)\)\s*{\s*return;\s*}/s);
});

test('scene exposes a separate reference mesh overlay', async () => {
  const scene = await readFile(new URL('../src/viewer/scene.js', import.meta.url), 'utf8');
  assert.match(scene, /referenceMesh/);
  assert.match(scene, /setReferenceTopology/);
  assert.match(scene, /updateReferenceFrame/);
});

test('debug reference mesh is gated behind explicit query parameter', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /debugRef/);
  assert.match(app, /params\.get\('debugRef'\) === '1'/);
  assert.match(app, /if \(debugReferenceEnabled\)/);
});
