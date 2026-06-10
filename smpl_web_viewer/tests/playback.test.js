import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Playback } from '../src/viewer/playback.js';

test('Playback clamps frame index', () => {
  const p = new Playback(3);
  p.setFrame(99);
  assert.equal(p.frame, 2);
  p.setFrame(-1);
  assert.equal(p.frame, 0);
});
