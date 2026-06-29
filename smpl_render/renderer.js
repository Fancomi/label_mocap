// smpl_render/renderer.js
// 统一三 app 几乎一致的 WebGLRenderer 工厂。只建 renderer，不设尺寸(归 resize.js)。
import * as THREE from 'three';

export function createRenderer({ canvas, preserveDrawingBuffer = true, clearColor = 0x0f1216, pixelRatioCap = 2 }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
  renderer.setClearColor(clearColor, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}
