import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSequence } from '../src/data/sequence_loader.js';

test('normalizeSequence validates frame array lengths and returns normalized sequence', () => {
  const seq = normalizeSequence({
    schema: 'smpl-web-sequence-v1',
    name: 'x',
    fps: 30,
    image: { type: 'image_sequence', baseUrl: './', pattern: '%04d.jpg', width: 1920, height: 1080 },
    camera: { fx: 1850, fy: 1850, cx: 960, cy: 540 },
    frames: [
      {
        frame: '0',
        root_pos: ['0', 0, 0],
        root_rota: [0, '0', 0],
        body_pose: Array(63).fill('0'),
        betas: Array(10).fill('0'),
      },
    ],
  });

  assert.equal(seq.frames.length, 1);
  assert.equal(seq.frames[0].frame, 0);
  assert.deepEqual(seq.frames[0].root_pos, [0, 0, 0]);
});

test('normalizeSequence rejects wrong body_pose length', () => {
  assert.throws(
    () =>
      normalizeSequence({
        schema: 'smpl-web-sequence-v1',
        name: 'x',
        fps: 30,
        frames: [
          {
            frame: 0,
            root_pos: [0, 0, 0],
            root_rota: [0, 0, 0],
            body_pose: Array(62).fill(0),
            betas: Array(10).fill(0),
          },
        ],
      }),
    /body_pose.*length 63/
  );
});
