import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CocoDocument } from '../coco_document.js';

function sampleDoc() {
  return {
    images: [{ file_name: '0000.jpg', width: 1920, height: 1080, id: 0 },
             { file_name: '0001.jpg', width: 1920, height: 1080, id: 1 }],
    annotations: [{
      id: 0, image_id: 0, bbox: [10, 20, 30, 40], keypoints: Array(156).fill(0),
      p3d: [1, 2, 3], iscrowd: 0, area: 5, category_id: 1,
      segmentation: [[1, 2, 3, 4]], occlution_joint: Array(52).fill(1),
      betas: Array(10).fill(0), root_pos: [0, 0, -4], root_rota: [0, 0, 0],
      body_pose: Array(63).fill(0), right_hand_pose: Array(45).fill(0), left_hand_pose: Array(45).fill(0),
    }],
    categories: [{ name: 'p', id: 1 }],
  };
}

test('getAnnotation returns the annotation for an image id, or null', () => {
  const doc = new CocoDocument(sampleDoc());
  assert.equal(doc.getAnnotation(0).bbox[0], 10);
  assert.equal(doc.getAnnotation(1), null);
});

test('imageIds returns every image id in order', () => {
  const doc = new CocoDocument(sampleDoc());
  assert.deepEqual(doc.imageIds(), [0, 1]);
});

test('serialize preserves untouched fields byte-for-byte', () => {
  const raw = sampleDoc();
  const doc = new CocoDocument(raw);
  const out = doc.serialize();
  assert.deepEqual(out.annotations[0].segmentation, [[1, 2, 3, 4]]);
  assert.deepEqual(out.annotations[0].right_hand_pose, Array(45).fill(0));
  assert.deepEqual(out.categories, [{ name: 'p', id: 1 }]);
});

test('setAnnotation merges editable fields, preserves the rest', () => {
  const doc = new CocoDocument(sampleDoc());
  doc.setAnnotation(0, { bbox: [1, 1, 2, 2], betas: Array(10).fill(0.5) });
  const a = doc.serialize().annotations[0];
  assert.deepEqual(a.bbox, [1, 1, 2, 2]);
  assert.deepEqual(a.betas, Array(10).fill(0.5));
  assert.deepEqual(a.segmentation, [[1, 2, 3, 4]]); // untouched
  assert.equal(a.id, 0);                              // untouched
});

test('deleteAnnotation removes the entry but keeps the image', () => {
  const doc = new CocoDocument(sampleDoc());
  doc.deleteAnnotation(0);
  const out = doc.serialize();
  assert.equal(out.annotations.length, 0);
  assert.equal(out.images.length, 2);
});

test('setAnnotation on an empty frame creates an entry with only passed fields', () => {
  const doc = new CocoDocument(sampleDoc());
  doc.setAnnotation(1, { root_pos: [0, 0, -4] });
  const a = doc.serialize().annotations.find((x) => x.image_id === 1);
  assert.ok(a);
  assert.equal(a.image_id, 1);
  assert.deepEqual(a.root_pos, [0, 0, -4]);
  assert.equal('body_pose' in a, false);    // not auto-filled anymore
  assert.equal('keypoints' in a, false);
});

test('setAnnotation with only bbox does NOT add SMPL pose keys', () => {
  const doc = new CocoDocument(sampleDoc());
  doc.setAnnotation(1, { bbox: [5, 6, 7, 8] });
  const a = doc.serialize().annotations.find((x) => x.image_id === 1);
  assert.deepEqual(a.bbox, [5, 6, 7, 8]);
  assert.equal('body_pose' in a, false);
  assert.equal('root_pos' in a, false);
  assert.equal('betas' in a, false);
});

test('setAnnotation with only SMPL does NOT add a bbox key', () => {
  const doc = new CocoDocument(sampleDoc());
  doc.setAnnotation(1, { root_pos: [0, 0, -4], root_rota: [0, 0, 0],
    body_pose: Array(63).fill(0), betas: Array(10).fill(0) });
  const a = doc.serialize().annotations.find((x) => x.image_id === 1);
  assert.equal(a.body_pose.length, 63);
  assert.equal('bbox' in a, false);
});

test('hasSmpl / hasBbox reflect independent presence', () => {
  const doc = new CocoDocument(sampleDoc());
  doc.setAnnotation(1, { bbox: [5, 6, 7, 8] });
  assert.equal(doc.hasBbox(1), true);
  assert.equal(doc.hasSmpl(1), false);
  doc.setAnnotation(1, { body_pose: Array(63).fill(0) });
  assert.equal(doc.hasSmpl(1), true);
  assert.equal(doc.hasBbox(1), true);     // bbox still there
});

test('hasBbox is false for the [0,0,0,0] sentinel and for missing key', () => {
  const doc = new CocoDocument(sampleDoc());
  assert.equal(doc.hasBbox(1), false);              // no annotation
  doc.setAnnotation(1, { bbox: [0, 0, 0, 0] });
  assert.equal(doc.hasBbox(1), false);              // sentinel = no box
});

test('pole_vectors round-trips sparsely; untouched chains stay absent', () => {
  const doc = new CocoDocument({
    images: [{ id: 5 }],
    annotations: [{ id: 0, image_id: 5, bbox: [0, 0, 1, 1] }],
  });
  doc.setAnnotation(5, { pole_vectors: { L_Arm: [0.1, 0.2, 0.3] } });
  const out = doc.serialize();
  const a = out.annotations.find((x) => x.image_id === 5);
  assert.deepEqual(a.pole_vectors, { L_Arm: [0.1, 0.2, 0.3] });
  assert.equal('R_Arm' in a.pole_vectors, false);
});

test('annotation with no pole_vectors serializes without the field', () => {
  const doc = new CocoDocument({
    images: [{ id: 7 }],
    annotations: [{ id: 1, image_id: 7, bbox: [0, 0, 1, 1] }],
  });
  doc.setAnnotation(7, { root_rota: [0, 0, 0] });
  const a = doc.serialize().annotations.find((x) => x.image_id === 7);
  assert.equal('pole_vectors' in a, false);
});
