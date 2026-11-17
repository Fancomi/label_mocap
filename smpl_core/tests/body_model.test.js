import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadModelFromFiles } from '../smpl_model.js';
import { forwardSmpl } from '../lbs.js';
import { createSmplBody, createMhrBody, createBody, bodyModelNameOf, mhrDisplayJoints } from '../body_model.js';

const read = async (u) => new Uint8Array(await readFile(u));
const smplModel = await loadModelFromFiles(new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url), read);
const mhrModel = await loadModelFromFiles(new URL('../../smpl_web_viewer/public/models/mhr_lod1.meta.json', import.meta.url), read);

for (const make of [createSmplBody, createMhrBody]) {
  const body = make(make === createSmplBody ? smplModel : mhrModel);

  test(`${body.name}: bones reference valid joints with 5 colour groups`, () => {
    for (const [a, b, g] of body.bones) {
      assert.ok(a >= 0 && a < body.jointCount && b >= 0 && b < body.jointCount);
      assert.ok(g >= 0 && g <= 4);
    }
  });

  test(`${body.name}: defaultFields carries presenceKey and every fieldKey`, () => {
    const f = body.defaultFields();
    for (const k of body.fieldKeys) assert.ok(k in f, k);
    assert.ok(body.presenceKey in f);
  });

  test(`${body.name}: root joint lands on root_pos for any root_rota`, () => {
    const f = { ...body.defaultFields(), root_pos: [0.3, -0.2, -3.5], root_rota: [0.4, -1.1, 2.0] };
    const { joints, vertices, worldRot } = body.forward(f, { worldRot: true });
    const r = body.rootJoint * 3;
    assert.ok(Math.hypot(joints[r] - 0.3, joints[r + 1] + 0.2, joints[r + 2] + 3.5) < 1e-5);
    assert.equal(vertices.length, (make === createSmplBody ? 6890 : 18439) * 3);
    assert.equal(worldRot.length, body.jointCount * 9);
  });
}

test('smpl body forward is exactly forwardSmpl', () => {
  const body = createSmplBody(smplModel);
  const f = { ...body.defaultFields(), body_pose: Array.from({ length: 63 }, (_, i) => Math.sin(i) * 0.2) };
  assert.deepEqual(body.forward(f).vertices, forwardSmpl(smplModel, f).vertices);
});

test('mhr body: root_rota rotates the body about the pelvis (metres)', () => {
  const body = createMhrBody(mhrModel);
  const f = body.defaultFields();
  const head = body.jointNames.indexOf('c_head');
  const up = body.forward(f).joints;
  const flipped = body.forward({ ...f, root_rota: [Math.PI, 0, 0] }).joints;   // 绕 X 180°:头朝下
  const r = body.rootJoint * 3;
  const dyUp = up[head * 3 + 1] - up[r + 1];
  const dyFlip = flipped[head * 3 + 1] - flipped[r + 1];
  assert.ok(dyUp > 0.5 && dyUp < 0.9, `head above pelvis ${dyUp} m`);
  assert.ok(Math.abs(dyFlip + dyUp) < 1e-5);
});

test('bodyModelNameOf defaults to smpl for legacy docs', () => {
  assert.equal(bodyModelNameOf({ images: [] }), 'smpl');
  assert.equal(bodyModelNameOf({ info: { body_model: 'mhr' } }), 'mhr');
});

for (const [name, model] of [['smpl', smplModel], ['mhr', mhrModel]]) {
  test(`${name}: editor config indices are consistent`, () => {
    const body = createBody(name, model);
    const inRange = (j) => Number.isInteger(j) && j >= 0 && j < body.jointCount;
    assert.ok(body.displayJoints.every(inRange));
    assert.ok(body.poseJoints.every(inRange));
    assert.equal(body.poseLabels.length, body.poseJoints.length);
    assert.ok(!body.poseJoints.includes(body.rootJoint), 'root is edited by the root handle, not the pose tab');
    assert.ok(body.keypointJoints.length <= body.keypointSlots);
    for (const [, a, v, b] of body.angleReadouts) assert.ok([a, v, b].every(inRange));
    for (const g of body.shapeGroups) {
      assert.ok(body.fieldKeys.includes(g.key), g.key);
      assert.equal(g.labels.length, g.indices.length);
      const n = body.defaultFields()[g.key].length;
      assert.ok(g.indices.every((i) => i >= 0 && i < n), g.title);
    }
    const shown = new Set(body.displayJoints);
    for (const [a, b] of body.bones) assert.ok(shown.has(a) && shown.has(b), 'bones only connect displayed joints');
  });
}

test('smpl editor config reproduces the legacy hardcoded layout', () => {
  const body = createSmplBody(smplModel);
  assert.deepEqual(body.poseJoints, Array.from({ length: 21 }, (_, i) => i + 1));
  assert.equal(body.displayJoints.length, 24);
  assert.equal(body.keypointSlots, 52);
});

test('mhr hands are hidden by default and appear with showHands', () => {
  const names = mhrModel.meta.joint_names;
  const off = mhrDisplayJoints(names);
  const on = mhrDisplayJoints(names, { showHands: true });
  assert.ok(!off.some((j) => /index\d$/.test(names[j])));
  assert.ok(on.some((j) => names[j] === 'l_index1'));
  assert.ok(off.includes(names.indexOf('l_wrist')));
});

test('mhr shape tab: hands groups only with showHands, eye scales never exposed', () => {
  const titles = (b) => b.shapeGroups.map((g) => g.title);
  assert.ok(!titles(createMhrBody(mhrModel)).some((t) => t.startsWith('手部')));
  assert.ok(titles(createMhrBody(mhrModel, { showHands: true })).includes('手部缩放'));
  const all = createMhrBody(mhrModel, { showHands: true }).shapeGroups.flatMap((g) => g.labels);
  assert.ok(!all.some((l) => /eye/.test(l)));
  assert.ok(all.includes('uplegs') && all.includes('l_index1_length'));
});


test('mhr finger joints render smaller; smpl joints unchanged', () => {
  const b = createMhrBody(mhrModel, { showHands: true });
  const n = b.jointNames;
  assert.ok(b.jointScale(n.indexOf('l_index1')) < 1);
  assert.equal(b.jointScale(n.indexOf('l_wrist')), 1);
  assert.equal(createSmplBody(smplModel).jointScale(20), 1);
});
