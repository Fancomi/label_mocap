import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPersonSet, addEmptyPerson, renumberPerson, savePersonSet, parsePersonId, emptyDocLike, probeAnnotation } from '../person_io.js';

const ann = (k, img) => ({ id: k, image_id: img, root_pos: [0, 0, 0], root_rota: [0, 0, 0], body_pose: Array(63).fill(0), betas: Array(10).fill(0) });
const doc = (imgs) => ({ images: [{ id: 0 }, { id: 1 }, { id: 2 }], annotations: imgs.map((i, k) => ann(k, i)), categories: [] });

function fakeFs(files) {
  const fs = new Map(Object.entries(files));
  return {
    fs,
    paths: () => [...fs.keys()],
    readJson: async (p) => (fs.has(p) ? structuredClone(fs.get(p)) : null),
    writeJson: async (p, obj) => { fs.set(p, obj); return p; },
    removeFile: async (p) => { fs.delete(p); },
  };
}

test('loadPersonSet discovers player_0/1 and skips non-COCO files', async () => {
  const f = fakeFs({ 'player_0.json': doc([0]), 'player_1.json': doc([1, 2]), 'player_2.json': { foo: 1 }, 'manifest.json': {} });
  const { persons, skipped } = await loadPersonSet({ paths: f.paths(), primaryPath: 'player_0.json', readJson: f.readJson, fallbackRaw: emptyDocLike(doc([])) });
  assert.deepEqual(persons.list().map((p) => p.id), [0, 1]);
  assert.deepEqual(skipped, ['player_2.json']);
  assert.equal(persons.currentId(), 0);
  assert.deepEqual([...persons.get(1).store.annotatedMask()], [0, 1, 1]);
  assert.equal(persons.anyDirty(), false);
});

test('loadPersonSet with no files yields a clean player_0 placeholder', async () => {
  const f = fakeFs({});
  const { persons } = await loadPersonSet({ paths: [], primaryPath: 'player_0.json', readJson: f.readJson, fallbackRaw: emptyDocLike(doc([])) });
  assert.equal(persons.size(), 1);
  assert.equal(persons.current().path, 'player_0.json');
  assert.equal(persons.current().store.frameCount(), 3);
  assert.equal(persons.anyDirty(), false);
});

test('add / renumber / remove then save writes and deletes the right files', async () => {
  const f = fakeFs({ 'player_0.json': doc([0]), 'player_1.json': doc([1]) });
  const { persons } = await loadPersonSet({ paths: f.paths(), primaryPath: 'player_0.json', readJson: f.readJson, fallbackRaw: null });
  const p2 = addEmptyPerson(persons, 'player_0.json', 2);
  assert.equal(p2.id, 2);
  assert.equal(p2.path, 'player_2.json');
  assert.equal(p2.store.currentFrame(), 2);
  assert.equal(p2.store.frameCount(), 3);
  assert.equal(p2.store.annotatedMask().reduce((a, b) => a + b, 0), 0);
  p2.store.addTpose();
  renumberPerson(persons, 'player_0.json', 1, 7);
  persons.remove(0);
  const serialize = (s) => s.document().serialize();
  const { written, removed } = await savePersonSet(persons, { serialize, writeJson: f.writeJson, removeFile: f.removeFile });
  assert.deepEqual(written.sort(), ['player_2.json', 'player_7.json']);
  assert.deepEqual(removed.sort(), ['player_0.json', 'player_1.json']);
  assert.deepEqual(f.paths().sort(), ['player_2.json', 'player_7.json']);
  assert.equal(f.fs.get('player_2.json').annotations.length, 1);
  assert.equal(persons.anyDirty(), false);
});

test('save always writes the current person, skips clean others', async () => {
  const f = fakeFs({ 'player_0.json': doc([0]), 'player_1.json': doc([1]) });
  const { persons } = await loadPersonSet({ paths: f.paths(), primaryPath: 'player_0.json', readJson: f.readJson, fallbackRaw: null });
  persons.select(1);
  const { written } = await savePersonSet(persons, { serialize: (s) => s.document().serialize(), writeJson: f.writeJson });
  assert.deepEqual(written, ['player_1.json']);
});

test('parsePersonId validates input', async () => {
  const f = fakeFs({ 'player_0.json': doc([0]) });
  const { persons } = await loadPersonSet({ paths: f.paths(), primaryPath: 'player_0.json', readJson: f.readJson, fallbackRaw: null });
  assert.equal(parsePersonId(' 3 ', persons), 3);
  assert.throws(() => parsePersonId('0', persons), /已存在/);
  assert.throws(() => parsePersonId('-1', persons), /非负整数/);
  assert.throws(() => parsePersonId('a', persons), /非负整数/);
});

test('inferPrimaryPath derives player_0 path from any family member', async () => {
  const { inferPrimaryPath } = await import('../person_files.js');
  assert.equal(inferPrimaryPath(['a/player_1.json', 'x.png']), 'a/player_0.json');
  assert.equal(inferPrimaryPath(['json_results/player_2/player_2.json']), 'json_results/player_0/player_0.json');
  assert.equal(inferPrimaryPath(['foo.json']), null);
});

test('loadPersonSet accepts a lazy fallback', async () => {
  let called = 0;
  const { persons } = await loadPersonSet({ paths: [], primaryPath: 'player_0.json', readJson: async () => null, fallbackRaw: () => { called++; return emptyDocLike(doc([])); } });
  assert.equal(called, 1);
  assert.equal(persons.current().store.frameCount(), 3);
});

test('emptyDocLike keeps body model and camera config, drops annotations', () => {
  const raw = { info: { body_model: 'mhr' }, cameras: [{ id: 'orb1' }], images: [{ id: 0 }], annotations: [{ id: 0, image_id: 0 }], categories: [] };
  const e = emptyDocLike(raw);
  assert.deepEqual(e.info, { body_model: 'mhr' });
  assert.deepEqual(e.cameras, [{ id: 'orb1' }]);
  assert.deepEqual(e.annotations, []);
  assert.equal('info' in emptyDocLike({ images: [] }), false);
});

test('extras: other annotation jsons beside player_N load as named persons; junk and manifests are not', async () => {
  const f = fakeFs({
    'player_0.json': doc([0]), 'player_pred.json': doc([1, 2]), 'manifest.json': { kind: 'lidar' },
    '.lai_viewer.json': doc([0]), 'notes.json': { foo: 1 }, 'long.json': { images: [0, 1, 2, 3].map((id) => ({ id })), annotations: [] },
    'analysis/diving.analysis.json': doc([0]),
  });
  const { persons, skipped, extras } = await loadPersonSet({ paths: f.paths(), primaryPath: 'player_0.json', readJson: f.readJson, fallbackRaw: emptyDocLike(doc([])), extras: true, frameCount: 3 });
  assert.deepEqual(persons.list().map((p) => [p.id, persons.labelOf(p.id)]), [[0, 'player_0'], [1, 'player_pred']]);
  assert.deepEqual(extras, ['player_pred.json']);
  assert.deepEqual(skipped.sort(), ['long.json', 'notes.json']);
  assert.throws(() => renumberPerson(persons, 'player_0.json', 1, 5), /不能改号/);
});

test('extras: a directory with only a prediction file opens it instead of an empty placeholder', async () => {
  const f = fakeFs({ 'player_pred.json': doc([0, 1]), 'manifest.json': {} });
  const { persons } = await loadPersonSet({ paths: f.paths(), primaryPath: 'player_0.json', readJson: f.readJson, fallbackRaw: emptyDocLike(doc([])), extras: true, frameCount: 3 });
  assert.deepEqual(persons.list().map((p) => persons.labelOf(p.id)), ['player_pred']);
  assert.equal(persons.current().path, 'player_pred.json');
});

test('probeAnnotation: rejects with a reason; shorter-than-sequence files load with a note', () => {
  assert.deepEqual(probeAnnotation(doc([0]), 3), { ok: true });
  const short = probeAnnotation(doc([0]), 5);
  assert.equal(short.ok, true);
  assert.match(short.note, /按位置对齐前 3 帧/);
  assert.match(probeAnnotation(doc([0]), 2).reason, /多于/);
  assert.match(probeAnnotation({ images: [], annotations: [{ id: 0 }] }).reason, /人体参数/);
  assert.match(probeAnnotation({ a: 1 }).reason, /COCO/);
});

test('extras: a prediction covering only the first frames still loads (real pred data: 20 of 41 frames)', async () => {
  const f = fakeFs({ 'player_pred.json': doc([0, 1]), 'manifest.json': {} });
  const { persons, notes } = await loadPersonSet({ paths: f.paths(), primaryPath: 'player_0.json', readJson: f.readJson, fallbackRaw: emptyDocLike(doc([])), extras: true, frameCount: 41 });
  assert.deepEqual(persons.list().map((p) => persons.labelOf(p.id)), ['player_pred']);
  assert.match(notes['player_pred.json'], /41/);
  const st = persons.current().store;
  assert.equal(st.frameCount(), 41, 'frame axis padded to the sequence');
  assert.deepEqual([...st.annotatedMask()].slice(0, 4), [1, 1, 0, 0]);
});
