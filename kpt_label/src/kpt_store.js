// kpt_label/src/kpt_store.js
// 多人 2D 标注模型（纯逻辑，无 DOM）。一帧 = 有序 persons 列表。
// 每人：{ id, bbox:[x,y,w,h]|null, keypoints: Array(nkpt) of [x,y,v] }。
// 撤销：每个写操作前快照该帧 persons，commit 时入栈。
const clone = (v) => structuredClone(v);

export class KptStore {
  constructor({ images, skeleton = 'coco17', nkpt }) {
    this._images = images.map((im) => ({ file_name: im.file_name, width: im.width, height: im.height }));
    this._skeleton = skeleton;
    this._nkpt = nkpt;
    this._frames = images.map(() => ({ persons: [] }));   // 按 image_idx
    this._nextId = images.map(() => 1);                   // 每帧独立、单调递增的 id 计数
    this._frame = 0;
    this._sel = null;                                     // 选中 person id（本帧）
    this._undo = [];
    this._pending = null;                                 // 拖拽事务快照
  }

  static fromJSON(obj, nkpt) {
    const s = new KptStore({ images: obj.images, skeleton: obj.skeleton, nkpt });
    for (const ann of obj.annotations ?? []) {
      const f = s._frames[ann.image_idx];
      if (!f) continue;
      f.persons = (ann.persons ?? []).map((p) => ({
        id: p.id,
        bbox: p.bbox ? p.bbox.slice() : null,
        keypoints: p.keypoints.map((k) => k.slice()),
      }));
      const maxId = f.persons.reduce((m, p) => Math.max(m, p.id), 0);
      s._nextId[ann.image_idx] = maxId + 1;
    }
    return s;
  }

  frameCount() { return this._frames.length; }
  setFrame(i) { this._frame = i; this._sel = null; }
  currentFrame() { return this._frame; }
  imageInfo(i = this._frame) { return this._images[i]; }
  persons() { return this._frames[this._frame].persons; }
  selectedId() { return this._sel; }
  selected() { return this.persons().find((p) => p.id === this._sel) ?? null; }
  select(id) { this._sel = this.persons().some((p) => p.id === id) ? id : null; }

  _emptyKpts() { return Array.from({ length: this._nkpt }, () => [0, 0, 0]); }
  _snapshot() { return clone(this._frames[this._frame].persons); }
  _txn(fn) { const before = this._snapshot(); const sel = this._sel; fn(); this._undo.push({ frame: this._frame, before, selBefore: sel }); }

  addPerson() {
    let p;
    this._txn(() => {
      p = { id: this._nextId[this._frame]++, bbox: null, keypoints: this._emptyKpts() };
      this.persons().push(p);
      this._sel = p.id;
    });
    return p;
  }

  deletePerson() {
    if (this._sel == null) return;
    this._txn(() => {
      const list = this.persons();
      const i = list.findIndex((p) => p.id === this._sel);
      if (i >= 0) list.splice(i, 1);
      this._sel = list.length ? list[0].id : null;
    });
  }

  setBbox(bbox) {
    if (this._sel == null) return;
    this._txn(() => { this.selected().bbox = bbox ? bbox.slice() : null; });
  }

  setKeypoint(idx, x, y, v) {
    if (this._sel == null) return;
    this._txn(() => { this.selected().keypoints[idx] = [x, y, v]; });
  }

  // 拖拽事务：begin → applyKeypoint*/applyBbox* → commit（一个 undo 单元）。
  beginEdit() { if (this._pending === null) this._pending = this._snapshot(); }
  applyKeypoint(idx, x, y, v) { const p = this.selected(); if (p) p.keypoints[idx] = [x, y, v]; }
  applyBbox(bbox) { const p = this.selected(); if (p) p.bbox = bbox ? bbox.slice() : null; }
  commitEdit() {
    if (this._pending === null) return;
    this._undo.push({ frame: this._frame, before: this._pending, selBefore: this._sel });
    this._pending = null;
  }

  undo() {
    const u = this._undo.pop();
    if (!u) return;
    this._frames[u.frame].persons = u.before;
    if (u.frame === this._frame) this._sel = u.selBefore;
  }

  serialize() {
    return {
      schema: 'kpt-label/v1',
      skeleton: this._skeleton,
      images: this._images.map((im) => ({ ...im })),
      annotations: this._frames.map((f, image_idx) => ({
        image_idx,
        persons: f.persons.map((p) => ({
          id: p.id,
          bbox: p.bbox ? p.bbox.slice() : null,
          keypoints: p.keypoints.map((k) => k.slice()),
        })),
      })),
    };
  }
}
