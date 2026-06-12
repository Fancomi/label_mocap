// label/src/edit/annotation_store.js
const DEFAULT_ROOT_POS = [0, 0, -4];

export class AnnotationStore {
  constructor(cocoDoc) {
    this._doc = cocoDoc;
    this._ids = cocoDoc.imageIds();
    this._frame = 0;
    this._undo = [];
    this._listeners = new Set();
    this._pendingBefore = null;
  }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _notify() { for (const fn of this._listeners) fn(); }

  frameCount() { return this._ids.length; }
  setFrame(i) { this._frame = i; this._notify(); }
  currentFrame() { return this._frame; }
  currentImageId() { return this._ids[this._frame]; }
  current() { return this._doc.getAnnotation(this.currentImageId()); }
  hasData() { return this.current() !== null; }

  _snapshot() {
    const a = this.current();
    return a ? structuredClone(a) : null;
  }
  _restore(imageId, snap) {
    if (snap === null) this._doc.deleteAnnotation(imageId);
    else this._doc.restoreAnnotation(imageId, snap);
  }
  _pushUndo(imageId, before) { this._undo.push({ imageId, before }); }

  _txn(fn) {
    const imageId = this.currentImageId();
    const before = this._snapshot();
    fn(imageId);
    this._pushUndo(imageId, before);
    this._notify();
  }

  addTpose() {
    this._txn((id) => this._doc.setAnnotation(id, {
      root_pos: DEFAULT_ROOT_POS.slice(), root_rota: [0, 0, 0],
      body_pose: Array(63).fill(0), betas: Array(10).fill(0),
    }));
  }

  addFromPrevious() {
    let src = null;
    for (let i = this._frame - 1; i >= 0; i--) {
      const a = this._doc.getAnnotation(this._ids[i]);
      if (a) { src = a; break; }
    }
    if (!src) { this.addTpose(); return; }
    this._txn((id) => this._doc.setAnnotation(id, {
      bbox: src.bbox, root_pos: src.root_pos, root_rota: src.root_rota,
      body_pose: src.body_pose, betas: src.betas,
    }));
  }

  deleteCurrent() { this._txn((id) => this._doc.deleteAnnotation(id)); }

  // Drag transaction: begin → applyFields* → commit (one undo unit).
  beginEdit() { this._pendingBefore = this._snapshot(); }
  applyFields(fields) { this._doc.setAnnotation(this.currentImageId(), fields); this._notify(); }
  commitEdit() {
    this._pushUndo(this.currentImageId(), this._pendingBefore);
    this._pendingBefore = null;
  }

  undo() {
    const u = this._undo.pop();
    if (!u) return;
    this._restore(u.imageId, u.before);
    this._notify();
  }

  document() { return this._doc; }
}
