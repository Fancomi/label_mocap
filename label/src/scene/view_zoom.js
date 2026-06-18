// label/src/scene/view_zoom.js
// 2D 视图缩放/平移的纯几何。零 three.js。
// 虚拟传感器 imageW×imageH;基准窗口左上 (imageW/2−cx, imageH/2−cy)、尺寸 imageW×imageH。
// 缩放窗口尺寸 imageW/zoom × imageH/zoom;pan 是相对基准左上的传感器像素偏移,钳制在基准窗口内。
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// 计算 setViewOffset 用的子窗口。
export function computeWindow({ imageW, imageH, cx, cy, zoom, panX, panY }) {
  const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  const winW = imageW / z;
  const winH = imageH / z;
  const baseX = imageW / 2 - cx;
  const baseY = imageH / 2 - cy;
  const winX = clamp(baseX + panX, baseX, baseX + imageW - winW);
  const winY = clamp(baseY + panY, baseY, baseY + imageH - winH);
  return { winX, winY, winW, winH };
}

// 图像像素 → 画布归一化 (u,v):窗口左上→(0,0)、右下→(1,1)。
export function imageToCanvasNorm(ix, iy, win) {
  return [(ix - win.winX) / win.winW, (iy - win.winY) / win.winH];
}

// 画布归一化 → 图像像素(逆映射)。
export function canvasNormToImage(u, v, win) {
  return [win.winX + u * win.winW, win.winY + v * win.winH];
}

// 在画布点 (u,v) 处按 factor 缩放,解出新的 {zoom,panX,panY},使该点下的图像保持不动。
export function zoomAtSolve({ imageW, imageH, cx, cy, zoom, panX, panY, u, v, factor }) {
  const zNew = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
  const before = computeWindow({ imageW, imageH, cx, cy, zoom, panX, panY });
  const [ix, iy] = canvasNormToImage(u, v, before);
  const baseX = imageW / 2 - cx;
  const baseY = imageH / 2 - cy;
  const winWNew = imageW / zNew;
  const winHNew = imageH / zNew;
  const panXNew = (ix - u * winWNew) - baseX;
  const panYNew = (iy - v * winHNew) - baseY;
  return { zoom: zNew, panX: panXNew, panY: panYNew };
}
