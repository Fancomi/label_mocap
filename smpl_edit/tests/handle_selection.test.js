// smpl_edit/tests/handle_selection.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HandleSelection } from '../handle_selection.js';

test('defaults to end with no chain', () => {
  const s = new HandleSelection();
  assert.equal(s.active(), 'end');
});

test('select switches between end and pole; ignores garbage', () => {
  const s = new HandleSelection();
  s.select('pole'); assert.equal(s.active(), 'pole');
  s.select('end'); assert.equal(s.active(), 'end');
  s.select('nonsense'); assert.equal(s.active(), 'end'); // unchanged
});

test('bindChain to the SAME chain keeps the current active handle', () => {
  const s = new HandleSelection();
  s.bindChain('L_Arm');
  s.select('pole');
  s.bindChain('L_Arm'); // same limb across a re-sync
  assert.equal(s.active(), 'pole');
});

test('bindChain to a DIFFERENT chain resets active to end', () => {
  const s = new HandleSelection();
  s.bindChain('L_Arm');
  s.select('pole');
  s.bindChain('R_Arm'); // switched limb
  assert.equal(s.active(), 'end');
});

test('reset returns to end and clears the chain', () => {
  const s = new HandleSelection();
  s.bindChain('L_Arm');
  s.select('pole');
  s.reset();
  assert.equal(s.active(), 'end');
  // after reset, binding the previously-active chain must NOT keep 'pole'
  s.bindChain('L_Arm');
  assert.equal(s.active(), 'end');
});
