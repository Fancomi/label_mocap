import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orderedImageNames, basename } from '../src/io/image_order.js';

test('basename strips directories', () => {
  assert.equal(basename('images/0003.jpg'), '0003.jpg');
});

test('with json file_names, follows json order exactly (no sort)', () => {
  const cocoImages = [{ file_name: 'b.jpg', id: 0 }, { file_name: 'a.jpg', id: 1 }, { file_name: 'c.jpg', id: 2 }];
  const r = orderedImageNames({ cocoImages, availableNames: ['a.jpg', 'b.jpg', 'c.jpg'] });
  assert.deepEqual(r, ['b.jpg', 'a.jpg', 'c.jpg']); // json order preserved, NOT sorted
});

test('json file_names with directory prefixes are reduced to basenames', () => {
  const cocoImages = [{ file_name: 'images/10.jpg', id: 0 }, { file_name: 'images/2.jpg', id: 1 }];
  const r = orderedImageNames({ cocoImages, availableNames: ['2.jpg', '10.jpg'] });
  assert.deepEqual(r, ['10.jpg', '2.jpg']); // follows json order
});

test('without json, numeric-sorts available names', () => {
  const r = orderedImageNames({ cocoImages: [], availableNames: ['images/10.jpg', 'images/2.jpg', 'images/1.jpg'] });
  assert.deepEqual(r, ['1.jpg', '2.jpg', '10.jpg']);
});

test('cocoImages without file_name fall back to numeric sort of available', () => {
  const r = orderedImageNames({ cocoImages: [{ id: 0 }, { id: 1 }], availableNames: ['b.jpg', 'a.jpg'] });
  assert.deepEqual(r, ['a.jpg', 'b.jpg']);
});
