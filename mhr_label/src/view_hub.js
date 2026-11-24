// mhr_label/src/view_hub.js — 一块 canvas、一个 renderer、一个共享场景,按布局分区渲染多个视图:
//   free    = 3D 自由视角(OrbitControls),显示各相机视锥与近处小底图
//   aligned = 某台相机的对齐视角(内外参 + 转正),背景是该相机的视频帧,滚轮缩放/拖动平移(只改 viewOffset)
// 指针按命中的视图路由:先点一下切换「当前视图」(手柄只在当前视图显示与拖拽),再操作。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { focusPlacement } from '../../smpl_edit/framing.js';
import { layoutRects, letterbox, hitRect, alignedWindow, zoomAlignedAt, alignedImageOffset, applyAlignedProjection,
  freeAxisPlacement, defaultFreeAxes, parseFreeAxis, freeFrontOptions } from './layout.js';

const FAR_Z = 50;     // 对齐视角的背景平面(远)
const NEAR_Z = 0.8;   // 3D 视角里每台相机前的小底图(离相机近,不挡在相机与人体之间太多)

const poseMatrix = ({ R, t }) => new THREE.Matrix4().set(R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2], 0, 0, 0, 1);

class AlignedView {
  constructor(cfg) {
    this.kind = 'aligned';
    this.camId = cfg.cameraId;
    this.cfg = cfg;
    this.camera = new THREE.PerspectiveCamera(50, cfg.width / cfg.height, 0.01, 200);
    poseMatrix(cfg.pose).decompose(this.camera.position, this.camera.quaternion, this.camera.scale);
    this.camera.updateMatrixWorld(true);
    this.viewportAspect = null;
    this.reset();
  }
  get aspect() { return this.cfg.width / this.cfg.height; }
  _zoomArgs() {
    return { imageW: this.cfg.width, imageH: this.cfg.height, viewportAspect: this.viewportAspect,
      zoom: this.zoom, panX: this.panX, panY: this.panY };
  }
  _apply() {
    const { width: W, height: H, K } = this.cfg;
    this._win = alignedWindow(this._zoomArgs());
    this.panX = this._win.panX;
    this.panY = this._win.panY;
    applyAlignedProjection(this.camera, W, H, K, this._win);
  }
  setViewportAspect(aspect) {
    if (aspect === this.viewportAspect) return;
    this.viewportAspect = aspect;
    this._apply();
  }
  _setPan(zoom, panX, panY) {
    this.zoom = zoom; this.panX = panX; this.panY = panY;
    this._apply();
  }
  zoomAt(u, v, factor) { const r = zoomAlignedAt(this._zoomArgs(), u, v, factor); this._setPan(r.zoom, r.panX, r.panY); }
  panBy(du, dv) { this._setPan(this.zoom, this.panX - du * this._win.winW, this.panY - dv * this._win.winH); }
  reset() { this.zoom = 1; this.panX = 0; this.panY = 0; this._apply(); }
  handleScale() { return this._win.winH / this.cfg.height; }
}

class FreeView {
  constructor(canvas) {
    this.kind = 'free';
    this.camId = null;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enableZoom = false;   // 滚轮由 ViewHub 路由(按指针所在视图)
  }
  // 还没有人体时以第一台相机前方为环绕中心。
  place(cfg, axes) {
    const { R, t } = cfg.pose;
    this.setAxes(axes, [t[0] - R[2] * 4, t[1] - R[5] * 4, t[2] - R[8] * 4], 1.4);
  }
  setAxes(axes, target = this.controls.target.toArray(), radius = null) {
    const distance = this.camera.position.distanceTo(this.controls.target);
    const place = freeAxisPlacement(axes.up, axes.front, target, radius ?? Math.max(.2, (distance - 1) / 2.2));
    this.camera.up.fromArray(place.up);
    this.camera.position.fromArray(place.position);
    this.controls.target.fromArray(place.target);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }
  // 取景中心保留数据集地面，方位按所选观察轴。
  frame(center, radius, up, groundH, axes) {
    const U = new THREE.Vector3().fromArray(up);
    const C = new THREE.Vector3().fromArray(center);
    const G = C.clone().addScaledVector(U, groundH - C.dot(U));        // 人体在地面上的投影
    const target = C.clone().lerp(G, 0.35);                              // 偏向人体,地面在下方入画
    const r = Math.max(radius, C.distanceTo(G) / 2 + radius);
    this.setAxes(axes, target.toArray(), r);
  }
  focus(center, radius) {
    const out = focusPlacement({ position: this.camera.position.toArray(), target: this.controls.target.toArray() }, center, radius);
    this.camera.position.fromArray(out.position);
    this.controls.target.fromArray(out.target);
    this.controls.update();
  }
  dolly(factor) {
    const t = this.controls.target, p = this.camera.position;
    p.set(t.x + (p.x - t.x) * factor, t.y + (p.y - t.y) * factor, t.z + (p.z - t.z) * factor);
    this.controls.update();
  }
  handleScale() { return 1; }
}

// 每台相机在场景里的可视物:远背景平面(对齐视角用)、近小底图 + 视锥线(3D 视角用)。
class CamVisual {
  constructor(cfg, scene) {
    this.cfg = cfg;
    this.group = new THREE.Group();
    poseMatrix(cfg.pose).decompose(this.group.position, this.group.quaternion, this.group.scale);
    this.far = this._plane(FAR_Z, -1, false);
    // 3D 视角里的小底图是场景里的实物:写深度,近处的图遮挡远处的图(和人体)。
    this.near = this._plane(NEAR_Z, 0, true);
    this.frustum = this._frustum(NEAR_Z);
    this.group.add(this.far, this.near, this.frustum);
    scene.add(this.group);
    this.hasFrame = false;
  }
  // 图像矩形在相机系 z = −d 处:像素 (u,v) → (x,y) = ((u−cx)d/fx, −(v−cy)d/fy)。
  _plane(d, order, depthWrite) {
    const { width: W, height: H, K } = this.cfg;
    const [x, y] = alignedImageOffset(W, H, K);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W * d / K.fx, H * d / K.fy),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite, side: THREE.DoubleSide }));
    m.position.set(x * d / K.fx, -y * d / K.fy, -d);
    m.renderOrder = order;
    m.frustumCulled = false;
    m.visible = false;
    return m;
  }
  _frustum(d) {
    const { width: W, height: H, K } = this.cfg;
    const [x, y] = alignedImageOffset(W, H, K);
    const c = [[0, 0], [W, 0], [W, H], [0, H]].map(([u, v]) =>
      new THREE.Vector3((u - W / 2 + x) * d / K.fx, -(v - H / 2 + y) * d / K.fy, -d));
    const O = new THREE.Vector3();
    const g = new THREE.BufferGeometry().setFromPoints([O, c[0], O, c[1], O, c[2], O, c[3], c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]]);
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x66aaff }));
    l.frustumCulled = false;
    return l;
  }
  // 原生帧按显示配置整幅旋转(顺时针 deg):three 的 texture.rotation 正值 = 逆时针,取负。
  setTexture(tex) {
    this.hasFrame = !!tex;
    if (!tex) return;
    if (this.far.material.map !== tex) {
      tex.center.set(0.5, 0.5);
      tex.rotation = -this.cfg.rotationDeg * Math.PI / 180;
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
      for (const p of [this.far, this.near]) { p.material.map = tex; p.material.needsUpdate = true; }
    }
    tex.needsUpdate = true;
  }
  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
}

export class ViewHub {
  // overlay:覆盖在 canvas 上的 DOM 容器(画视图边框、标签、按钮)。
  // decorate(view, active) → { tag, buttons: [{ text, title?, onClick }] }:每个视图的标签与按钮。
  // isEngaged():手柄悬停/拖拽中(此时不平移、不转 3D)。onChange():当前视图 / 缩放变化。
  // onDepthWheel(view, dy):对齐视角里 Alt+滚轮。
  constructor({ canvas, scene, renderer, overlay, decorate, isEngaged, onChange, onDepthWheel }) {
    Object.assign(this, { _canvas: canvas, _scene: scene, _renderer: renderer, _overlay: overlay,
      _decorate: decorate, _isEngaged: isEngaged, _onChange: onChange, _onDepthWheel: onDepthWheel });
    this._free = new FreeView(canvas);
    this._aligned = new Map();
    this._visuals = new Map();
    this._camIds = [];
    this._mode = 'A';
    this._focusSizing = 'cover';
    this._focusId = null;
    this._rects = [];
    this._active = 'free';
    this._showBg = true;
    this._sceneCfg = { up: [0, 1, 0], ground_height_m: -1 };
    this._sceneAxes = {};
    this._freeDefaults = this._freeAxes = defaultFreeAxes(null, [0, 0, 1]);
    this._grid = new THREE.GridHelper(12, 24, 0x6695c8, 0x4a6080);
    Object.assign(this._grid.material, { transparent: true, opacity: 0.8, depthWrite: false });
    scene.add(this._grid);
    this._bindPointer();
  }

  // info.scene:{ up, front?, ground_height_m }(世界系)。给定网格平面和 3D 初始取景。
  setSceneConfig(cfg) {
    this._sceneAxes = cfg ?? {};
    const axes = defaultFreeAxes(cfg);
    const up = Array.isArray(cfg?.up) && parseFreeAxis(cfg.up)
      ? new THREE.Vector3().fromArray(cfg.up).normalize().toArray() : freeAxisPlacement(axes.up, axes.front, [0, 0, 0], 1).up;
    this._sceneCfg = { up, ground_height_m: Number.isFinite(cfg?.ground_height_m) ? cfg.ground_height_m : -1 };
    const U = new THREE.Vector3().fromArray(this._sceneCfg.up).normalize();
    this._grid.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), U);
  }
  // 网格跟在人体正下方(地面高度上)。
  setGroundUnder(center) {
    const U = new THREE.Vector3().fromArray(this._sceneCfg.up).normalize();
    const C = new THREE.Vector3().fromArray(center);
    this._grid.position.copy(C).addScaledVector(U, this._sceneCfg.ground_height_m - C.dot(U));
  }
  // F:同 SMPL 标注器的 focusOn —— 保持 3D 视角朝向,把人体移到视野中央、按大小拉开距离。没有 3D 视角(B/C)返回 false。
  focusFree(center, radius) {
    if (!this._rects.some((r) => r.kind === 'free')) return false;
    this._free.focus(center, radius);
    return true;
  }
  frameFree(center, radius) { this._free.frame(center, radius, this._sceneCfg.up, this._sceneCfg.ground_height_m, this._freeAxes); }
  freeAxes() { return { ...this._freeAxes }; }
  setFreeAxes(up, front) {
    const u = parseFreeAxis(up), f = parseFreeAxis(front);
    if (!u || !freeFrontOptions(u).includes(f)) return;
    this._freeAxes = { up: u, front: f };
    this._free.setAxes(this._freeAxes);
    this._onChange();
  }
  resetFreeAxes() { this.setFreeAxes(this._freeDefaults.up, this._freeDefaults.front); }

  setCameras(camIds, cfgs) {
    for (const v of this._visuals.values()) v.dispose(this._scene);
    this._camIds = camIds;
    this._aligned = new Map(camIds.map((id) => [id, new AlignedView(cfgs.get(id))]));
    this._visuals = new Map(camIds.map((id) => [id, new CamVisual(cfgs.get(id), this._scene)]));
    if (camIds.length) {
      const first = cfgs.get(camIds[0]), { R } = first.pose;
      this._freeDefaults = this._freeAxes = defaultFreeAxes(this._sceneAxes, [R[2], R[5], R[8]]);
      this._free.place(first, this._freeAxes);
    }
    this._active = this._mode === 'A' ? 'free' : `cam:${camIds[0]}`;
    this.relayout();
  }

  mode() { return this._mode; }
  focusSizing() { return this._focusSizing; }
  setFocusSizing(sizing) {
    if (sizing !== 'cover' && sizing !== 'fit') return;
    this._focusSizing = sizing;
    if (sizing === 'fit' && this.activeView()?.kind === 'aligned') this.activeView().reset();
    this.relayout();
  }
  focusId() { return this._focusId; }
  setMode(mode, focusId = this._focusId) {
    this._mode = mode;
    this._focusId = focusId;
    this.relayout();
  }

  setTexture(camId, tex) { this._visuals.get(camId)?.setTexture(tex); }
  setShowBackground(on) { this._showBg = on; }

  view(name) { return name === 'free' ? this._free : this._aligned.get(name.slice(4)); }
  activeView() { return this.view(this._active); }
  activeCamera() { return this.activeView()?.camera; }
  setActive(name) {
    if (name === this._active || !this._rects.some((r) => r.name === name)) return;
    this._active = name;
    this._refreshOverlay();
    this._onChange();
  }

  _size() { return { W: this._canvas.clientWidth, H: this._canvas.clientHeight }; }
  _aspect() { const a = [...this._aligned.values()]; return a.length ? a.reduce((s, v) => s + v.aspect, 0) / a.length : 1; }

  relayout() {
    const { W, H } = this._size();
    this._layoutW = W; this._layoutH = H;
    this._renderer.setSize(W, H, false);
    this._rects = layoutRects(this._mode, { camIds: this._camIds, focusId: this._focusId, W: W || 1, H: H || 1, aspect: this._aspect() });
    for (const rect of this._rects) {
      if (rect.kind !== 'aligned') continue;
      this.view(rect.name).setViewportAspect(this._covers(rect) ? (rect.w * (W || 1)) / (rect.h * (H || 1)) : null);
    }
    if (!this._rects.some((r) => r.name === this._active)) this._active = this._rects[0]?.name ?? 'free';
    this._refreshOverlay();
    this._onChange();
  }

  _covers(rect) { return rect.kind === 'aligned' && this._mode === 'C' && this._focusSizing === 'cover'; }

  // A/B 或全图模式保留完整画面，C 填满模式本身就是绘制区域。
  _drawRect(rect) {
    if (rect.kind !== 'aligned' || this._covers(rect)) return rect;
    const { W, H } = this._size();
    return letterbox(rect, W, H, this.view(rect.name).aspect);
  }

  pointerToNdc(e) {
    const rect = this._rects.find((r) => r.name === this._active);
    const d = this._drawRect(rect ?? { x: 0, y: 0, w: 1, h: 1, kind: 'free' });
    const cr = this._canvas.getBoundingClientRect();
    const u = (e.clientX - cr.left) / cr.width, v = (e.clientY - cr.top) / cr.height;
    return { x: ((u - d.x) / d.w) * 2 - 1, y: -((v - d.y) / d.h) * 2 + 1 };
  }

  _hit(e) {
    const cr = this._canvas.getBoundingClientRect();
    return hitRect((e.clientX - cr.left) / cr.width, (e.clientY - cr.top) / cr.height, this._rects);
  }
  // 指针在对齐视角画面内的归一化坐标(0..1);落在黑边外返回 null。
  _uvIn(rect, e) {
    const d = this._drawRect(rect);
    const cr = this._canvas.getBoundingClientRect();
    const u = ((e.clientX - cr.left) / cr.width - d.x) / d.w, v = ((e.clientY - cr.top) / cr.height - d.y) / d.h;
    return u < 0 || u > 1 || v < 0 || v > 1 ? null : [u, v, d];
  }

  _bindPointer() {
    const c = this._canvas;
    // capture:先于手柄 / OrbitControls / 拾取。点到非当前视图 = 只切换当前视图,吞掉本次按下,
    // 避免在新视图里按旧相机「抓」到看不见的手柄。
    c.addEventListener('pointerdown', (e) => {
      const hit = this._hit(e);
      if (hit && hit.name !== this._active) { this.setActive(hit.name); e.stopImmediatePropagation(); this._pan = null; return; }
      this._pan = e.button === 0 && hit?.kind === 'aligned' && this._uvIn(hit, e) && !this._isEngaged()
        ? { x: e.clientX, y: e.clientY, id: e.pointerId, moving: false, rect: hit } : null;
    }, true);
    c.addEventListener('pointermove', (e) => {
      const p = this._pan;
      if (!p || p.id !== e.pointerId) return;
      if (!p.moving && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) { p.moving = true; c.setPointerCapture(p.id); }
      if (!p.moving) return;
      const d = this._drawRect(p.rect); const cr = c.getBoundingClientRect();
      this.view(p.rect.name).panBy((e.clientX - p.x) / (d.w * cr.width), (e.clientY - p.y) / (d.h * cr.height));
      p.x = e.clientX; p.y = e.clientY;
      this._onChange();
    });
    const end = (e) => { if (e.pointerId === this._pan?.id) this._pan = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      const hit = this._hit(e);
      if (!hit) return;
      e.preventDefault(); e.stopPropagation();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      if (hit.kind === 'free') { this._free.dolly(Math.exp(dy * 0.001)); return; }
      const view = this.view(hit.name);
      if (e.altKey) { this._onDepthWheel(view, dy); return; }
      const uv = this._uvIn(hit, e);
      if (!uv) return;
      view.zoomAt(uv[0], uv[1], Math.exp(-dy * 0.0015));
      this._onChange();
    }, { capture: true, passive: false });
    c.addEventListener('dblclick', (e) => {
      const hit = this._hit(e);
      if (hit?.kind === 'aligned') { this.view(hit.name).reset(); this._onChange(); }
    });
  }

  // 视图标签随帧变化(如「本帧无画面」)时调用;不重排、不改渲染尺寸。
  refreshOverlay() { this._refreshOverlay(); }

  _refreshOverlay() {
    this._overlay.innerHTML = '';
    for (const r of this._rects) {
      const box = document.createElement('div');
      box.className = `vbox${r.name === this._active ? ' active' : ''}`;
      Object.assign(box.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
      const head = document.createElement('div');
      head.className = 'vhead';
      const { tag, buttons = [] } = this._decorate(this.view(r.name), r.name === this._active);
      const t = document.createElement('span'); t.className = 'tag'; t.textContent = tag; head.appendChild(t);
      for (const b of buttons) {
        const el = document.createElement('button');
        el.textContent = b.text; if (b.title) el.title = b.title;
        if (b.focusSizing) {
          el.className = 'focus-sizing-btn';
          el.dataset.focusSizing = b.focusSizing;
        }
        el.addEventListener('click', b.onClick);
        head.appendChild(el);
      }
      box.appendChild(head);
      this._overlay.appendChild(box);
    }
  }

  // handleObjects:只在当前视图显示的手柄对象;prePass(view):每个视图渲染前(如头灯朝向)。
  render(handleObjects, prePass) {
    const { W, H } = this._size();
    if (!W || !H) return;
    if (W !== this._layoutW || H !== this._layoutH) this.relayout();
    const r = this._renderer;
    this._free.controls.enabled = this._active === 'free' && !this._isEngaged();
    this._free.controls.update();
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    r.clear();
    const want = handleObjects.map((o) => o.visible);
    try {
      for (const rect of this._rects) {
        const view = this.view(rect.name);
        const d = this._drawRect(rect);
        const px = { x: Math.round(d.x * W), y: Math.round((1 - d.y - d.h) * H), w: Math.round(d.w * W), h: Math.round(d.h * H) };
        if (view.kind === 'free') { view.camera.aspect = px.w / Math.max(px.h, 1); view.camera.updateProjectionMatrix(); }
        for (const [id, vis] of this._visuals) {
          vis.far.visible = this._showBg && vis.hasFrame && view.camId === id;
          vis.near.visible = this._showBg && vis.hasFrame && view.kind === 'free';
          vis.frustum.visible = view.kind === 'free';
        }
        this._grid.visible = view.kind === 'free';
        const isActive = rect.name === this._active;
        handleObjects.forEach((o, i) => { o.visible = isActive && want[i]; });
        prePass(view);
        r.setViewport(px.x, px.y, px.w, px.h);
        r.setScissor(px.x, px.y, px.w, px.h);
        r.setScissorTest(true);
        r.render(this._scene, view.camera);
      }
    } finally {
      handleObjects.forEach((o, i) => { o.visible = want[i]; });
      r.setScissorTest(false);
    }
  }
}
