import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageUrlForFrame } from '../src/viewer/background.js';

test('imageUrlForFrame expands percent pattern', () => {
  assert.equal(imageUrlForFrame({ baseUrl: './images/', pattern: '%04d.jpg' }, 7), './images/0007.jpg');
});

test('imageUrlForFrame expands unpadded percent pattern', () => {
  assert.equal(imageUrlForFrame({ baseUrl: './images/', pattern: '%d.jpg' }, 7), './images/7.jpg');
});

test('imageUrlForFrame rejects missing or ambiguous patterns', () => {
  assert.throws(() => imageUrlForFrame({ baseUrl: './images/' }, 7), /pattern/);
  assert.throws(() => imageUrlForFrame({ baseUrl: './images/', pattern: 'frame.jpg' }, 7), /single/);
  assert.throws(() => imageUrlForFrame({ baseUrl: './images/', pattern: '%04d-%d.jpg' }, 7), /single/);
});

test('imageUrlForFrame rejects invalid frame indexes', () => {
  for (const frame of [-1, 1.5, NaN, Infinity, '7']) {
    assert.throws(() => imageUrlForFrame({ baseUrl: './images/', pattern: '%d.jpg' }, frame), /non-negative integer/);
  }
});
