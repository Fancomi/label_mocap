// label/tests/anno_validate.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCocoDoc, isKptProject } from '../src/io/anno_validate.js';

test('isCocoDoc：含 images 数组为真', () => {
  assert.equal(isCocoDoc({ images: [], annotations: [] }), true);
  assert.equal(isCocoDoc({ images: [{ id: 0 }] }), true);
});

test('isCocoDoc：缺 images / 非数组 / 非对象为假', () => {
  assert.equal(isCocoDoc({ annotations: [] }), false);
  assert.equal(isCocoDoc({ images: 'x' }), false);
  assert.equal(isCocoDoc(null), false);
  assert.equal(isCocoDoc(42), false);
  assert.equal(isCocoDoc(undefined), false);
});

test('isKptProject：schema 精确匹配为真', () => {
  assert.equal(isKptProject({ schema: 'kpt-label/v1', images: [] }), true);
});

test('isKptProject：schema 不符 / 缺失 / 非对象为假', () => {
  assert.equal(isKptProject({ schema: 'kpt-label/v2' }), false);
  assert.equal(isKptProject({ images: [] }), false);
  assert.equal(isKptProject(null), false);
  assert.equal(isKptProject('kpt-label/v1'), false);
});
