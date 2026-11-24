import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createBody, BODY_ASSETS } from '../../smpl_core/body_model.js';
import { mhrParamRanges, mhrPoseChannels } from '../../smpl_core/mhr_pose.js';
import { loadModelFromFiles } from '../../smpl_core/smpl_model.js';
import { AnnotationStore } from '../annotation_store.js';
import { CocoDocument } from '../coco_document.js';
import { resolveChains } from '../ik_chains.js';
import { IKController } from '../ik_controller.js';
import { createPoseState } from '../pose_state.js';

const pos = (points, index) => Array.from(points.slice(index * 3, index * 3 + 3));
const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));

async function setup(name) {
  const model = await loadModelFromFiles(
    new URL('../../smpl_web_viewer/public/models/' + BODY_ASSETS[name], import.meta.url),
    async url => new Uint8Array(await readFile(url)),
  );
  const body = createBody(name, model);
  const initial = { ...body.defaultFields(), root_pos: [0.2, -0.1, -4], root_rota: [0.08, 0.12, -0.04] };
  const rotation = createPoseState(body, initial);
  const poseIndex = joint => body.poseJoints.indexOf(body.jointNames.indexOf(joint));
  const elbow = name === 'smpl' ? 17 : poseIndex('l_lowarm');
  rotation.setJointEuler(elbow, [0, 0, .3]);
  const store = new AnnotationStore(new CocoDocument({
    info: { body_model: name },
    images: [{ id: 0 }],
    annotations: [{ id: 0, image_id: 0, ...initial, ...rotation.toAxisAngle() }],
  }));
  const fields = store.current();
  const skeleton = name === 'smpl' ? 'smpl' : resolveChains(body);
  let current = body.forward(fields, { worldRot: true });
  const controller = new IKController({
    getStore: () => store, getRotation: () => rotation, getParents: () => body.parents,
    getSkeleton: () => skeleton, getLastJoints: () => current.joints, getLastWorldRot: () => current.worldRot,
    onEdit: () => { current = body.forward(store.current(), { worldRot: true }); },
  });
  const endpoint = name === 'smpl' ? 15 : body.jointNames.indexOf('c_head');
  const chain = controller.chainFor(endpoint);
  return { model, body, fields, store, controller, chain, endpoint, getCurrent: () => current };
}

for (const name of ['smpl', 'mhr']) {
  test(`${name.toUpperCase()} head endpoint travels through the full spine chain with fixed pelvis and off-chain pose`, async () => {
    const {model, body, fields, controller, chain, endpoint, getCurrent} = await setup(name);
    assert.equal(chain.kind, 'head');
    const expectedNames = name === 'smpl'
      ? ['Spine1', 'Spine2', 'Spine3', 'Neck', 'Head']
      : ['c_spine0', 'c_spine1', 'c_spine2', 'c_spine3', 'c_neck', 'c_head'];
    assert.deepEqual(chain.joints.map(i => body.jointNames[i]), expectedNames);
    assert.equal(controller.autoPoleViz(chain), null);
    const original = structuredClone(fields);
    const before = getCurrent().joints;
    const start = pos(before, endpoint);
    const target = [start[0] + .105, start[1] - .035, start[2] + .075];
    controller.beginDrag(chain);
    controller.solveTo(target);
    const after = getCurrent().joints;
    const err = distance(pos(after, endpoint), target);
    assert(err < .018, `head target error: ${err} m`);
    assert.deepEqual(fields.root_pos, original.root_pos);
    assert.deepEqual(fields.root_rota, original.root_rota);
    assert.deepEqual(pos(after, body.rootJoint), pos(before, body.rootJoint));
    for (let i = 1; i < chain.joints.length; i++) {
      const [a, b] = [chain.joints[i - 1], chain.joints[i]];
      assert(Math.abs(distance(pos(after, a), pos(after, b)) - distance(pos(before, a), pos(before, b))) < 1e-5);
    }
    const key = name === 'smpl' ? 'body_pose' : 'mhr_pose';
    const controlled = new Set();
    for (const [i, joint] of chain.joints.slice(0, -1).entries()) {
      const indices = name === 'smpl'
        ? [0, 1, 2].map(axis => chain.bodyIdx[i] * 3 + axis)
        : mhrPoseChannels(model, joint).map(channel => channel.param - 6);
      indices.forEach(p => controlled.add(p));
      assert(indices.some(p => Math.abs(fields[key][p] - original[key][p]) > 1e-4), `joint ${expectedNames[i]} did not respond`);
    }
    for (const [i, value] of fields[key].entries()) {
      if (!controlled.has(i)) assert.equal(value, original[key][i]);
    }
    const solved = fields[key].slice();
    controller.solveTo(target);
    assert.deepEqual(fields[key], solved);
    controller.endDrag();
    controller.chainFor(name === 'smpl' ? 20 : body.jointNames.indexOf('l_wrist'));
    assert.deepEqual(fields[key], solved);
  });
}

test('an unreachable MHR head drag is deterministic, clamps production rig ranges, and restores its starting pose', async () => {
  const { model, fields, controller, chain, endpoint, getCurrent } = await setup('mhr');
  const start = pos(getCurrent().joints, endpoint);
  const original = fields.mhr_pose.slice();
  controller.beginDrag(chain);
  const target = [start[0] + 3, start[1] - 3, start[2] + 2];
  controller.solveTo(target);
  assert(distance(pos(getCurrent().joints, endpoint), target) < distance(start, target));
  const first = fields.mhr_pose.slice();
  for (const [id, [lo, hi]] of mhrParamRanges(model)) {
    if (id < 6 || id >= 136) continue;
    assert(first[id - 6] >= Math.min(lo, original[id - 6]) && first[id - 6] <= Math.max(hi, original[id - 6]));
  }
  controller.solveTo(target);
  assert.deepEqual(fields.mhr_pose, first);
  controller.solveTo(start);
  assert.deepEqual(fields.mhr_pose, original);
  controller.endDrag();
});

test('one undo restores an MHR head drag with multiple preview updates', async () => {
  const { store, controller, chain, endpoint, getCurrent } = await setup('mhr');
  const original = structuredClone(store.current());
  const start = pos(getCurrent().joints, endpoint);
  let committed = 0;
  store.onCommitted(() => { committed++; });
  store.beginEdit();
  controller.beginDrag(chain);
  controller.solveTo([start[0] + .05, start[1] -.02, start[2]]);
  const preview = store.current().mhr_pose.slice();
  controller.solveTo([start[0] + .12, start[1] -.05, start[2] + .03]);
  assert.notDeepEqual(preview, original.mhr_pose);
  assert.notDeepEqual(store.current().mhr_pose, preview);
  assert.equal(store.canUndo(), false);
  controller.endDrag();
  store.commitEdit();
  assert.equal(committed, 1);
  store.undo();
  assert.deepEqual(store.current(), original);
  assert.equal(store.canUndo(), false);
});
