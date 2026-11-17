import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadModelFromFiles } from '../../smpl_core/smpl_model.js';
import { createMhrBody, createSmplBody } from '../../smpl_core/body_model.js';
import { deriveFrame } from '../src/edit/frame_derive.js';
import { viewConfigOf } from '../src/io/view_config.js';

const read = async (u) => new Uint8Array(await readFile(u));
const mhr = createMhrBody(await loadModelFromFiles(new URL('../../smpl_web_viewer/public/models/mhr_lod1.meta.json', import.meta.url), read));
const smpl = createSmplBody(await loadModelFromFiles(new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url), read));

const CAM = { width: 1280, height: 720, cam_K: { fx: 749, fy: 749, cx: 640, cy: 360 }, t: [0, 0, 0], view_rotation_deg: 90 };
const doc = {
  cameras: [{ ...CAM, id: 'front', R: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    // 侧机:绕 Y 转 90°,位于人体右侧 4m 处看向人体
    { ...CAM, id: 'side', R: [0, 0, -1, 0, 1, 0, 1, 0, 0], t: [4, 0, 0] }],
  images: [{ id: 0, views: { front: 0, side: 0 } }, { id: 1, views: { front: 1, side: null } }],
};
const views = doc.cameras.map((c) => ({ cameraId: c.id, cfg: viewConfigOf(doc, c.id) }));
const fields = { ...mhr.defaultFields(), root_pos: [0, 0, -4] };

test('multi-view: per-camera keypoints/occlusion/bbox, top level mirrors cameras[0]', () => {
  const d = deriveFrame(mhr, mhr.forward(fields), views, 0);
  assert.deepEqual(Object.keys(d.per_view), ['front', 'side']);
  for (const v of Object.values(d.per_view)) {
    assert.equal(v.keypoints.length, mhr.keypointSlots * 3);
    assert.equal(v.occlution_joint.length, mhr.keypointSlots);
    assert.equal(v.bbox.length, 4);
  }
  assert.deepEqual(d.bbox, d.per_view.front.bbox);
  assert.notDeepEqual(d.per_view.side.occlution_joint, d.per_view.front.occlution_joint, 'occlusion differs by viewpoint');
});

test('multi-view: a camera without a frame gets no entry', () => {
  const d = deriveFrame(mhr, mhr.forward(fields), views, 1);
  assert.deepEqual(Object.keys(d.per_view), ['front']);
});

test('single-view SMPL: keypoints + occlusion only, no derived bbox', () => {
  const d = deriveFrame(smpl, smpl.forward(smpl.defaultFields()), [{ cameraId: null, project: { fx: 1000, fy: 1000, cx: 960, cy: 540 }, camPos: [0, 0, 0] }], 0);
  assert.deepEqual(Object.keys(d).sort(), ['keypoints', 'occlution_joint']);
  assert.equal(d.keypoints.length, 52 * 3);
});

test('one MHR frame, both views, derives well under an interactive budget', () => {
  const out = mhr.forward(fields);
  deriveFrame(mhr, out, views, 0);
  const t = performance.now();
  for (let i = 0; i < 5; i++) deriveFrame(mhr, out, views, 0);
  const ms = (performance.now() - t) / 5;
  assert.ok(ms < 100, `${ms.toFixed(1)} ms`);
});
