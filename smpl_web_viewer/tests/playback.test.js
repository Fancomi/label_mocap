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

test('Playback toggle and tick advance frames by fps', () => {
  const p = new Playback(3, 2);

  assert.equal(p.tick(500), 0);
  assert.equal(p.toggle(), true);
  assert.equal(p.tick(499), 0);
  assert.equal(p.tick(1), 1);
  assert.equal(p.tick(1000), 0);
  assert.equal(p.toggle(), false);
  assert.equal(p.tick(500), 0);
});

test('Playback handles frameCount zero without negative frame', () => {
  const p = new Playback(0);

  assert.equal(p.setFrame(99), 0);
  assert.equal(p.frame, 0);
  p.toggle();
  assert.equal(p.tick(1000), 0);
});

test('Playback defaults invalid fps and ignores invalid dt', () => {
  for (const fps of [0, -10, NaN, Infinity, -Infinity, 'fast']) {
    const p = new Playback(3, fps);

    assert.equal(p.fps, 30);
    p.toggle();
    assert.equal(p.tick(1000), 0);
  }

  const p = new Playback(3, 30);
  p.toggle();

  for (const dt of [NaN, Infinity, -Infinity, -1, '16']) {
    assert.equal(p.tick(dt), 0);
    assert.equal(p._accum, 0);
  }
});
