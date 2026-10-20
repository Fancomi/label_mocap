import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMask, countMarked, findMarked, markRuns, markedSummary } from '../frame_marks.js';
import { personTemplate, discoverPersons, personLabel } from '../person_files.js';
import { PersonSet } from '../person_set.js';
import { AnnotationStore } from '../annotation_store.js';
import { CocoDocument } from '../coco_document.js';

const mask = (s) => Uint8Array.from(s, (c) => (c === '1' ? 1 : 0));

test('buildMask / countMarked', () => {
  const m = buildMask(5, (i) => i % 2 === 0);
  assert.deepEqual([...m], [1, 0, 1, 0, 1]);
  assert.equal(countMarked(m), 3);
  assert.equal(countMarked(buildMask(0, () => true)), 0);
});

test('findMarked skips the start frame and does not wrap', () => {
  const m = mask('0110010');
  assert.equal(findMarked(m, 0, +1), 1);
  assert.equal(findMarked(m, 1, +1), 2);
  assert.equal(findMarked(m, 2, +1), 5);
  assert.equal(findMarked(m, 5, +1), -1);
  assert.equal(findMarked(m, 6, -1), 5);
  assert.equal(findMarked(m, 5, -1), 2);
  assert.equal(findMarked(m, 1, -1), -1);
  assert.equal(findMarked(mask('000'), 1, +1), -1);
});

test('markRuns returns contiguous annotated ranges (end exclusive)', () => {
  assert.deepEqual(markRuns(mask('0110010')), [[1, 3], [5, 6]]);
  assert.deepEqual(markRuns(mask('111')), [[0, 3]]);
  assert.deepEqual(markRuns(mask('000')), []);
  assert.deepEqual(markRuns(mask('1001')), [[0, 1], [3, 4]]);
});

test('markedSummary single vs multi person', () => {
  assert.equal(markedSummary([]), '已标注 0 帧');
  assert.equal(markedSummary([{ label: 'player_0', count: 3 }]), '已标注 3 帧');
  assert.equal(markedSummary([{ label: 'player_0', count: 3 }, { label: 'player_1', count: 9 }]),
    '已标注 player_0 3 帧 / player_1 9 帧');
});

test('personTemplate: flat player_N.json in same dir', () => {
  const t = personTemplate('player_0.json');
  assert.equal(t.pathFor(2), 'player_2.json');
  assert.equal(t.idOf('player_11.json'), 11);
  assert.equal(t.idOf('sub/player_1.json'), null);
  const t2 = personTemplate('seq/player_0.json');
  assert.equal(t2.pathFor(1), 'seq/player_1.json');
  assert.equal(t2.idOf('seq/player_3.json'), 3);
  assert.equal(t2.idOf('player_3.json'), null);
});

test('personTemplate: nested json_results/player_N/player_N.json', () => {
  const t = personTemplate('json_results/player_0/player_0.json');
  assert.equal(t.pathFor(1), 'json_results/player_1/player_1.json');
  assert.equal(t.idOf('json_results/player_4/player_4.json'), 4);
  assert.equal(t.idOf('json_results/player_4/player_5.json'), null);
});

test('personTemplate: arbitrary <name>.json → 0 is itself, others <name>_player_N.json', () => {
  const t = personTemplate('images.json');
  assert.equal(t.pathFor(0), 'images.json');
  assert.equal(t.pathFor(1), 'images_player_1.json');
  assert.equal(t.idOf('images.json'), 0);
  assert.equal(t.idOf('images_player_2.json'), 2);
  assert.equal(t.idOf('other.json'), null);
});

test('discoverPersons finds same-family files sorted by id', () => {
  const paths = ['manifest.json', 'player_1.json', 'frame_000000.png', 'player_0.json', 'player_10.json', 'x/player_2.json'];
  assert.deepEqual(discoverPersons(paths, 'player_0.json'), [
    { id: 0, path: 'player_0.json' }, { id: 1, path: 'player_1.json' }, { id: 10, path: 'player_10.json' },
  ]);
  assert.deepEqual(discoverPersons(paths, null), []);
  assert.equal(personLabel(3), 'player_3');
});

function store(nFrames, annotated = []) {
  return new AnnotationStore(new CocoDocument({
    images: Array.from({ length: nFrames }, (_, i) => ({ id: i })),
    annotations: annotated.map((i, k) => ({ id: k, image_id: i, root_pos: [0, 0, 0], root_rota: [0, 0, 0], body_pose: Array(63).fill(0), betas: Array(10).fill(0) })),
    categories: [],
  }));
}

test('PersonSet add/select/remove keeps a current person and tracks deleted files', () => {
  const ps = new PersonSet([{ id: 0, path: 'player_0.json', store: store(4, [0]) }, { id: 1, path: 'player_1.json', store: store(4, [2]) }]);
  assert.equal(ps.currentId(), 0);
  assert.equal(ps.nextId(), 2);
  ps.select(1, 3);
  assert.equal(ps.currentId(), 1);
  assert.equal(ps.current().store.currentFrame(), 3);
  ps.add({ id: 2, path: 'player_2.json', store: store(4), isNew: true });
  ps.select(2);
  assert.equal(ps.remove(2).id, 1);                 // 删最后一个 → 选前一个
  assert.deepEqual(ps.removedPaths(), []);          // 新建未落盘的不删盘
  ps.select(0);
  assert.equal(ps.remove(0).id, 1);                 // 删当前 → 选后一个
  assert.deepEqual(ps.removedPaths(), ['player_0.json']);
  assert.throws(() => ps.remove(1), /至少保留一个人物/);
  assert.throws(() => ps.add({ id: 1, path: 'p', store: store(1) }), /已存在/);
  ps.add({ id: 0, path: 'player_0.json', store: store(4), isNew: true }); // 删了又建回同号 → 不再删盘
  assert.deepEqual(ps.removedPaths(), []);
  ps.markSaved();
  assert.equal(ps.get(0).isNew, false);
});

test('PersonSet dirty tracks store edits, new persons, and markSaved', () => {
  const ps = new PersonSet([{ id: 0, path: 'player_0.json', store: store(2) }]);
  assert.equal(ps.anyDirty(), false);
  ps.current().store.addTpose();
  assert.equal(ps.dirty(ps.current()), true);
  ps.markSaved();
  assert.equal(ps.anyDirty(), false);
  ps.add({ id: 1, path: 'player_1.json', store: store(2), isNew: true });
  assert.equal(ps.anyDirty(), true);
  ps.markSaved();
  ps.replaceStore(1, store(2));
  assert.equal(ps.dirty(ps.get(1)), true);
});

test('PersonSet renumber moves file and keeps selection', () => {
  const ps = new PersonSet([{ id: 0, path: 'player_0.json', store: store(2) }, { id: 1, path: 'player_1.json', store: store(2) }]);
  assert.throws(() => ps.renumber(0, 1, 'player_1.json'), /已存在/);
  ps.renumber(0, 5, 'player_5.json');
  assert.equal(ps.currentId(), 5);
  assert.deepEqual(ps.list().map((p) => p.id), [1, 5]);
  assert.deepEqual(ps.removedPaths(), ['player_0.json']);
  assert.equal(ps.get(5).isNew, true);
  ps.renumber(5, 0, 'player_0.json');               // 改回原号 → 不删盘
  assert.deepEqual(ps.removedPaths(), []);
});

test('AnnotationStore annotatedMask follows edits and undo; revision bumps', () => {
  const s = store(4, [1]);
  assert.deepEqual([...s.annotatedMask()], [0, 1, 0, 0]);
  assert.equal(s.hasDataAt(1), true);
  assert.equal(s.hasDataAt(9), false);
  const r0 = s.revision();
  s.setFrame(3); s.addTpose();
  assert.ok(s.revision() > r0);
  assert.deepEqual([...s.annotatedMask()], [0, 1, 0, 1]);
  s.undo();
  assert.deepEqual([...s.annotatedMask()], [0, 1, 0, 0]);
  s.setFrame(1); s.beginEdit(); s.applyFields({ root_pos: [1, 1, 1] }); s.commitEdit();
  s.deleteCurrent();
  assert.deepEqual([...s.annotatedMask()], [0, 0, 0, 0]);
});
