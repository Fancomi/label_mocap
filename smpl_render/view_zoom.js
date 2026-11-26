// label/src/scene/view_zoom.js
// 2D 视图缩放/平移的纯几何。零 three.js。
// 虚拟传感器 imageW×imageH;基准窗口左上 (imageW/2−cx, imageH/2−cy)、尺寸 imageW×imageH。
// 缩放窗口尺寸 imageW/zoom × imageH/zoom;pan 是相对基准左上的传感器像素偏移,钳制在基准窗口内。
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// 「填满」(cover):aspect = 画布宽高比。zoom=1 的基准窗口是图像里按 aspect 能取到的最大子矩形
// (画布被图像填满,多出的方向裁掉);aspect 缺省 = 图像本身(contain,行为同前)。
// cover 时允许 zoom < 1 缩小到看到整幅图像(窗口超出图像的方向居中,不再平移)。
function baseSize({ imageW, imageH, aspect }) {
  if (!aspect) return [imageW, imageH];
  return imageW / imageH > aspect ? [imageH * aspect, imageH] : [imageW, imageW / aspect];
}

export function zoomRange(args) {
  if (!args.aspect) return [ZOOM_MIN, ZOOM_MAX];
  const [bw, bh] = baseSize(args);
  return [Math.min(bw / args.imageW, bh / args.imageH), ZOOM_MAX];
}

// cover 的居中 pan(zoom=1):窗口在图像里居中。contain 为 0。
export function centeredPan(args) {
  const [bw, bh] = baseSize(args);
  return { panX: (args.imageW - bw) / 2, panY: (args.imageH - bh) / 2 };
}

// 一个轴:窗口不超过图像时 pan 钳在图像内;超过时(cover 缩小)居中。
const axis = (base0, img, win, pan) => (win <= img + 1e-9 ? clamp(base0 + pan, base0, base0 + img - win) : base0 + (img - win) / 2);

// 计算 setViewOffset 用的子窗口。
export function computeWindow({ imageW, imageH, cx, cy, zoom, panX, panY, aspect }) {
  const z = clamp(zoom, ...zoomRange({ imageW, imageH, aspect }));
  const [bw, bh] = baseSize({ imageW, imageH, aspect });
  const winW = bw / z;
  const winH = bh / z;
  const baseX = imageW / 2 - cx;
  const baseY = imageH / 2 - cy;
  const winX = axis(baseX, imageW, winW, panX);
  const winY = axis(baseY, imageH, winH, panY);
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

// 把 pan 钳制回「使窗口不出基准窗口」的有效值,返回 {panX,panY}。
// computeWindow 只钳制输出窗口左上,不回写 pan;持续沿边界拖拽会让 pan 越积越界,
// 反向拖时要先"还债"才动 → 死区。存储前用本函数把 pan 收敛到有效区间,消除死区。
export function clampPan({ imageW, imageH, cx, cy, zoom, panX, panY, aspect }) {
  const win = computeWindow({ imageW, imageH, cx, cy, zoom, panX, panY, aspect });
  return { panX: win.winX - (imageW / 2 - cx), panY: win.winY - (imageH / 2 - cy) };
}

// 在画布点 (u,v) 处按 factor 缩放,解出新的 {zoom,panX,panY},使该点下的图像保持不动。
export function zoomAtSolve({ imageW, imageH, cx, cy, zoom, panX, panY, u, v, factor, aspect }) {
  const zNew = clamp(zoom * factor, ...zoomRange({ imageW, imageH, aspect }));
  const before = computeWindow({ imageW, imageH, cx, cy, zoom, panX, panY, aspect });
  const [ix, iy] = canvasNormToImage(u, v, before);
  const baseX = imageW / 2 - cx;
  const baseY = imageH / 2 - cy;
  const [bw, bh] = baseSize({ imageW, imageH, aspect });
  const winWNew = bw / zNew;
  const winHNew = bh / zNew;
  const panXNew = (ix - u * winWNew) - baseX;
  const panYNew = (iy - v * winHNew) - baseY;
  return { zoom: zNew, panX: panXNew, panY: panYNew };
}
