import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadModelFromFiles } from '../../smpl_core/smpl_model.js';
import { forwardSmpl } from '../../smpl_core/lbs.js';

const model = await loadModelFromFiles(
  new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url),
  async (u) => new Uint8Array(await readFile(u)));

function frame(overrides = {}) {
  return { root_pos: [0, 0, -4], root_rota: [0, 0, 0], body_pose: Array(63).fill(0), betas: Array(10).fill(0), ...overrides };
}

test('forwardSmpl without options omits worldRot (back-compat)', () => {
  const out = forwardSmpl(model, frame());
  assert.equal(out.worldRot, undefined);
  assert.equal(out.joints.length, 24 * 3);
});

test('forwardSmpl with {worldRot:true} returns 24 mat3 (length 24*9)', () => {
  const out = forwardSmpl(model, frame(), { worldRot: true });
  assert.equal(out.worldRot.length, 24 * 9);
  for (let j = 0; j < 24; j++) {
    const m = out.worldRot.slice(j * 9, j * 9 + 9);
    assert.ok(Math.abs(m[0] - 1) < 1e-5 && Math.abs(m[4] - 1) < 1e-5 && Math.abs(m[8] - 1) < 1e-5);
  }
});

test('a single root rotation propagates to all joints world rotation', () => {
  const out = forwardSmpl(model, frame({ root_rota: [0, Math.PI / 2, 0] }), { worldRot: true });
  const m0 = out.worldRot.slice(0, 9);
  assert.ok(Math.abs(m0[0]) < 1e-5);
});
