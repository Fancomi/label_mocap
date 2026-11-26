// mhr_label/src/layout.js — 分屏布局(纯逻辑)。所有视图画在一块 canvas 上,按矩形分区。
// 模式:
//   'A' 三维 + 对齐(默认):左侧 3D 自由视角,右侧各相机的对齐视频
//   'B' 纯二维:各相机的对齐视频平铺(两相机 = 左右并排)
//   'C' 聚焦:只显示一个相机的对齐视频
// 矩形 { name, kind: 'free'|'aligned', camId, x, y, w, h },归一化 [0,1],原点左上。
import { axisVec, axisName, cameraPlacement, FRONT_OPTIONS } from '../../smpl_edit/view_frame.js';
import { canvasNormToImage, ZOOM_MIN, ZOOM_MAX } from '../../smpl_render/view_zoom.js';

export const MODES = ['A', 'B', 'C'];
export const FREE_SPLIT = 0.6;   // 模式 A 中 3D 视角所占宽度
export const FREE_AXES = ['X', '-X', 'Y', '-Y', 'Z', '-Z'];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, hi));

// 与点云标注器使用同一无符号观察基，MHR 同时允许反向观察。
const axisLetter = (name) => name.at(-1);
export function freeFrontOptions(up) {
  return FRONT_OPTIONS[axisLetter(up)].flatMap((axis) => [axis, '-' + axis]);
}

export function parseFreeAxis(value) {
  if (typeof value === 'string') {
    const name = value.trim().toUpperCase().replace(/^\+/, '').replace(/−/g, '-');
    return FREE_AXES.includes(name) ? name : null;
  }
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite) || value.every((x) => x === 0)) return null;
  const name = axisName(value);
  return (value['XYZ'.indexOf(name)] < 0 ? '-' : '') + name;
}

export function defaultFreeAxes(scene, cameraBack = null) {
  const up = parseFreeAxis(scene?.up) ?? 'Y';
  const options = freeFrontOptions(up);
  const projected = Array.isArray(cameraBack) ? cameraBack.map((x, i) => i === 'XYZ'.indexOf(axisLetter(up)) ? 0 : x) : null;
  const specified = parseFreeAxis(scene?.front);
  const fromCamera = parseFreeAxis(projected);
  return { up, front: options.includes(specified) ? specified : fromCamera ?? options[0] };
}

export function freeAxisPlacement(up, front, target, radius) {
  const letters = [axisLetter(up), axisLetter(front)];
  const place = cameraPlacement(...letters, target, radius);
  // 仅反转相对观察中心的相机偏移，不改世界系中的目标。
  for (const axis of [up, front]) {
    if (!axis.startsWith('-')) continue;
    const i = 'XYZ'.indexOf(axisLetter(axis));
    place.position[i] = 2 * target[i] - place.position[i];
  }
  place.up = axisVec(letters[0]).map((x) => up.startsWith('-') && x ? -x : x);
  return place;
}

// n 张宽高比 aspect(w/h)的图铺进 W×H:选使显示面积最大的列数。
export function bestGrid(n, W, H, aspect) {
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const imgH = Math.min(W / cols / aspect, H / rows);
    const area = n * imgH * imgH * aspect;
    if (!best || area > best.area + 1e-9) best = { cols, rows, area };
  }
  return best;
}

function tile(camIds, x0, y0, w, h, W, H, aspect) {
  const { cols, rows } = bestGrid(camIds.length, w * W, h * H, aspect);
  return camIds.map((camId, k) => ({
    name: `cam:${camId}`, kind: 'aligned', camId,
    x: x0 + (k % cols) * (w / cols), y: y0 + Math.floor(k / cols) * (h / rows), w: w / cols, h: h / rows,
  }));
}

// W,H:画布像素(决定横排还是竖排);aspect:对齐视频的显示宽高比(转正后)。
export function layoutRects(mode, { camIds, focusId = null, W, H, aspect }) {
  if (!camIds.length) return [];
  if (mode === 'C') {
    const camId = camIds.includes(focusId) ? focusId : camIds[0];
    return [{ name: `cam:${camId}`, kind: 'aligned', camId, x: 0, y: 0, w: 1, h: 1 }];
  }
  if (mode === 'B') return tile(camIds, 0, 0, 1, 1, W, H, aspect);
  return [
    { name: 'free', kind: 'free', camId: null, x: 0, y: 0, w: FREE_SPLIT, h: 1 },
    ...tile(camIds, FREE_SPLIT, 0, 1 - FREE_SPLIT, 1, W, H, aspect),
  ];
}

// 矩形内按图像宽高比居中内接(letterbox)。输入输出都是归一化矩形;W,H = 画布像素。
export function letterbox(rect, W, H, aspect) {
  const rw = rect.w * W, rh = rect.h * H;
  let w = rw, h = rw / aspect;
  if (h > rh) { h = rh; w = rh * aspect; }
  return { x: rect.x + (rw - w) / 2 / W, y: rect.y + (rh - h) / 2 / H, w: w / W, h: h / H };
}

// 以真实图像像素表示窗口。cover 时先算填满视口所需的裁取比例，再做鼠标锚定缩放；
// 平移始终裁在整幅图像内，所以聚焦模式可拖回缩放前被裁掉的区域。
// cover 下可缩小到看见整幅(zoom < 1),窗口比图像大的方向居中、不平移。
export function alignedZoomMin({ imageW, imageH, viewportAspect = null }) {
  if (viewportAspect == null) return ZOOM_MIN;
  return Math.min(Math.min(imageW, imageH * viewportAspect) / imageW, Math.min(imageH, imageW / viewportAspect) / imageH);
}
const windowAxis = (img, win, pan) => (win <= img + 1e-9 ? clamp((img - win) / 2 + pan, 0, img - win) : (img - win) / 2);
export function alignedWindow({ imageW, imageH, viewportAspect = null, zoom, panX, panY }) {
  const z = clamp(zoom, alignedZoomMin({ imageW, imageH, viewportAspect }), ZOOM_MAX);
  const baseW = viewportAspect == null ? imageW : Math.min(imageW, imageH * viewportAspect);
  const baseH = viewportAspect == null ? imageH : Math.min(imageH, imageW / viewportAspect);
  const winW = baseW / z, winH = baseH / z;
  const winX = windowAxis(imageW, winW, panX);
  const winY = windowAxis(imageH, winH, panY);
  return { winX, winY, winW, winH, panX: winX - (imageW - winW) / 2, panY: winY - (imageH - winH) / 2 };
}

export function zoomAlignedAt(args, u, v, factor) {
  const [x, y] = canvasNormToImage(u, v, alignedWindow(args));
  const zoom = clamp(args.zoom * factor, alignedZoomMin(args), ZOOM_MAX);
  const next = alignedWindow({ ...args, zoom });
  const panX = x - u * next.winW - (args.imageW - next.winW) / 2;
  const panY = y - v * next.winH - (args.imageH - next.winH) / 2;
  return { zoom, panX, panY };
}

// 标定用整数像素中心，图像窗口用像素边界，因此中心对应 (W−1)/2、(H−1)/2。
export function alignedImageOffset(W, H, K) {
  return [(W - 1) / 2 - K.cx, (H - 1) / 2 - K.cy];
}

export function applyAlignedProjection(camera, W, H, K, win) {
  const [x, y] = alignedImageOffset(W, H, K);
  camera.fov = 2 * Math.atan(H / (2 * K.fy)) * 180 / Math.PI;
  camera.setViewOffset(W, H, win.winX + x, win.winY + y, win.winW, win.winH);
  // Three 的 setViewOffset 会设回 W/H。焦距 fx 和 fy 分开，保证底图与网格都用真实内参。
  camera.aspect = W * K.fy / (H * K.fx);
  camera.updateProjectionMatrix();
}

export function hitRect(nx, ny, rects) {
  return rects.find((r) => nx >= r.x && nx < r.x + r.w && ny >= r.y && ny < r.y + r.h) ?? null;
}
