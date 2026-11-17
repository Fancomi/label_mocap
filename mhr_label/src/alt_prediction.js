// mhr_label/src/alt_prediction.js — 其他视角的独立预测(如 sam3d 侧机结果),供逐帧「采用」(纯逻辑)。
// 文件约定:json_results/sam3d_<cameraId>_pred.json,与主标注同格式(同 images、同世界系)。

const PRED_RE = /(^|\/)sam3d_([^/]+)_pred\.json$/;

// 目录里的全部预测文件 → [{ cameraId, path }]
export function findPredictionFiles(paths) {
  return paths.map((p) => { const m = PRED_RE.exec(p); return m ? { cameraId: m[2], path: p } : null; }).filter(Boolean);
}

// 按 image_id 建索引:imageId → annotation
export function indexPrediction(raw) {
  const m = new Map();
  for (const a of raw?.annotations ?? []) m.set(a.image_id, a);
  return m;
}

// 采用某帧预测:只取人体参数键(fieldKeys),不带 bbox/keypoints;无该帧或缺键返回 null。
export function predictionFields(index, imageId, fieldKeys) {
  const a = index?.get(imageId);
  if (!a || !fieldKeys.every((k) => k in a)) return null;
  const out = {};
  for (const k of fieldKeys) out[k] = structuredClone(a[k]);
  return out;
}
