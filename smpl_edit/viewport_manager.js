// smpl_edit/viewport_manager.js
// 多视口管理:单 renderer 逐区 scissor 渲染 + 指针路由 active 视口 + 布局。
// scene 由外部传入(所有视口共享同一 scene)。browser-only。
import { computeRects, hitTest } from './viewport_layout.js';

export class ViewportManager {
  // viewports: Viewport[](至少含 name==='main');canvas: 渲染 canvas;
  // onActiveChange(name): active 视口变化回调(用于推相机给 gizmo/picker)。
  constructor({ viewports, canvas, onActiveChange }) {
    this._vps = new Map(viewports.map((v) => [v.name, v]));
    this._canvas = canvas;
    this._onActiveChange = onActiveChange || (() => {});
    this._preset = 'tri';
    this._splits = { v: 0.7, h: 0.5 };
    this._active = 'main';
    this._rects = computeRects(this._preset, this._splits);
    canvas.addEventListener('pointerdown', (e) => this._routePointer(e), true);
  }

  setLayout(preset) { this._preset = preset; this._recompute(); }
  setSplits(splits) { this._splits = { ...this._splits, ...splits }; this._recompute(); }
  _recompute() { this._rects = computeRects(this._preset, this._splits); this.resize(); }

  activeViewport() { return this._vps.get(this._active); }
  activeCamera() { return this.activeViewport()?.camera; }
  viewport(name) { return this._vps.get(name); }
  visibleRects() { return this._rects; }

  _routePointer(e) {
    const r = this._canvas.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    const name = hitTest(nx, ny, this._rects);
    if (name && name !== this._active && this._vps.has(name)) {
      this._active = name;
      this._onActiveChange(name);
    }
  }

  // 像素矩形(GL 左下原点):由归一矩形(左上原点)翻 Y 得到。
  _pxRect(rect, W, H) {
    return { x: Math.round(rect.x * W), y: Math.round((1 - rect.y - rect.h) * H),
      w: Math.round(rect.w * W), h: Math.round(rect.h * H) };
  }

  resize() {
    const W = this._canvas.width, H = this._canvas.height;
    if (!W || !H) return;
    for (const rect of this._rects) {
      const vp = this._vps.get(rect.name); if (!vp) continue;
      const px = this._pxRect(rect, W, H);
      vp.resize(px.w / Math.max(px.h, 1));
    }
  }

  // 逐区渲染:每个可见矩形设 viewport+scissor 后渲染共享 scene。
  render(renderer, scene) {
    const W = this._canvas.width, H = this._canvas.height;
    if (!W || !H) return;
    for (const rect of this._rects) {
      const vp = this._vps.get(rect.name); if (!vp) continue;
      vp.update();
      vp.applyScissor(renderer, this._pxRect(rect, W, H));
      renderer.render(scene, vp.camera);
    }
    renderer.setScissorTest(false);
  }

  // 把当前 active 视口的 controls 启停交给守卫(gizmo engaged 时锁 active controls)。
  setActiveControlsEnabled(enabled) {
    const vp = this.activeViewport();
    if (vp && !vp.locked) vp.controls.enabled = enabled;
  }
}
