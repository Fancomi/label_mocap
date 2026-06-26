// kpt_label/src/viewport.js
// 纯 2D 视口：fit（长边顶边、短边留白）+ 以中心点为锚的缩放/平移。无 DOM。
// 模型：视口 vw×vh 像素填满 stage；图像 imgW×imgH。
//   scale = fitScale × zoom（zoom≥1，1=fit）；(cx,cy) 为「显示在视口中心」的图像点。
//   offX = vw/2 − cx·scale，屏幕↔图像由此线性互换。
// 放大后图像可平移覆盖任意角落，不再被默认 fit 窗口切割；图像始终不完全移出。
export const ZOOM_MIN = 1, ZOOM_MAX = 16;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// fit 比例：长边顶住视口边缘，短边自然缩放。
export function fitScale(vw, vh, imgW, imgH) {
  return Math.min(vw / imgW, vh / imgH);
}

export function scaleOf(vw, vh, imgW, imgH, zoom) {
  return fitScale(vw, vh, imgW, imgH) * clamp(zoom, ZOOM_MIN, ZOOM_MAX);
}

// 钳制中心点：图像大于视口的轴 → 限定视口不越图像边（无黑边）；小于视口的轴 → 锁中线。
export function clampCenter({ vw, vh, imgW, imgH, zoom, cx, cy }) {
  const s = scaleOf(vw, vh, imgW, imgH, zoom);
  const fix = (v, img, view) => {
    const half = (view / 2) / s;            // 视口半宽对应的图像距离
    return (img * s >= view) ? clamp(v, half, img - half) : img / 2;
  };
  return { cx: fix(cx, imgW, vw), cy: fix(cy, imgH, vh) };
}

// 当前变换：scale 与视口左上偏移（屏幕像素）。
export function transform({ vw, vh, imgW, imgH, zoom, cx, cy }) {
  const scale = scaleOf(vw, vh, imgW, imgH, zoom);
  return { scale, offX: vw / 2 - cx * scale, offY: vh / 2 - cy * scale };
}

export function screenToImg(sx, sy, t) { return [(sx - t.offX) / t.scale, (sy - t.offY) / t.scale]; }
export function imgToScreen(ix, iy, t) { return [t.offX + ix * t.scale, t.offY + iy * t.scale]; }

// 在视口点 (sx,sy) 处按 factor 缩放，保持该点下的图像不动；返回 {zoom,cx,cy}（未钳制）。
export function zoomAt({ vw, vh, imgW, imgH, zoom, cx, cy }, sx, sy, factor) {
  const zNew = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
  const t = transform({ vw, vh, imgW, imgH, zoom, cx, cy });
  const [iu, iv] = screenToImg(sx, sy, t);          // 光标下的图像点
  const sNew = scaleOf(vw, vh, imgW, imgH, zNew);
  return { zoom: zNew, cx: iu - (sx - vw / 2) / sNew, cy: iv - (sy - vh / 2) / sNew };
}
