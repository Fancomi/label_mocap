// label/src/edit/bbox_edit.js
import { bboxFromPoints } from '../scene/projection.js';

// corner: 'tl' | 'tr' | 'bl' | 'br'. point: [px, py] in image pixels.
// Returns a normalized [x, y, w, h] with the opposite corner held fixed.
export function resizeBboxByCorner([x, y, w, h], corner, [px, py]) {
  let x0 = x;
  let y0 = y;
  let x1 = x + w;
  let y1 = y + h;
  if (corner === 'tl') { x0 = px; y0 = py; }
  else if (corner === 'tr') { x1 = px; y0 = py; }
  else if (corner === 'bl') { x0 = px; y1 = py; }
  else if (corner === 'br') { x1 = px; y1 = py; }
  const nx = Math.min(x0, x1);
  const ny = Math.min(y0, y1);
  return [nx, ny, Math.abs(x1 - x0), Math.abs(y1 - y0)];
}

// verts: flat Float32Array of posed mesh vertices in source coords.
export function projectBboxFromMesh(verts, K) {
  return bboxFromPoints(verts, K);
}
