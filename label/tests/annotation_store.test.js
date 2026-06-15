import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnnotationStore } from '../src/edit/annotation_store.js';
import { CocoDocument } from '../src/io/coco_document.js';

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
