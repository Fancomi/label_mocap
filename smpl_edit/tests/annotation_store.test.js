import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnnotationStore } from '../annotation_store.js';
import { CocoDocument } from '../coco_document.js';

function doc() {
  return new CocoDocument({
    images: [{ id: 0 }, { id: 1 }],
    annotations: [{ id: 0, image_id: 0, bbox: [1, 1, 1, 1], betas: Array(10).fill(0),
      root_pos: [0, 0, -4], root_rota: [0, 0, 0], body_pose: Array(63).fill(0),
      keypoints: Array(156).fill(0), occlution_joint: Array(52).fill(0) }],
    categories: [],
  });
}

test('hasData reflects whether the current frame has an annotation', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(0); assert.equal(s.hasData(), true);
  s.setFrame(1); assert.equal(s.hasData(), false);
});

test('addTpose creates a default-centered annotation on an empty frame', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(1);
  s.addTpose();
  assert.equal(s.hasData(), true);
  assert.deepEqual(s.current().root_pos, [0, 0, -4]);
});

test('addFromPrevious copies the most recent non-empty frame', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(1);
  s.addFromPrevious();
  assert.deepEqual(s.current().bbox, [1, 1, 1, 1]);
});

test('deleteCurrent clears the frame', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(0);
  s.deleteCurrent();
  assert.equal(s.hasData(), false);
});

test('undo reverts the last transaction to its start value', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(0);
  s.beginEdit();
  s.applyFields({ bbox: [9, 9, 9, 9] });
  s.commitEdit();
  assert.deepEqual(s.current().bbox, [9, 9, 9, 9]);
  s.undo();
  assert.deepEqual(s.current().bbox, [1, 1, 1, 1]);
});

test('undo after delete restores the full annotation, not just editable fields', () => {
  const s = new AnnotationStore(new CocoDocument({
    images: [{ id: 0 }, { id: 1 }],
    annotations: [{ id: 42, image_id: 0, bbox: [1, 1, 1, 1], betas: Array(10).fill(0),
      root_pos: [0, 0, -4], root_rota: [0, 0, 0], body_pose: Array(63).fill(0),
      keypoints: Array(156).fill(0), occlution_joint: Array(52).fill(0),
      segmentation: [[7, 7, 7]], right_hand_pose: Array(45).fill(0.3) }],
    categories: [],
  }));
  s.setFrame(0);
  s.deleteCurrent();
  s.undo();
  const a = s.current();
  assert.deepEqual(a.segmentation, [[7, 7, 7]]);
  assert.equal(a.id, 42);
  assert.equal(a.right_hand_pose[0], 0.3);
});

test('double commitEdit does not push a spurious before:null undo (no data loss)', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(0);
  s.beginEdit();
  s.applyFields({ bbox: [9, 9, 9, 9] });
  s.commitEdit();
  s.commitEdit();              // stray second commit (e.g. pointerup + change both fire)
  assert.deepEqual(s.current().bbox, [9, 9, 9, 9]);
  s.undo();                    // must revert the edit, NOT delete the annotation
  assert.equal(s.hasData(), true);
  assert.deepEqual(s.current().bbox, [1, 1, 1, 1]);
});

test('mutation updates state', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(1); s.addTpose();
  assert.equal(s.hasData(), true);
});

test('setBbox on an empty frame creates a bbox-only annotation (no SMPL)', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(1);
  s.setBbox([5, 6, 7, 8]);
  assert.equal(s.hasBbox(), true);
  assert.equal(s.hasSmpl(), false);
  assert.deepEqual(s.current().bbox, [5, 6, 7, 8]);
});

test('setBbox is one undo unit and does not touch SMPL on an existing frame', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(0);                       // has full SMPL + bbox [1,1,1,1]
  s.setBbox([5, 6, 7, 8]);
  assert.deepEqual(s.current().bbox, [5, 6, 7, 8]);
  assert.equal(s.current().body_pose.length, 63);   // SMPL untouched
  s.undo();
  assert.deepEqual(s.current().bbox, [1, 1, 1, 1]);
});

test('applyCloudResult writes SMPL as a single undo unit (does not touch bbox)', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(1);
  s.applyCloudResult({ root_pos: [1, 1, 1],
    root_rota: [0, 0, 0], body_pose: Array(63).fill(0.1), betas: Array(10).fill(0.2) });
  assert.equal(s.hasSmpl(), true);
  assert.equal(s.current().body_pose[0], 0.1);
  s.undo();
  assert.equal(s.hasData(), false);    // back to empty frame
});

test('applyCloudResult preserves a pre-existing bbox (cloud must not overwrite the user box)', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(1);
  s.setBbox([5, 6, 7, 8]);             // user-drawn box
  s.applyCloudResult({ root_pos: [1, 1, 1], root_rota: [0, 0, 0],
    body_pose: Array(63).fill(0.1), betas: Array(10).fill(0.2) });
  assert.deepEqual(s.current().bbox, [5, 6, 7, 8]);   // untouched
  assert.equal(s.hasSmpl(), true);
});

test('hasData is true when only a bbox exists', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(1);
  s.setBbox([5, 6, 7, 8]);
  assert.equal(s.hasData(), true);
});

test('addFromPrevious copies pole_vectors when the source frame has them', () => {
  const doc = new CocoDocument({
    images: [{ id: 1 }, { id: 2 }],
    annotations: [{ id: 0, image_id: 1, bbox: [0, 0, 1, 1], root_pos: [0, 0, -4], root_rota: [0, 0, 0], body_pose: Array(63).fill(0), betas: Array(10).fill(0), pole_vectors: { L_Arm: [1, 2, 3] } }],
  });
  const store = new AnnotationStore(doc);
  store.setFrame(1);
  store.addFromPrevious();
  assert.deepEqual(store.current().pole_vectors, { L_Arm: [1, 2, 3] });
});

test('addFromPrevious omits pole_vectors when the source has none', () => {
  const doc = new CocoDocument({
    images: [{ id: 1 }, { id: 2 }],
    annotations: [{ id: 0, image_id: 1, bbox: [0, 0, 1, 1], root_pos: [0, 0, -4], root_rota: [0, 0, 0], body_pose: Array(63).fill(0), betas: Array(10).fill(0) }],
  });
  const store = new AnnotationStore(doc);
  store.setFrame(1);
  store.addFromPrevious();
  assert.equal('pole_vectors' in store.current(), false);
});

// ── MHR 文档(info.body_model = 'mhr'):字段契约随人体模型切换 ──
const mhrAnn = (imageId) => ({
  id: imageId, image_id: imageId, root_pos: [1, 0, -3], root_rota: [0, 1, 0],
  mhr_pose: Array(130).fill(0.1), mhr_scale: Array(68).fill(0), mhr_shape: Array(45).fill(0.2),
  mhr_expr: Array(72).fill(0), source: { camera: 'orb1', decode_index: imageId },
});

test('mhr doc: presence is mhr_pose, T-pose uses MHR defaults', () => {
  const doc = new CocoDocument({ info: { body_model: 'mhr' }, images: [{ id: 0 }, { id: 1 }], annotations: [mhrAnn(0)] });
  const store = new AnnotationStore(doc);
  assert.equal(store.hasSmpl(), true);
  store.setFrame(1);
  assert.equal(store.hasSmpl(), false);
  store.addTpose();
  assert.equal(store.current().mhr_pose.length, 130);
  assert.equal(store.current().mhr_shape.length, 45);
  assert.equal('body_pose' in store.current(), false);
});

test('mhr doc: addFromPrevious copies MHR fields, not body_pose or stale derived fields', () => {
  const src = { ...mhrAnn(0), per_view: { orb1: { bbox: [1, 2, 3, 4] } } };
  const doc = new CocoDocument({ info: { body_model: 'mhr' }, images: [{ id: 0 }, { id: 1 }], annotations: [src] });
  const store = new AnnotationStore(doc);
  store.setFrame(1);
  store.addFromPrevious();
  const a = store.current();
  assert.deepEqual(a.mhr_pose, src.mhr_pose);
  assert.equal('per_view' in a, false);
  assert.equal('body_pose' in a, false);
});

test('mhr doc: untouched extra keys (mhr_expr, source) survive edits and serialize', () => {
  const doc = new CocoDocument({ info: { body_model: 'mhr' }, images: [{ id: 0 }], annotations: [mhrAnn(0)] });
  const store = new AnnotationStore(doc);
  store.beginEdit();
  store.applyFields({ root_pos: [2, 0, -3], body_pose: Array(63).fill(1) });   // body_pose 不属于 MHR,应被忽略
  store.commitEdit();
  const out = doc.serialize().annotations[0];
  assert.deepEqual(out.root_pos, [2, 0, -3]);
  assert.equal('body_pose' in out, false);
  assert.equal(out.mhr_expr.length, 72);
  assert.deepEqual(out.source, { camera: 'orb1', decode_index: 0 });
});

test('unknown body_model is rejected instead of silently treated as SMPL', () => {
  assert.throws(() => new CocoDocument({ info: { body_model: 'smplx' }, images: [] }), /smplx/);
});

test('onCommitted fires once per undo unit (drag commit, txn, undo) and not for deletes', () => {
  const doc = new CocoDocument({ info: { body_model: 'mhr' }, images: [{ id: 0 }, { id: 1 }], annotations: [mhrAnn(0)] });
  const store = new AnnotationStore(doc);
  const seen = [];
  store.onCommitted((id) => seen.push(id));
  store.beginEdit(); store.applyFields({ root_pos: [1, 1, -3] }); store.applyFields({ root_pos: [2, 1, -3] });
  assert.deepEqual(seen, [], 'not during drag');
  store.commitEdit();
  store.setFrame(1); store.addTpose();
  store.deleteCurrent();
  store.undo();          // 撤销删除 → 帧 1 回来
  assert.deepEqual(seen, [0, 1, 1]);
});

test('setDerived writes without an undo entry or revision bump', () => {
  const doc = new CocoDocument({ info: { body_model: 'mhr' }, images: [{ id: 0 }], annotations: [mhrAnn(0)] });
  const store = new AnnotationStore(doc);
  const rev = store.revision();
  store.setDerived(0, { keypoints: [1, 2, 2] });
  assert.equal(store.revision(), rev);
  store.undo();
  assert.deepEqual(store.current().keypoints, [1, 2, 2]);
});
