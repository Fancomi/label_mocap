// smpl_edit/coco_document.js
import { bodyModelNameOf, bodySchemaOf } from '../smpl_core/body_model.js';

// 与人体模型无关的可编辑键;人体参数键由 info.body_model 决定(默认 smpl)。
// per_view = 多相机时按相机 id 存的派生量 { [cameraId]: { bbox, keypoints, occlution_joint } }(原生像素);
// 顶层 bbox/keypoints/occlution_joint = 主相机 cameras[0],与单视角格式兼容。
// source = 该帧人体参数的来源(哪台相机的预测 / 是否被采用),逐帧采用时改写。
const COMMON_EDITABLE = ['bbox', 'per_view', 'keypoints', 'occlution_joint', 'pole_vectors', 'source'];

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
    this._schema = bodySchemaOf(raw);
    this._editable = [...COMMON_EDITABLE, ...this._schema.fieldKeys];
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
  // 多相机配置(只读;单视角旧数据为 null)。见 smpl_edit/camera_rig.js。
  cameras() { return this._raw.cameras ?? null; }
  images() { return this._raw.images ?? []; }
  imageInfo(id) { return (this._raw.images ?? []).find((im) => im.id === id) ?? null; }
  getAnnotation(imageId) { return this._byImageId.get(imageId) ?? null; }
  bodyModelName() { return bodyModelNameOf(this._raw); }
  bodySchema() { return this._schema; }

  // 人体是否存在 = 该模型的代表键是否存在(SMPL: body_pose,MHR: mhr_pose),而非「是否全零」。
  // 名字沿用 hasSmpl(调用方众多),语义是「有人体参数」。
  hasSmpl(imageId) {
    const a = this._byImageId.get(imageId);
    return !!a && this._schema.presenceKey in a;
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
    for (const key of this._editable) {
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
