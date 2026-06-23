// smpl_edit/coco_document.js
const EDITABLE = ['bbox', 'root_pos', 'root_rota', 'body_pose', 'betas', 'keypoints', 'occlution_joint'];

// 空骨架:只含恒有的元字段。bbox / SMPL 位姿都不预填 —— 由 setAnnotation 按
// 实际传入的 fields 决定,从而让「仅 bbox」「仅 SMPL」成为可表达的合法状态。
function skeletonAnnotation(imageId, nextId) {
  return {
    id: nextId, image_id: imageId,
    iscrowd: 0, area: 0, category_id: 1, segmentation: [],
  };
}

export class CocoDocument {
  constructor(raw) {
    this._raw = raw;
    this._byImageId = new Map();
    // v1 single-person: one annotation per image_id (last wins). Multi-person
    // would key by annotation id. Surface the lossy case rather than silently
    // dropping extra people, so a multi-person dataset isn't quietly corrupted.
    let collisions = 0;
    for (const a of raw.annotations ?? []) {
      if (this._byImageId.has(a.image_id)) collisions++;
      this._byImageId.set(a.image_id, structuredClone(a));
    }
    if (collisions > 0 && typeof console !== 'undefined') {
      console.warn(`CocoDocument: ${collisions} annotation(s) dropped — v1 supports one person per image_id (last wins).`);
    }
  }

  imageIds() { return (this._raw.images ?? []).map((im) => im.id); }
  images() { return this._raw.images ?? []; }
  imageInfo(id) { return (this._raw.images ?? []).find((im) => im.id === id) ?? null; }
  getAnnotation(imageId) { return this._byImageId.get(imageId) ?? null; }

  // SMPL 是否存在 = 位姿键 body_pose 是否存在(代表键),而非「是否全零」。
  hasSmpl(imageId) {
    const a = this._byImageId.get(imageId);
    return !!a && 'body_pose' in a;
  }

  hasBbox(imageId) {
    const a = this._byImageId.get(imageId);
    if (!a || !Array.isArray(a.bbox)) return false;
    return a.bbox.some((v) => v !== 0);   // [0,0,0,0] sentinel = no box
  }

  _nextId() {
    let max = -1;
    for (const a of this._byImageId.values()) max = Math.max(max, a.id ?? -1);
    return max + 1;
  }

  setAnnotation(imageId, fields) {
    let a = this._byImageId.get(imageId);
    if (!a) { a = skeletonAnnotation(imageId, this._nextId()); this._byImageId.set(imageId, a); }
    for (const key of EDITABLE) {
      if (fields[key] !== undefined) a[key] = structuredClone(fields[key]);
    }
  }

  deleteAnnotation(imageId) { this._byImageId.delete(imageId); }

  // Lossless re-insert of a full annotation snapshot (used by undo-after-delete).
  restoreAnnotation(imageId, fullAnnotation) {
    this._byImageId.set(imageId, structuredClone(fullAnnotation));
  }

  serialize() {
    const out = structuredClone(this._raw);
    out.annotations = this.imageIds()
      .filter((id) => this._byImageId.has(id))
      .map((id) => structuredClone(this._byImageId.get(id)));
    return out;
  }
}
