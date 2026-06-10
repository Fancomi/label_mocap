import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { loadModelFromFiles } from '../src/smpl/smpl_model.js';

test('loadModelFromFiles slices arrays by meta offsets', async () => {
  const base = new URL('./fixtures/tiny_model/', import.meta.url);
  const model = await loadModelFromFiles(
    new URL('tiny.meta.json', base),
    async (url) => readFile(url)
  );
  assert.equal(model.v_template.length, 6);
  assert.equal(model.faces.length, 3);
  assert.deepEqual(Array.from(model.parents), [-1, 0]);
});
