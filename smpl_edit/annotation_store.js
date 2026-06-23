// smpl_edit/annotation_store.js
const DEFAULT_ROOT_POS = [0, 0, -4];

export class AnnotationStore {
  constructor(cocoDoc) {
    this._doc = cocoDoc;
    this._ids = cocoDoc.imageIds();
    this._frame = 0;
    this._undo = [];
    this._pendingBefore = undefined; // undefined = no open drag transaction
  }

  frameCount() { return this._ids.length; }
  setFrame(i) { this._frame = i; }
  currentFrame() { return this._frame; }
  currentImageId() { return this._ids[this._frame]; }
  current() { return this._doc.getAnnotation(this.currentImageId()); }
  hasData() {
    const id = this.currentImageId();
    return this._doc.hasBbox(id) || this._doc.hasSmpl(id);
  }
  hasSmpl() { return this._doc.hasSmpl(this.currentImageId()); }
  hasBbox() { return this._doc.hasBbox(this.currentImageId()); }

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

  // 仅写 bbox(不碰 SMPL),一个 undo 单元。画框 / 云端给框用。
  setBbox(bbox) { this._txn((id) => this._doc.setAnnotation(id, { bbox })); }

  // 覆盖云端返回的 bbox + SMPL,一个 undo 单元。当前帧已有标注时直接覆盖。
  applyCloudResult({ bbox, root_pos, root_rota, body_pose, betas }) {
    this._txn((id) => this._doc.setAnnotation(id, { bbox, root_pos, root_rota, body_pose, betas }));
  }

  // Drag transaction: begin → applyFields* → commit (one undo unit).
  // _pendingBefore is undefined when no transaction is open; a captured
  // snapshot is either an annotation object or null (null = "no annotation").
  // We use `undefined` (not null) as the "no open transaction" sentinel so a
  // legitimately-null before-state is never confused with "nothing to commit".
  beginEdit() { if (this._pendingBefore === undefined) this._pendingBefore = this._snapshot(); }
  applyFields(fields) { this._doc.setAnnotation(this.currentImageId(), fields); }
  commitEdit() {
    if (this._pendingBefore === undefined) return; // no open transaction → ignore double-commit
    this._pushUndo(this.currentImageId(), this._pendingBefore);
    this._pendingBefore = undefined;
  }

  undo() {
    const u = this._undo.pop();
    if (!u) return;
    this._restore(u.imageId, u.before);
  }

  document() { return this._doc; }
}
