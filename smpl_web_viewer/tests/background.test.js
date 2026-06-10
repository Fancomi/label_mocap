import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageUrlForFrame } from '../src/viewer/background.js';

test('imageUrlForFrame expands percent pattern', () => {
  assert.equal(imageUrlForFrame({ baseUrl: './images/', pattern: '%04d.jpg' }, 7), './images/0007.jpg');
});
