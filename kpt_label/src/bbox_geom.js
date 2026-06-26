// kpt_label/src/bbox_geom.js
// 2D 框纯几何（无 DOM）。坐标均为图像像素。
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// corner: 'tl'|'tr'|'bl'|'br'，对角固定。返回规整 [x,y,w,h]。
export function resizeBboxByCorner([x, y, w, h], corner, [px, py]) {
  let x0 = x, y0 = y, x1 = x + w, y1 = y + h;
  if (corner === 'tl') { x0 = px; y0 = py; }
  else if (corner === 'tr') { x1 = px; y0 = py; }
  else if (corner === 'bl') { x0 = px; y1 = py; }
  else if (corner === 'br') { x1 = px; y1 = py; }
  return normRect(x0, y0, x1, y1);
}

// 两个对角点 → 规整 [x,y,w,h]（左上 + 正宽高）。
export function normRect(ax, ay, bx, by) {
  return [Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)];
}

// 由 v>0 的关键点求包围盒，裁剪到图像内。无可见点返回 null。
// margin 为跨度比例的外扩；minPad 保证退化情形（单点/共线）仍有正的宽高，
// 否则 YOLO 训练 log(w) 会得到 -Infinity 而崩溃。
export function bboxFromKeypoints(keypoints, { width, height, margin = 0.05, minPad = 4 }) {
  const pts = keypoints.filter((k) => k[2] > 0);
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const mx = Math.max((maxX - minX) * margin, minPad);
  const my = Math.max((maxY - minY) * margin, minPad);
  const x0 = clamp(minX - mx, 0, width);
  const y0 = clamp(minY - my, 0, height);
  const x1 = clamp(maxX + mx, 0, width);
  const y1 = clamp(maxY + my, 0, height);
  return [x0, y0, x1 - x0, y1 - y0];
}
