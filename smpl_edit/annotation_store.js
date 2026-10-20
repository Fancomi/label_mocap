// smpl_edit/annotation_store.js
import { buildMask } from './frame_marks.js';

const DEFAULT_ROOT_POS = [0, 0, -4];

export class AnnotationStore {
  constructor(cocoDoc) {
    this._doc = cocoDoc;
    this._ids = cocoDoc.imageIds();
    this._frame = 0;
    this._undo = [];
    this._pendingBefore = undefined; // undefined = no open drag transaction
    this._rev = 0;                   // 任何数据改动 +1:供「是否需要保存」与掩码缓存判定
    this._mask = null; this._maskRev = -1;
  }

  revision() { return this._rev; }

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
  // 第 i 帧(按帧位置)是否有标注(框或 SMPL),口径与 hasData 一致。
  hasDataAt(i) {
    const id = this._ids[i];
    return id !== undefined && (this._doc.hasBbox(id) || this._doc.hasSmpl(id));
  }
  // 全序列有/无标注掩码(Uint8Array,1=有)。按 revision 缓存,播放时逐帧调用不重算。
  annotatedMask() {
    if (this._maskRev !== this._rev || !this._mask) {
      this._mask = buildMask(this._ids.length, (i) => this.hasDataAt(i));
      this._maskRev = this._rev;
    }
    return this._mask;
  }

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
    this._rev++;
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
    const fields = {
      bbox: src.bbox, root_pos: src.root_pos, root_rota: src.root_rota,
      body_pose: src.body_pose, betas: src.betas,
    };
    if (src.pole_vectors) fields.pole_vectors = src.pole_vectors;
    this._txn((id) => this._doc.setAnnotation(id, fields));
  }

  deleteCurrent() { this._txn((id) => this._doc.deleteAnnotation(id)); }

  // 仅写 bbox(不碰 SMPL),一个 undo 单元。画框 / 云端给框用。
  setBbox(bbox) { this._txn((id) => this._doc.setAnnotation(id, { bbox })); }

  // 覆盖云端返回的 SMPL,一个 undo 单元。当前帧已有标注时直接覆盖。
  // 只写传入的键 —— 调用方(云端)只传 SMPL 四件套,不传 bbox,故 bbox 不受影响
  // (bbox⊥SMPL:带框推理时用户的框是输入,应保留;纯图推理不应凭空造框)。
  applyCloudResult(fields) {
    this._txn((id) => this._doc.setAnnotation(id, fields));
  }

  // Drag transaction: begin → applyFields* → commit (one undo unit).
  // _pendingBefore is undefined when no transaction is open; a captured
  // snapshot is either an annotation object or null (null = "no annotation").
  // We use `undefined` (not null) as the "no open transaction" sentinel so a
  // legitimately-null before-state is never confused with "nothing to commit".
  beginEdit() { if (this._pendingBefore === undefined) this._pendingBefore = this._snapshot(); }
  applyFields(fields) { this._doc.setAnnotation(this.currentImageId(), fields); this._rev++; }
  commitEdit() {
    if (this._pendingBefore === undefined) return; // no open transaction → ignore double-commit
    this._pushUndo(this.currentImageId(), this._pendingBefore);
    this._pendingBefore = undefined;
  }

  undo() {
    const u = this._undo.pop();
    if (!u) return;
    this._restore(u.imageId, u.before);
    this._rev++;
  }

  document() { return this._doc; }
}
