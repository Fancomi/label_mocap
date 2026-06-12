import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditController } from '../src/edit/edit_controller.js';

test('starts in none tool with no selection', () => {
  const c = new EditController();
  assert.equal(c.tool, 'none');
  assert.equal(c.selectedJoint, null);
});

test('setTool changes tool and notifies', () => {
  const c = new EditController();
  let fired = 0; c.onChange(() => { fired++; });
  c.setTool('pose');
  assert.equal(c.tool, 'pose');
  assert.ok(fired >= 1);
});

test('selectJoint records index and implies pose tool', () => {
  const c = new EditController();
  c.selectJoint(5);
  assert.equal(c.selectedJoint, 5);
  assert.equal(c.tool, 'pose');
});

test('selecting root clears joint selection', () => {
  const c = new EditController();
  c.selectJoint(3);
  c.setTool('root');
  assert.equal(c.selectedJoint, null);
});

test('readOnly mode blocks tool changes', () => {
  const c = new EditController({ readOnly: true });
  c.setTool('pose');
  assert.equal(c.tool, 'none');
  c.selectJoint(2);
  assert.equal(c.selectedJoint, null);
});
