import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadModelFromFiles } from '../../smpl_core/smpl_model.js';
import { createSmplBody, createMhrBody } from '../../smpl_core/body_model.js';
import { figureLayouts, poseGroups } from '../joint_figure.js';

const rd = async (u) => new Uint8Array(await readFile(u));
const smpl = createSmplBody(await loadModelFromFiles(new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url), rd));
const mhrModel = await loadModelFromFiles(new URL('../../smpl_web_viewer/public/models/mhr_lod1.meta.json', import.meta.url), rd);
const at = (lay, body, name) => lay.xy[lay.joints.indexOf(body.jointNames.indexOf(name))];

test('SMPL: one body panel, faces the screen (left side on the right), head above feet', () => {
  const lays = figureLayouts(smpl);
  assert.deepEqual(lays.map((l) => l.key), ['body']);
  const b = lays[0];
  assert.ok(at(b, smpl, 'L_Shoulder')[0] > at(b, smpl, 'R_Shoulder')[0]);
  assert.ok(at(b, smpl, 'Head')[1] < at(b, smpl, 'L_Foot')[1]);
  assert.ok(b.xy.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1));
});

test('MHR: hand panels appear only with hands on; fingers point up, thumbs outward', () => {
  assert.deepEqual(figureLayouts(createMhrBody(mhrModel)).map((l) => l.key), ['body', 'lfoot', 'rfoot']);
  const body = createMhrBody(mhrModel, { showHands: true });
  const lays = figureLayouts(body);
  assert.deepEqual(lays.map((l) => l.key), ['body', 'lhand', 'rhand', 'lfoot', 'rfoot']);
  const [, L, R] = lays;
  assert.ok(at(L, body, 'l_middle3')[1] < at(L, body, 'l_wrist')[1]);
  assert.ok(at(L, body, 'l_thumb1')[0] > at(L, body, 'l_pinky1')[0]);
  assert.ok(at(R, body, 'r_thumb1')[0] < at(R, body, 'r_pinky1')[0]);
});

test('MHR: coincident wrist_twist is spread away from the wrist in the figure', () => {
  const body = createMhrBody(mhrModel);
  const b = figureLayouts(body)[0];
  const [a, c] = [at(b, body, 'l_wrist_twist'), at(b, body, 'l_wrist')];
  assert.ok(Math.hypot(a[0] - c[0], a[1] - c[1]) > 0.01);
});

test('pose groups cover every pose button exactly once', () => {
  for (const body of [smpl, createMhrBody(mhrModel, { showHands: true })]) {
    const ks = poseGroups(body).flatMap((g) => g.ks).sort((x, y) => x - y);
    assert.deepEqual(ks, body.poseJoints.map((_, k) => k));
  }
  assert.ok(poseGroups(createMhrBody(mhrModel, { showHands: true })).some((g) => g.title === '左手'));
});

test('figure points are spread: no two pickable dots overlap (feet, wrist twist, fingers)', () => {
  for (const body of [smpl, createMhrBody(mhrModel, { showHands: true })]) {
    for (const lay of figureLayouts(body)) {
      for (let i = 0; i < lay.xy.length; i++) for (let k = 0; k < i; k++) {
        const d = Math.hypot(lay.xy[i][0] - lay.xy[k][0], lay.xy[i][1] - lay.xy[k][1]);
        assert.ok(d > 0.03, `${lay.key}: ${body.jointNames[lay.joints[i]]} vs ${body.jointNames[lay.joints[k]]} ${d.toFixed(3)}`);
      }
    }
  }
});

test('MHR: every displayed joint is editable (or the root)', () => {
  const body = createMhrBody(mhrModel, { showHands: true });
  for (const j of body.displayJoints) assert.ok(j === body.rootJoint || body.poseJoints.includes(j), body.jointNames[j]);
  assert.ok(['l_subtalar', 'l_transversetarsal'].every((n) => body.poseJoints.includes(body.jointNames.indexOf(n))));
});

test('MHR foot panel: side view, toes ahead of the heel, ankle above the toes', () => {
  const body = createMhrBody(mhrModel);
  const F = figureLayouts(body).find((l) => l.key === 'lfoot');
  assert.ok(at(F, body, 'l_ball')[0] > at(F, body, 'l_subtalar')[0]);
  assert.ok(at(F, body, 'l_talocrural')[1] < at(F, body, 'l_ball')[1]);
  assert.ok(!figureLayouts(body)[0].joints.includes(body.jointNames.indexOf('l_ball')), 'body figure stops at the ankle');
});

test('MHR foot panel: ankle → talocrural → subtalar does not fold back (no acute zig-zag)', () => {
  const body = createMhrBody(mhrModel);
  const F = figureLayouts(body).find((l) => l.key === 'lfoot');
  const [a, b, c] = ['l_foot', 'l_talocrural', 'l_subtalar'].map((n) => at(F, body, n));
  const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
  const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
  assert.ok(cos > 0, `turn cos ${cos.toFixed(2)}`);
});
