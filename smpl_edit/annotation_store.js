// smpl_edit/annotation_store.js
import { buildMask } from './frame_marks.js';

export class AnnotationStore {
  constructor(cocoDoc) {
    this._doc = cocoDoc;
    this._ids = cocoDoc.imageIds();
    this._frame = 0;
    this._undo = [];
    this._pendingBefore = undefined; // undefined = no open drag transaction
    this._rev = 0;                   // 任何数据改动 +1:供「是否需要保存」与掩码缓存判定
    this._mask = null; this._maskRev = -1;
    this._committed = new Set();     // 监听者:某帧人体参数「定稿」(一个 undo 单元结束)时调用 fn(imageId)
  }

  // 定稿事件:拖拽/面板编辑松手、新建/复制/采用、撤销后触发,每个 undo 单元一次(删除帧不触发)。
  // 宿主在此为该帧算派生量(keypoints/遮挡/逐视角框),保存只做序列化 —— 不在保存时逐帧重算。
  onCommitted(fn) { this._committed.add(fn); return () => this._committed.delete(fn); }
  _emitCommitted(imageId) {
    if (!this._doc.getAnnotation(imageId)) return;
    for (const fn of this._committed) fn(imageId);
  }

  // 派生量写回(不进 undo、不算改动):它们是人体参数的函数,随参数一起被 undo 快照覆盖。
  setDerived(imageId, fields) { this._doc.setAnnotation(imageId, fields); }

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
    this._emitCommitted(imageId);
  }

  addTpose() {
    this._txn((id) => this._doc.setAnnotation(id, this._doc.bodySchema().defaultFields()));
  }

  addFromPrevious() {
    let src = null;
    for (let i = this._frame - 1; i >= 0; i--) {
      const a = this._doc.getAnnotation(this._ids[i]);
      if (a) { src = a; break; }
    }
    if (!src) { this.addTpose(); return; }
    const fields = { bbox: src.bbox };
    for (const k of this._doc.bodySchema().fieldKeys) fields[k] = src[k];
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
    this._emitCommitted(this.currentImageId());
  }

  canUndo() { return this._undo.length > 0; }

  undo() {
    const u = this._undo.pop();
    if (!u) return;
    this._restore(u.imageId, u.before);
    this._rev++;
    this._emitCommitted(u.imageId);
  }

  document() { return this._doc; }
}
