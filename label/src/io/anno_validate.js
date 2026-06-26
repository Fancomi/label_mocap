// label/src/io/anno_validate.js
// 标注 JSON 的格式判据（纯函数，无 DOM/IO）。加载手动指定的 JSON 前用它确认
// 格式正确，避免把 kpt 工程加进 SMPL 标注器、或反之。
const isObj = (v) => typeof v === 'object' && v !== null;

// COCO 标注（label / pcd 的 player_0.json）：CocoDocument 的最小入参契约 = images 数组。
export function isCocoDoc(obj) {
  return isObj(obj) && Array.isArray(obj.images);
}

// kpt 工程（kpt_label_project.json）：由 KptStore.serialize 写出，schema 标记版本。
export function isKptProject(obj) {
  return isObj(obj) && obj.schema === 'kpt-label/v1';
}
