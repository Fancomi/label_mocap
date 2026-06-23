import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPayload, parseInferResponse, cloudResultToFields } from '../src/io/gvhmr_client.js';

test('buildPayload link1 (no bbox) carries only image_b64 + file_name', () => {
  const p = buildPayload({ imageB64: 'AAA', fileName: '0001.jpg' });
  assert.deepEqual(p, { image_b64: 'AAA', file_name: '0001.jpg' });
});

test('buildPayload link2 includes bbox [x,y,w,h]', () => {
  const p = buildPayload({ imageB64: 'AAA', fileName: '0001.jpg', bbox: [1, 2, 3, 4] });
  assert.deepEqual(p.bbox, [1, 2, 3, 4]);
  assert.equal(p.image_b64, 'AAA');
});

function okDoc() {
  return {
    images: [{ id: 0, cam_K: [900, 0, 320, 0, 900, 240, 0, 0, 1] }],
    annotations: [{
      bbox: [10, 20, 30, 40], root_pos: [0, 0, -4], root_rota: [0, 0, 0],
      body_pose: Array(63).fill(0), betas: Array(10).fill(0), keypoints: Array(156).fill(0),
    }],
  };
}

test('parseInferResponse extracts ann + camK from a valid doc', () => {
  const { ann, camK } = parseInferResponse(okDoc());
  assert.deepEqual(ann.bbox, [10, 20, 30, 40]);
  assert.equal(ann.body_pose.length, 63);
  assert.deepEqual(camK, [900, 0, 320, 0, 900, 240, 0, 0, 1]);
});

test('parseInferResponse throws on missing annotations', () => {
  assert.throws(() => parseInferResponse({ images: [{ id: 0 }], annotations: [] }),
    /no annotations|annotations/i);
});

test('parseInferResponse throws on wrong body_pose length', () => {
  const d = okDoc(); d.annotations[0].body_pose = Array(10).fill(0);
  assert.throws(() => parseInferResponse(d), /body_pose/i);
});

test('parseInferResponse throws on missing root_rota', () => {
  const d = okDoc(); delete d.annotations[0].root_rota;
  assert.throws(() => parseInferResponse(d), /root_rota/i);
});

test('parseInferResponse throws on wrong root_pos length', () => {
  const d = okDoc(); d.annotations[0].root_pos = [1, 2];
  assert.throws(() => parseInferResponse(d), /root_pos/i);
});

test('cloudResultToFields maps the five editable fields', () => {
  const { ann } = parseInferResponse(okDoc());
  const f = cloudResultToFields(ann);
  assert.deepEqual(Object.keys(f).sort(),
    ['bbox', 'betas', 'body_pose', 'root_pos', 'root_rota']);
});
