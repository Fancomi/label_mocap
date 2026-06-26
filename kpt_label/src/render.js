// kpt_label/src/render.js
// Canvas 2D 绘制层（只画不改状态）。
// 约定：win = computeWindow(...)，cw/ch = canvas 像素尺寸。
import { imageToCanvasNorm } from '../../label/src/scene/view_zoom.js';

// 可见性 → 颜色（v=2 实心绿，v=1 橙，其余灰）。
export function kptColor(v) { return v === 2 ? '#39d353' : v === 1 ? '#e3a008' : '#888'; }

const toCanvas = (ix, iy, win, cw, ch) => {
  const [u, v] = imageToCanvasNorm(ix, iy, win);
  return [u * cw, v * ch];
};

// 画底图：drawImage 整图，按 win 裁剪到画布。img 为已解码 ImageBitmap/HTMLImageElement/HTMLVideoElement。
export function drawImage(ctx, img, win, cw, ch) {
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(img, win.winX, win.winY, win.winW, win.winH, 0, 0, cw, ch);
}

function drawBbox(ctx, bbox, win, cw, ch, { color, lineWidth, handle }) {
  const [x, y, w, h] = bbox;
  const [sx, sy] = toCanvas(x, y, win, cw, ch);
  const [ex, ey] = toCanvas(x + w, y + h, win, cw, ch);
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
  ctx.strokeRect(sx, sy, ex - sx, ey - sy);
  if (handle) {
    ctx.fillStyle = color;
    for (const [cx, cy] of [[sx, sy], [ex, sy], [sx, ey], [ex, ey]]) {
      ctx.fillRect(cx - 4, cy - 4, 8, 8);
    }
  }
}

function drawSkeleton(ctx, person, skel, win, cw, ch, alpha) {
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2; ctx.strokeStyle = '#4493f8';
  for (const [a, b] of skel.edges) {
    const ka = person.keypoints[a], kb = person.keypoints[b];
    if (ka[2] <= 0 || kb[2] <= 0) continue;
    const [ax, ay] = toCanvas(ka[0], ka[1], win, cw, ch);
    const [bx, by] = toCanvas(kb[0], kb[1], win, cw, ch);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  person.keypoints.forEach((k) => {
    if (k[2] <= 0) return;
    const [px, py] = toCanvas(k[0], k[1], win, cw, ch);
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2);
    if (k[2] === 2) { ctx.fillStyle = kptColor(2); ctx.fill(); }
    else { ctx.strokeStyle = kptColor(1); ctx.lineWidth = 2; ctx.stroke(); }
  });
  ctx.globalAlpha = 1;
}

// 画一帧所有人。selectedId 高亮（实线粗框 + 角手柄 + 不透明），其余淡化。
export function drawPersons(ctx, persons, selectedId, skel, win, cw, ch) {
  for (const p of persons) {
    const sel = p.id === selectedId;
    const alpha = sel ? 1 : 0.4;
    if (p.bbox) drawBbox(ctx, p.bbox, win, cw, ch, {
      color: sel ? '#ffcc33' : 'rgba(255,204,51,0.4)',
      lineWidth: sel ? 2 : 1, handle: sel,
    });
    drawSkeleton(ctx, p, skel, win, cw, ch, alpha);
  }
}
