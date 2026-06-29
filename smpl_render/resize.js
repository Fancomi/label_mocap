// smpl_render/resize.js
// 解耦 letterbox bug：把「backing buffer 尺寸」与「相机 aspect」拆成两个正交策略，
// 按有效模式分派。
//   2D 对齐看图：buffer=letterbox(裁到图像比例)，aspect=图像比例 → 底图无变形。
//   3D 自由：    buffer=fill(填满容器)，   aspect=容器比例   → 视野跟随窗口，不被裁。
// 底图 plane 两种模式都按图像几何定位(世界系位置/尺寸不变，与 buffer/aspect 无关)。
// 纯函数可 node 单测；applyContainerResize 是唯一碰 three/DOM 的适配壳。

// 有效模式 → 两策略名。'2d'→对齐看图；其余(含 '3d')→自由。
export function policiesForMode(mode) {
  return mode === '2d'
    ? { bufferPolicy: 'letterbox', aspectPolicy: 'image' }
    : { bufferPolicy: 'fill', aspectPolicy: 'container' };
}

// backing buffer 的 CSS 像素尺寸。fill 填满容器；letterbox 按图像比例内接。
export function computeBackingSize({ containerW, containerH, imageAspect, bufferPolicy }) {
  if (bufferPolicy === 'fill') {
    return { cssW: containerW, cssH: containerH };
  }
  const containerAspect = containerW / containerH;
  if (containerAspect > imageAspect) {
    const cssH = containerH;
    return { cssW: Math.round(cssH * imageAspect), cssH };
  }
  const cssW = containerW;
  return { cssW, cssH: Math.round(cssW / imageAspect) };
}

// 相机 aspect：image=图像比例(2D)；container=buffer 实际比例(3D，fill 下即容器比例)。
export function resolveCameraAspect({ aspectPolicy, imageAspect, cssW, cssH }) {
  return aspectPolicy === 'image' ? imageAspect : cssW / cssH;
}

// three/DOM 适配壳：按 effectiveMode 设 canvas CSS、renderer 尺寸、camera.aspect。
// 返回 { cssW, cssH, aspect } 便于上层重算 viewOffset / 测试观测；容器为 0 时返回 null。
export function applyContainerResize({ renderer, camera, canvas, container, imageAspect, effectiveMode }) {
  const cw = container.clientWidth, ch = container.clientHeight;
  if (cw <= 0 || ch <= 0) return null;
  const { bufferPolicy, aspectPolicy } = policiesForMode(effectiveMode);
  const { cssW, cssH } = computeBackingSize({ containerW: cw, containerH: ch, imageAspect, bufferPolicy });
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  renderer.setSize(cssW, cssH, false);
  const aspect = resolveCameraAspect({ aspectPolicy, imageAspect, cssW, cssH });
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  return { cssW, cssH, aspect };
}
