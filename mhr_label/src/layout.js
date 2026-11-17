// mhr_label/src/layout.js — 分屏布局(纯逻辑)。所有视图画在一块 canvas 上,按矩形分区。
// 模式:
//   'A' 三维 + 对齐(默认):左侧 3D 自由视角,右侧各相机的对齐视频
//   'B' 纯二维:各相机的对齐视频平铺(两相机 = 左右并排)
//   'C' 聚焦:只显示一个相机的对齐视频
// 矩形 { name, kind: 'free'|'aligned', camId, x, y, w, h },归一化 [0,1],原点左上。
export const MODES = ['A', 'B', 'C'];
export const FREE_SPLIT = 0.6;   // 模式 A 中 3D 视角所占宽度

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

export function hitRect(nx, ny, rects) {
  return rects.find((r) => nx >= r.x && nx < r.x + r.w && ny >= r.y && ny < r.y + r.h) ?? null;
}
