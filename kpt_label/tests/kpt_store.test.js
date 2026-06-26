import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KptStore } from '../src/kpt_store.js';

const mk = () => new KptStore({
  images: [{ file_name: 'a.jpg', width: 100, height: 100 },
           { file_name: 'b.jpg', width: 100, height: 100 }],
  nkpt: 17,
});

test('初始：每帧 0 人，无选中', () => {
  const s = mk();
  assert.equal(s.frameCount(), 2);
  assert.equal(s.persons().length, 0);
  assert.equal(s.selectedId(), null);
});

test('addPerson：新建人、自动选中、id 递增、keypoints 定长全 0', () => {
  const s = mk();
  const p = s.addPerson();
  assert.equal(p.id, 1);
  assert.equal(s.selectedId(), 1);
  assert.equal(p.bbox, null);
  assert.equal(p.keypoints.length, 17);
  assert.deepEqual(p.keypoints[0], [0, 0, 0]);
  assert.equal(s.addPerson().id, 2);
});

test('id 在同一帧内唯一且不复用已删 id', () => {
  const s = mk();
  s.addPerson(); s.addPerson();      // 1, 2
  s.select(1); s.deletePerson();     // 删 1
  assert.equal(s.addPerson().id, 3); // 不复用 1
});

test('select / deletePerson：删后选中切到剩余首个或 null', () => {
  const s = mk();
  s.addPerson(); s.addPerson();      // 1,2 选中 2
  s.select(1); s.deletePerson();
  assert.equal(s.selectedId(), 2);
  s.deletePerson();
  assert.equal(s.selectedId(), null);
});

test('setKeypoint：写入选中人的某关节 [x,y,v]', () => {
  const s = mk();
  s.addPerson();
  s.setKeypoint(5, 30, 40, 2);
  assert.deepEqual(s.persons()[0].keypoints[5], [30, 40, 2]);
});

test('setBbox：写入选中人的框', () => {
  const s = mk();
  s.addPerson();
  s.setBbox([10, 20, 30, 40]);
  assert.deepEqual(s.persons()[0].bbox, [10, 20, 30, 40]);
});

test('帧切换隔离：不同帧 persons 互不影响', () => {
  const s = mk();
  s.addPerson();
  s.setFrame(1);
  assert.equal(s.persons().length, 0);
  s.addPerson();
  s.setFrame(0);
  assert.equal(s.persons().length, 1);
});

test('undo 还原 addPerson / setKeypoint / deletePerson', () => {
  const s = mk();
  s.addPerson();
  s.setKeypoint(0, 5, 5, 2);
  s.undo();                                   // 撤销 setKeypoint
  assert.deepEqual(s.persons()[0].keypoints[0], [0, 0, 0]);
  s.undo();                                   // 撤销 addPerson
  assert.equal(s.persons().length, 0);
});

test('serialize 产出保真中间 JSON', () => {
  const s = mk();
  s.addPerson();
  s.setBbox([1, 2, 3, 4]);
  s.setKeypoint(0, 5, 6, 2);
  const obj = s.serialize();
  assert.equal(obj.schema, 'kpt-label/v1');
  assert.equal(obj.skeleton, 'coco17');
  assert.equal(obj.images.length, 2);
  assert.equal(obj.annotations[0].image_idx, 0);
  assert.deepEqual(obj.annotations[0].persons[0].bbox, [1, 2, 3, 4]);
  assert.deepEqual(obj.annotations[0].persons[0].keypoints[0], [5, 6, 2]);
});

test('fromJSON ⟷ serialize 往返一致', () => {
  const s = mk();
  s.addPerson(); s.setBbox([1, 2, 3, 4]); s.setKeypoint(1, 7, 8, 1);
  const obj = s.serialize();
  const s2 = KptStore.fromJSON(obj, 17);
  assert.deepEqual(s2.serialize(), obj);
});

test('copyFromPrevForEmpty：仅空帧可复制最近非空帧，id 本帧重排', () => {
  const s = mk();
  s.addPerson(); s.setBbox([1, 2, 3, 4]); s.setKeypoint(0, 5, 6, 2);  // 帧0：1 人
  s.setFrame(1);
  assert.equal(s.copyFromPrevForEmpty(), true);
  const ps = s.persons();
  assert.equal(ps.length, 1);
  assert.deepEqual(ps[0].bbox, [1, 2, 3, 4]);
  assert.deepEqual(ps[0].keypoints[0], [5, 6, 2]);
  assert.equal(ps[0].id, 1);              // 本帧首个 id 从 1 起
  assert.equal(s.selectedId(), 1);
});

test('copyFromPrevForEmpty：当前帧非空 → 不动返回 false', () => {
  const s = mk();
  s.addPerson();
  s.setFrame(1); s.addPerson();           // 帧1 已有人
  assert.equal(s.copyFromPrevForEmpty(), false);
  assert.equal(s.persons().length, 1);
});

test('copyFromPrevForEmpty：前方无非空帧 → false', () => {
  const s = mk();
  assert.equal(s.copyFromPrevForEmpty(), false);   // 帧0 前无帧
});

test('copyFromPrevForEmpty 可被 undo 撤销', () => {
  const s = mk();
  s.addPerson();
  s.setFrame(1); s.copyFromPrevForEmpty();
  s.undo();
  assert.equal(s.persons().length, 0);
});
