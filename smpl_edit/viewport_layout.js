// smpl_edit/viewport_layout.js
// 视口布局纯逻辑:预设 + 分隔条比例 → 归一化矩形列表;点命中测试。
// 矩形 { name, x, y, w, h },归一化 [0,1],原点左上(与 DOM 像素一致)。
// splits.v = 主视/参考栏的竖向分界(主视宽度占比);splits.h = 参考栏内上下分界。

// 三视:主视占左 v 宽,右栏(1-v)上下按 h 切为 side/front。
function triRects(v, h) {
  const rx = v, rw = 1 - v;
  return [
    { name: 'main', x: 0, y: 0, w: v, h: 1 },
    { name: 'side', x: rx, y: 0, w: rw, h },
    { name: 'front', x: rx, y: h, w: rw, h: 1 - h },
  ];
}

export function computeRects(preset, splits) {
  const v = splits?.v ?? 0.7, h = splits?.h ?? 0.5;
  if (preset === 'single') return [{ name: 'main', x: 0, y: 0, w: 1, h: 1 }];
  return triRects(v, h); // 'tri';宽度由分隔条 v 自由调,不再单列 main-big 预设
}

// 命中:返回归一化点 (nx,ny) 落在的矩形 name,无则 null。
export function hitTest(nx, ny, rects) {
  for (const r of rects) {
    if (nx >= r.x && nx < r.x + r.w && ny >= r.y && ny < r.y + r.h) return r.name;
  }
  return null;
}
