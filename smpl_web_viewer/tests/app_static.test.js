import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('app imports scene, worker, model loader, and sequence loader', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /from '\.\/viewer\/scene\.js'/);
  assert.match(app, /from '\.\/smpl\/smpl_model\.js'/);
  assert.match(app, /from '\.\/data\/sequence_loader\.js'/);
  assert.match(app, /new Worker\(new URL\('\.\/smpl\/smpl_worker\.js'/);
});
