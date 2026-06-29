// smpl_render/index.js
// 渲染/相机/视口共享内核单点入口。app 从此处 import。
export { createRenderer } from './renderer.js';
export { computeBackingSize, resolveCameraAspect, policiesForMode, applyContainerResize } from './resize.js';
export { rotateKn, withDataRotation } from './data_rotation.js';
export { CameraModes } from './camera_modes.js';
export { OrbitCam } from './orbit_cam.js';
export {
  computeWindow, zoomAtSolve, clampPan, imageToCanvasNorm, canvasNormToImage,
  ZOOM_MIN, ZOOM_MAX,
} from './view_zoom.js';
