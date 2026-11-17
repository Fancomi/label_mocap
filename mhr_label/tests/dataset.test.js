import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkMhrDoc, ANNOTATION_PATH } from '../src/dataset.js';

const cam = (id) => ({ id, video: `${id}.mp4`, cam_K: { fx: 1, fy: 1, cx: 0, cy: 0 }, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], width: 10, height: 10 });
const paths = [ANNOTATION_PATH, 'zcam1.mp4', 'zcam2.mp4'];
const mhr = (cameras) => ({ info: { body_model: 'mhr' }, images: [], cameras });

test('MHR docs open with one or several cameras whose videos are present', () => {
  assert.equal(checkMhrDoc(mhr([cam('zcam1'), cam('zcam2')]), paths), null);
  assert.equal(checkMhrDoc(mhr([cam('zcam2')]), paths), null, 'single view is fine');
});

test('rejects SMPL docs, missing annotation/cameras/videos with readable reasons', () => {
  assert.match(checkMhrDoc(null, paths), /player_0\.json/);
  assert.match(checkMhrDoc({ images: [], cameras: [cam('zcam1')] }, paths), /\/label\//);
  assert.match(checkMhrDoc(mhr(undefined), paths), /cameras/);
  assert.match(checkMhrDoc(mhr([cam('zcam1'), cam('orb1')]), paths), /orb1\.mp4/);
  assert.match(checkMhrDoc(mhr([cam('zcam1'), cam('zcam1')]), paths), /重复/);
});
