// kpt_label/src/render.js
// Canvas 2D 绘制层（只画不改状态）。
// 约定：t = viewport.transform(...)（含 scale/offX/offY），cw/ch = canvas 像素尺寸。
import { imgToScreen } from './viewport.js';
import { jointColor, edgeColor } from './skeleton.js';

const toCanvas = (ix, iy, t) => imgToScreen(ix, iy, t);

// 画底图：按 transform 把整图缩放平移到画布；放大后超出区域自然可见。
export function drawImage(ctx, img, t, imgW, imgH, cw, ch) {
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, imgW, imgH, t.offX, t.offY, imgW * t.scale, imgH * t.scale);
}

function drawBbox(ctx, bbox, t, { color, lineWidth, handle }) {
  const [x, y, w, h] = bbox;
  const [sx, sy] = toCanvas(x, y, t);
  const [ex, ey] = toCanvas(x + w, y + h, t);
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
  ctx.strokeRect(sx, sy, ex - sx, ey - sy);
  if (handle) {
    ctx.fillStyle = color;
    for (const [cx, cy] of [[sx, sy], [ex, sy], [sx, ey], [ex, ey]]) {
      ctx.fillRect(cx - 4, cy - 4, 8, 8);
    }
  }
}

// 连线/点按左右侧着色（skeleton.SIDE_COLOR）。可见性用实心(v=2)/空心(v=1)区分；
// armedIdx 关节加白色描边高亮。
function drawSkeleton(ctx, person, skel, t, alpha, armedIdx) {
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2;
  for (const [a, b] of skel.edges) {
    const ka = person.keypoints[a], kb = person.keypoints[b];
    if (ka[2] <= 0 || kb[2] <= 0) continue;
    const [ax, ay] = toCanvas(ka[0], ka[1], t);
    const [bx, by] = toCanvas(kb[0], kb[1], t);
    ctx.strokeStyle = edgeColor(skel, a, b);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  person.keypoints.forEach((k, i) => {
    if (k[2] <= 0) return;
    const [px, py] = toCanvas(k[0], k[1], t);
    const col = jointColor(skel, i);
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2);
    if (k[2] === 2) { ctx.fillStyle = col; ctx.fill(); }
    else { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); }
    if (i === armedIdx) {                       // 选中关节白圈高亮
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;
}

// 画一帧所有人。selectedId 高亮（实线粗框 + 角手柄 + 不透明），其余淡化。
// armedIdx 仅作用于选中人当前待标/选中的关节。
export function drawPersons(ctx, persons, selectedId, skel, t, armedIdx = -1) {
  for (const p of persons) {
    const sel = p.id === selectedId;
    const alpha = sel ? 1 : 0.4;
    if (p.bbox) drawBbox(ctx, p.bbox, t, {
      color: sel ? '#ffcc33' : 'rgba(255,204,51,0.4)',
      lineWidth: sel ? 2 : 1, handle: sel,
    });
    drawSkeleton(ctx, p, skel, t, alpha, sel ? armedIdx : -1);
  }
}
