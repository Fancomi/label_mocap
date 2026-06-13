import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UIController } from '../src/ui/ui_controller.js';

test('defaults to pose mode, no joint selected', () => {
  const c = new UIController();
  assert.equal(c.mode, 'pose');
  assert.equal(c.selectedJoint, null);
});

test('setMode switches the single active mode and notifies', () => {
  const c = new UIController();
  let n = 0; c.onChange(() => { n++; });
  c.setMode('bbox');
  assert.equal(c.mode, 'bbox');
  assert.ok(n >= 1);
});

test('switching away from pose clears the joint selection', () => {
  const c = new UIController();
  c.selectJoint(4);
  assert.equal(c.mode, 'pose');
  assert.equal(c.selectedJoint, 4);
  c.setMode('beta');
  assert.equal(c.selectedJoint, null);
});

test('selectJoint forces pose mode', () => {
  const c = new UIController();
  c.setMode('root');
  c.selectJoint(7);
  assert.equal(c.mode, 'pose');
  assert.equal(c.selectedJoint, 7);
});

test('only the active mode reports its interaction live', () => {
  const c = new UIController();
  c.setMode('bbox');
  assert.equal(c.isInteractionActive('bbox'), true);
  assert.equal(c.isInteractionActive('pose'), false);
  assert.equal(c.isInteractionActive('root'), false);
});

test('readOnly forces a read-only mode and blocks edits', () => {
  const c = new UIController({ readOnly: true });
  c.setMode('pose');
  assert.equal(c.mode, 'view');
  c.selectJoint(2);
  assert.equal(c.selectedJoint, null);
  assert.equal(c.isInteractionActive('pose'), false);
});
