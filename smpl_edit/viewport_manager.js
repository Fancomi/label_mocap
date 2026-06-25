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
    this._handleObjects = [];
    this._rects = computeRects(this._preset, this._splits);
    canvas.addEventListener('pointerdown', (e) => this._routePointer(e), true);
    canvas.addEventListener('wheel', (e) => this._routeWheel(e), { capture: true, passive: false }); // 滚轮/缩放:指针所在视口即可,不限 active
    this._syncControlsEnabled(); // 初始只开 active 视口的 controls
  }

  setLayout(preset) { this._preset = preset; this._recompute(); }
  setSplits(splits) { this._splits = { ...this._splits, ...splits }; this._recompute(); }
  _recompute() { this._rects = computeRects(this._preset, this._splits); this.resize(); }

  activeViewport() { return this._vps.get(this._active); }
  activeCamera() { return this.activeViewport()?.camera; }
  viewport(name) { return this._vps.get(name); }
  visibleRects() { return this._rects; }

  // active 视口在 canvas 上的 CSS 像素子矩形(用于把指针重映射到该视口 NDC)。
  activeCssRect() {
    const cr = this._canvas.getBoundingClientRect();
    const r = this._rects.find((x) => x.name === this._active) || { x: 0, y: 0, w: 1, h: 1 };
    return { left: cr.left + r.x * cr.width, top: cr.top + r.y * cr.height, width: r.w * cr.width, height: r.h * cr.height };
  }

  // 指针事件 → active 视口的 NDC[-1,1]。供 JointPicker 与 TransformControls 共用。
  pointerToNdc(e) {
    const r = this.activeCssRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  }

  // 指针事件命中的视口名(归一坐标 → hitTest),无则 null。
  _hitName(e) {
    const r = this._canvas.getBoundingClientRect();
    return hitTest((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, this._rects);
  }

  _routePointer(e) {
    const name = this._hitName(e);
    if (name && name !== this._active && this._vps.has(name)) {
      this._active = name;
      this._syncControlsEnabled(); // 切 active → 只让该视口的 controls 响应本次拖拽
      this._onActiveChange(name);
    }
  }

  // 滚轮/双指缩放:作用于「指针所在视口」(不限 active,无需先点选)。
  // 直接手动 dolly 命中视口,绕开 OrbitControls 的 enabled 闸门与 damping 单帧稀释;
  // 并 preventDefault/stopPropagation 阻止 OrbitControls 自身的 wheel 再缩 active 视口(避免双重缩放)。
  _routeWheel(e) {
    const name = this._hitName(e);
    if (!name || !this._vps.has(name)) return;
    e.preventDefault();
    e.stopPropagation();
    this._vps.get(name).dollyBy(Math.exp(e.deltaY * 0.001)); // deltaY>0(下滚)→ factor>1 → 推远
  }

  // 多套 OrbitControls 共用一个 canvas:只开 active 视口的 controls,其余关掉,
  // 否则一次拖拽会同时驱动三个视口。capture 阶段先于 OrbitControls 的
  // pointerdown 执行,故同一次按下即对非 active 视口生效。
  _syncControlsEnabled() {
    for (const vp of this._vps.values()) vp.controls.enabled = (vp.name === this._active);
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
    // 手柄仅 active 视口可见:渲染前记下各对象「意图可见性」,逐区切换,finally 保证还原
    // (即便渲染抛异常也不会把手柄永久隐藏)。不往对象挂临时属性。
    const wantVisible = this._handleObjects.map((o) => o.visible);
    try {
      for (const rect of this._rects) {
        const vp = this._vps.get(rect.name); if (!vp) continue;
        const isActive = rect.name === this._active;
        this._handleObjects.forEach((o, i) => { o.visible = isActive && wantVisible[i]; });
        vp.update();
        vp.applyScissor(renderer, this._pxRect(rect, W, H));
        renderer.render(scene, vp.camera);
      }
    } finally {
      this._handleObjects.forEach((o, i) => { o.visible = wantVisible[i]; });
      renderer.setScissorTest(false);
    }
  }

  // 注册「仅 active 视口可见」的手柄对象(TransformControls helper + marker 等)。
  registerHandleObjects(objs) { this._handleObjects.push(...objs); }

  // gizmo engaged 时锁 active 视口的 controls;松开后恢复。
  setActiveControlsEnabled(enabled) {
    const vp = this.activeViewport();
    if (vp) vp.controls.enabled = enabled;
  }

  // 布局/active 变化后,重新同步各视口 controls 启停(app 仍调用)。
  syncControlsEnabled() { this._syncControlsEnabled(); }
}
