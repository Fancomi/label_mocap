// label/src/io/coco_document.js
const EDITABLE = ['bbox', 'root_pos', 'root_rota', 'body_pose', 'betas', 'keypoints', 'occlution_joint'];

function defaultAnnotation(imageId, nextId) {
  return {
    id: nextId, image_id: imageId, bbox: [0, 0, 0, 0],
    keypoints: Array(156).fill(0), p3d: [], iscrowd: 0, area: 0, category_id: 1,
    segmentation: [], occlution_joint: Array(52).fill(0),
    betas: Array(10).fill(0), root_pos: [0, 0, -4], root_rota: [0, 0, 0],
    body_pose: Array(63).fill(0), right_hand_pose: Array(45).fill(0), left_hand_pose: Array(45).fill(0),
  };
}

export class CocoDocument {
  constructor(raw) {
    this._raw = raw;
    this._byImageId = new Map();
    // v1 single-person: one annotation per image_id (last wins). Multi-person would key by annotation id.
    for (const a of raw.annotations ?? []) this._byImageId.set(a.image_id, structuredClone(a));
  }

  imageIds() { return (this._raw.images ?? []).map((im) => im.id); }
  imageInfo(id) { return (this._raw.images ?? []).find((im) => im.id === id) ?? null; }
  getAnnotation(imageId) { return this._byImageId.get(imageId) ?? null; }

  _nextId() {
    let max = -1;
    for (const a of this._byImageId.values()) max = Math.max(max, a.id ?? -1);
    return max + 1;
  }

  setAnnotation(imageId, fields) {
    let a = this._byImageId.get(imageId);
    if (!a) { a = defaultAnnotation(imageId, this._nextId()); this._byImageId.set(imageId, a); }
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
