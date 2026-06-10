import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSequence, normalizeSequence } from '../src/data/sequence_loader.js';

function validFrame(overrides = {}) {
  return {
    frame: 0,
    root_pos: [0, 0, 0],
    root_rota: [0, 0, 0],
    body_pose: Array(63).fill(0),
    betas: Array(10).fill(0),
    ...overrides,
  };
}

function validSequence(overrides = {}) {
  return {
    schema: 'smpl-web-sequence-v1',
    name: 'x',
    fps: 30,
    image: { type: 'image_sequence', baseUrl: './', pattern: '%04d.jpg', width: 1920, height: 1080 },
    camera: { fx: 1850, fy: 1850, cx: 960, cy: 540 },
    frames: [validFrame()],
    ...overrides,
  };
}

test('normalizeSequence validates frame array lengths and returns normalized sequence', () => {
  const seq = normalizeSequence(validSequence());

  assert.equal(seq.frames.length, 1);
  assert.equal(seq.frames[0].frame, 0);
  assert.deepEqual(seq.frames[0].root_pos, [0, 0, 0]);
});

test('normalizeSequence rejects wrong body_pose length', () => {
  assert.throws(
    () =>
      normalizeSequence(
        validSequence({
          frames: [validFrame({ body_pose: Array(62).fill(0) })],
        })
      ),
    /body_pose.*length 63/
  );
});

test('normalizeSequence rejects bool, string, NaN, and Infinity array values', () => {
  for (const value of [true, false, '0', NaN, Infinity, -Infinity]) {
    assert.throws(
      () =>
        normalizeSequence(
          validSequence({
            frames: [validFrame({ root_pos: [value, 0, 0] })],
          })
        ),
      /root_pos\[0\].*finite number/
    );
  }
});

test('normalizeSequence rejects non-integer and bool frame values', () => {
  for (const frame of [1.9, '2', true, false, NaN, Infinity]) {
    assert.throws(
      () =>
        normalizeSequence(
          validSequence({
            frames: [validFrame({ frame })],
          })
        ),
      /frame.*integer/
    );
  }
});

test('normalizeSequence preserves metadata and excludes extra frame fields', () => {
  const seq = normalizeSequence(
    validSequence({
      extraMeta: { source: 'fixture' },
      frames: [validFrame({ left_hand_pose: [9], extra: 'drop me' })],
    })
  );

  assert.deepEqual(seq.extraMeta, { source: 'fixture' });
  assert.equal(seq.image.width, 1920);
  assert.deepEqual(Object.keys(seq.frames[0]), ['frame', 'root_pos', 'root_rota', 'body_pose', 'betas']);
});

test('loadSequence includes URL context for JSON and validation errors', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    });

    await assert.rejects(() => loadSequence('/bad.json'), /failed to parse sequence \/bad\.json: bad json/);

    globalThis.fetch = async () => ({
      ok: true,
      json: async () =>
        validSequence({
          frames: [validFrame({ root_pos: ['0', 0, 0] })],
        }),
    });

    await assert.rejects(() => loadSequence('/invalid.json'), /invalid sequence \/invalid\.json: root_pos\[0\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
