import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { arrayFromBuffer, loadModelFromFiles } from '../../smpl_core/smpl_model.js';

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

test('arrayFromBuffer reads from Uint8Array subviews with non-zero byteOffset', () => {
  const source = new Float32Array([99, 100, 1.5, 2.5, 101]);
  const view = new Uint8Array(source.buffer, 8, 8);
  const out = arrayFromBuffer(view, { offset: 0, length: 2, dtype: 'float32' });

  assert.deepEqual(Array.from(out), [1.5, 2.5]);
});

test('arrayFromBuffer rejects negative offsets', () => {
  const view = new Uint8Array(new Float32Array([1, 2]).buffer);

  assert.throws(
    () => arrayFromBuffer(view, { offset: -4, length: 1, dtype: 'float32' }),
    /offset.*non-negative integer/
  );
});

test('arrayFromBuffer rejects negative lengths', () => {
  const view = new Uint8Array(new Float32Array([1, 2]).buffer);

  assert.throws(
    () => arrayFromBuffer(view, { offset: 0, length: -1, dtype: 'float32' }),
    /length.*non-negative integer/
  );
});

test('arrayFromBuffer rejects slices beyond the current view byteLength', () => {
  const source = new Float32Array([99, 1, 2, 100]);
  const view = new Uint8Array(source.buffer, 4, 8);

  assert.throws(
    () => arrayFromBuffer(view, { offset: 8, length: 1, dtype: 'float32' }),
    /outside model asset view/
  );
});

test('arrayFromBuffer rejects unknown dtypes', () => {
  const view = new Uint8Array(new Float32Array([1]).buffer);

  assert.throws(
    () => arrayFromBuffer(view, { offset: 0, length: 1, dtype: 'float16' }),
    /unsupported model dtype: float16/
  );
});
