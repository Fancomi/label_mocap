import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kptColor } from '../src/render.js';

test('kptColor 三态', () => {
  assert.equal(kptColor(2), '#39d353');
  assert.equal(kptColor(1), '#e3a008');
  assert.equal(kptColor(0), '#888');
});
