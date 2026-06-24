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
    this._syncControlsEnabled(); // 初始只开 active 视口的 controls
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
      this._syncControlsEnabled(); // 切 active → 只让该视口的 controls 响应本次拖拽
      this._onActiveChange(name);
    }
  }

  // 多套 OrbitControls 共用一个 canvas:只开 active 视口的 controls,其余关掉,
  // 否则一次拖拽会同时驱动三个视口。锁定的视口始终关。capture 阶段先于
  // OrbitControls 的 pointerdown 执行,故同一次按下即对非 active 视口生效。
  _syncControlsEnabled() {
    for (const vp of this._vps.values()) {
      vp.controls.enabled = (vp.name === this._active) && !vp.locked;
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

  // gizmo engaged 时锁 active 视口的 controls;松开后恢复。锁定视口不开。
  setActiveControlsEnabled(enabled) {
    const vp = this.activeViewport();
    if (vp && !vp.locked) vp.controls.enabled = enabled;
  }

  // 锁/解锁某视口后,重新同步 controls 启停(解锁的 active 视口要恢复响应)。
  syncControlsEnabled() { this._syncControlsEnabled(); }
}
