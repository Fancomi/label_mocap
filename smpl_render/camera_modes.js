// smpl_render/camera_modes.js
// 共享相机内核：一台 PerspectiveCamera，两模式(3d/2d)，1s ease-in-out slerp 切换。
// label 与 viewer 共用本基类。差异收口：
//   - 数据旋转(仅 viewer) → data_rotation.js#withDataRotation 挂载，基类只留 _dataRotN(默认0)。
//   - 3D 编辑时是否跟随 live target → _followLiveTarget(默认 false=label 语义；viewer 设 true)。
// 2D 缩放/平移内置(viewer 也要求该能力)，几何在 view_zoom.js(纯函数)。
//
// 内参模型：this.K 是当前生效 K；this._meta_K 是工厂基线(reset 用)。两者及 imageW/imageH 恒为原生(数据)方向。
// 显示旋转(label 的「旋转画面」):_viewRotN 步顺时针,只改相机绕光轴的朝向与投影所用的「转后画面」内参,
// 不改 this.K / 尺寸 / 数据(见 view_roll.js 与 docs/CONTRACTS.md)。
// 2D 适配:contain(图像完整显示,画布按图像比例)或 cover(画布填满容器,图像裁多出的方向,可缩小看全图)。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { computeWindow, zoomAtSolve, imageToCanvasNorm, canvasNormToImage, clampPan, centeredPan } from './view_zoom.js';
import { viewIntrinsics, viewPixelFromNative, nativePixelFromView, rollQuat, normSteps } from './view_roll.js';
import { rotateKn } from './data_rotation.js';
import { frustumOf, extendFrustum, lerpFrustum, viewOffsetFor } from './view_tween.js';
import { computeBackingSize } from './resize.js';
import { focusPlacement } from '../smpl_edit/framing.js';

const TWEEN_MS = 1000;

export class CameraModes {
  /**
   * @param {object} opts
   *   - canvas: renderer canvas (OrbitControls 输入)
   *   - meta:   {K:{fx,fy,cx,cy}, image_w, image_h}
   *   - bgPlaneZ3D: 3D 模式图像平面距离(默认 1.5)
   *   - bgPlaneZ2D: 2D 模式图像平面距离(默认 50)
   */
  constructor({ canvas, meta, bgPlaneZ3D = 1.5, bgPlaneZ2D = 50 }) {
    this.canvas = canvas;
    this.meta = meta;
    // 工厂 K + 尺寸(未旋转)。reset 基线，也是 bg plane 几何的未旋转参考。
    this._meta_K = { fx: meta.K.fx, fy: meta.K.fy, cx: meta.K.cx, cy: meta.K.cy };
    this._meta_W = meta.image_w;
    this._meta_H = meta.image_h;
    // 当前生效 K + 尺寸，用户可经 setIntrinsics 编辑。
    this.K = { ...this._meta_K };
    this.imageW = this._meta_W;
    this.imageH = this._meta_H;
    this.bgPlaneZ3D = bgPlaneZ3D;
    this.bgPlaneZ2D = bgPlaneZ2D;
    this._dataRotN = 0;          // 数据旋转步数(0..3)；label 恒 0，viewer 经 mixin 改写。
    this._viewRotN = 0;          // 显示旋转步数(0..3,顺时针);只影响显示。
    this._fit = 'auto';          // 'auto'(转后为竖图且容器更宽 → cover)| 'contain' | 'cover'
    this._coverAspect = null;    // cover 生效时 = 容器宽高比
    this._viewportAspect = null;
    this._vp = null;             // 容器 CSS 尺寸 { w, h }(setViewportSize);有它才做投影过渡
    this.onSettled = null;       // 切换动画结束回调(宿主重排画布 / 刷新叠加层)
    this._viewPoseQ = null;      // 数据相机朝向(setViewPose);2D 位姿 = 它 · 显示旋转
    this._followLiveTarget = false; // 3D 编辑时是否同步 controls.target(viewer 设 true)。

    // 2D 缩放状态：须在首次 _applyViewOffset 前初始化。
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;

    const fovY = this._fovYDeg();
    this.camera = new THREE.PerspectiveCamera(fovY, this.imageW / this.imageH, 0.01, 200);
    this.camera.up.set(0, 1, 0);
    this._applyViewOffset();

    // 默认 3D 位姿：人体后上方，看向原点附近。
    this._pose3D = {
      position: new THREE.Vector3(2.5, 1.0, -2.5),
      quaternion: this._quatLookingAt(new THREE.Vector3(2.5, 1.0, -2.5), new THREE.Vector3(0, 0, -8)),
      target: new THREE.Vector3(0, 0, -8),
      fov: fovY,
    };
    // 2D 位姿：原点看 -Z，fov 锁内参。
    this._pose2D = {
      position: new THREE.Vector3(0, 0, 0),
      quaternion: this._quatLookingAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)),
      target: new THREE.Vector3(0, 0, -1),
      fov: fovY,
    };
    this._viewPoseQ = this._pose2D.quaternion.clone();

    this.mode = '3d';
    this._applyPose(this._pose3D);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.copy(this._pose3D.target);

    this._tween = null;
  }

  // ── 几何 helpers ──────────────────────────────────────────────────────────
  // 转后画面(显示方向)的内参与尺寸。_viewRotN = 0 时就是 this.K / imageW / imageH。
  _view() {
    const r = viewIntrinsics(this._viewRotN, this.K, this.imageW, this.imageH);
    return { W: r.w, H: r.h, fx: r.fx, fy: r.fy, cx: r.cx, cy: r.cy };
  }
  _fovYDeg() { const v = this._view(); return 2 * Math.atan(v.H / (2 * v.fy)) * 180 / Math.PI; }
  _effectiveAspect() { const v = this._view(); return v.W / v.H; }
  // 2D 画布宽高比:cover = 容器比例(画布填满),contain = 转后图像比例(letterbox)。
  effectiveAspect() { return this._coverAspect ?? this._effectiveAspect(); }
  // _zoom/_pan 是 2D 视图的缩放状态,切到 3D 时保留(切回 2D 恢复);3D 下窗口恒为整幅(只带主点偏移),cover 只在 2D。
  _zoomArgs(mode = this.intendedMode()) {
    const v = this._view();
    const base = { imageW: v.W, imageH: v.H, cx: v.cx, cy: v.cy };
    if (mode !== '2d') return { ...base, zoom: 1, panX: 0, panY: 0 };
    return { ...base, zoom: this._zoom, panX: this._panX, panY: this._panY, aspect: this._coverAspect ?? undefined };
  }

  _quatLookingAt(eye, target) {
    const m = new THREE.Matrix4().lookAt(eye, target, this.camera ? this.camera.up : new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  // PLACEHOLDER_INTRINSICS

  _applyViewOffset() {
    // 用 computeWindow 算缩放子窗口(zoom=1,pan=0 时退化为「主点偏移、窗口=整图」)。
    const win = computeWindow(this._zoomArgs());
    this._win = win;
    const v = this._view();
    // setViewOffset 会把 aspect 改成整幅比例;2D 正需要如此,3D 的 aspect 属于容器,保留。
    const keep = this.camera.aspect;
    this.camera.setViewOffset(v.W, v.H, win.winX, win.winY, win.winW, win.winH);
    if (this.intendedMode() !== '2d') this.camera.aspect = keep;
  }

  // 面板编辑内参 → 覆盖 this.K，刷新相机。
  setIntrinsics({ fx, fy, cx, cy }) {
    if (Number.isFinite(fx)) this.K.fx = fx;
    if (Number.isFinite(fy)) this.K.fy = fy;
    if (Number.isFinite(cx)) this.K.cx = cx;
    if (Number.isFinite(cy)) this.K.cy = cy;
    const fovY = this._fovYDeg();
    this.camera.fov = fovY;
    this._pose3D.fov = fovY;
    this._pose2D.fov = fovY;
    if (this.intendedMode() === '2d') this.camera.aspect = this._effectiveAspect();
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // ── 显示旋转 / 2D 适配 ───────────────────────────────────────────────────
  viewRotation() { return this._viewRotN; }
  setViewRotation(n) {
    this._viewRotN = normSteps(n);
    this.setIntrinsics(this.K);                   // fov / aspect 按转后画面重算
    this._applyViewRoll();
    this._decideFit();
    this._resetZoomPan();
    if (this.mode === '2d' && !this._tween) this._applyPose(this._pose2D);
  }
  fitMode() { return this._fit; }
  coverActive() { return this._coverAspect != null; }
  setFitMode(fit) { this._fit = fit; this._decideFit(); this._resetZoomPan(); }
  // 宿主在重排画布前告知容器尺寸(cover 判定要用)。
  setViewportSize(w, h) { if (w > 0 && h > 0) { this._vp = { w, h }; this._viewportAspect = w / h; this._decideFit(); } }
  _decideFit() {
    const img = this._effectiveAspect(), vp = this._viewportAspect;
    const cover = vp != null && (this._fit === 'cover' || (this._fit === 'auto' && img < 1 && vp > img * 1.05));
    const next = cover ? vp : null;
    if (next === this._coverAspect) return;
    const wasCover = this._coverAspect != null;
    this._coverAspect = next;
    if (wasCover !== cover) this._resetZoomPan();
    else this._setZoomPan(this._zoom, this._panX, this._panY);   // 容器比例变了:窗口按新比例重新钳制
  }
  // 2D 下重排画布后调用:相机 aspect 必须是转后图像比例(setViewOffset 的全幅),画布比例由窗口决定。
  refreshProjection() {
    if (this.intendedMode() !== '2d') return;
    this.camera.aspect = this._effectiveAspect();
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
  }
  _applyViewRoll() {
    if (!this._viewPoseQ) return;
    const r = rollQuat(this._viewRotN);
    const q = this._viewPoseQ.clone().multiply(new THREE.Quaternion(r[0], r[1], r[2], r[3]));
    this._pose2D.quaternion.copy(q);
    this.camera.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(q));
    this._pose3D.quaternion.copy(this._quatLookingAt(this._pose3D.position, this._pose3D.target));
  }
  // 显示旋转在世界系里的等效旋转(绕数据相机光轴):把未转时的「上」转到转后的「上」。宿主用它摆地面网格。
  viewRollWorldQuat() {
    const r = rollQuat(this._viewRotN);
    return this._viewPoseQ.clone().multiply(new THREE.Quaternion(r[0], r[1], r[2], r[3])).multiply(this._viewPoseQ.clone().invert());
  }
  // 画面放大倍数(手柄屏幕尺寸补偿用):转后图像高 / 窗口高。contain、未缩放时 = 1。
  getMagnification() {
    if (!this._win) this._applyViewOffset();
    return this._view().H / this._win.winH;
  }

  // 还原工厂 K(按当前 _dataRotN 旋转后)。label 的 _dataRotN 恒 0 → 还原未旋转工厂 K。
  resetIntrinsics() {
    const r = rotateKn(this._meta_K, this._meta_W, this._meta_H, this._dataRotN);
    this.K = { fx: r.fx, fy: r.fy, cx: r.cx, cy: r.cy };
    this.imageW = r.w; this.imageH = r.h;
    this.setIntrinsics(this.K);
  }

  // 采用数据集真实图像尺寸为工厂基线：主点居中(cx=W/2,cy=H/2)，焦距仅 finite 时改。
  // 否则一切按写死的 1920×1080，非该分辨率时主点落错像素 → 人体偏左上、偏小。成为 reset 基线。
  // 给了 cx/cy(标定内参)则用标定主点,否则居中。
  configureForImage({ width, height, fx, fy, cx, cy }) {
    if (Number.isFinite(width) && width > 0) { this._meta_W = width; this.imageW = width; }
    if (Number.isFinite(height) && height > 0) { this._meta_H = height; this.imageH = height; }
    if (Number.isFinite(fx)) this._meta_K.fx = fx;
    if (Number.isFinite(fy)) this._meta_K.fy = fy;
    this._meta_K.cx = Number.isFinite(cx) ? cx : this.imageW / 2;
    this._meta_K.cy = Number.isFinite(cy) ? cy : this.imageH / 2;
    this.K = { ...this._meta_K };
    this.setIntrinsics(this.K);
  }

  // PLACEHOLDER_ZOOM

  // 统一写入缩放/平移尾巴：写 zoom → clampPan → 写 pan → 应用 viewOffset → 刷新投影。
  _setZoomPan(zoom, panX, panY) {
    this._zoom = zoom;
    const p = clampPan({ ...this._zoomArgs('2d'), zoom, panX, panY });
    this._panX = p.panX; this._panY = p.panY;
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // 在画布归一化点 (u,v) 处按 factor 缩放，使该点下的图像保持不动。
  zoomAt(u, v, factor) {
    const r = zoomAtSolve({ ...this._zoomArgs('2d'), u, v, factor });
    this._setZoomPan(r.zoom, r.panX, r.panY);
  }

  // 按画布归一化位移 (du,dv) 平移视图。pan 钳制回有效区间(消除沿边界拖拽死区)。
  panByCanvas(du, dv) {
    if (!this._win) this._applyViewOffset();
    const px = this._panX - du * this._win.winW;
    const py = this._panY - dv * this._win.winH;
    this._setZoomPan(this._zoom, px, py);
  }

  // 复位:zoom 1;cover 时窗口居中(竖图横看默认看中间)。
  resetZoom() { this._resetZoomPan(); }
  _resetZoomPan() {
    const c = this._coverAspect != null ? centeredPan(this._zoomArgs('2d')) : { panX: 0, panY: 0 };
    this._setZoomPan(1, c.panX, c.panY);
  }

  getZoom() { return this._zoom; }

  // 原生(数据)像素 ↔ 画布归一化坐标:中间经过显示旋转。bbox 等存储量始终用原生像素。
  imageToCanvasNorm(ix, iy) {
    if (!this._win) this._applyViewOffset();
    const [x, y] = viewPixelFromNative(this._viewRotN, ix, iy, this.imageW, this.imageH);
    return imageToCanvasNorm(x, y, this._win);
  }
  canvasNormToImage(u, v) {
    if (!this._win) this._applyViewOffset();
    const [x, y] = canvasNormToImage(u, v, this._win);
    return nativePixelFromView(this._viewRotN, x, y, this.imageW, this.imageH);
  }

  // 2D 对齐视角 = 数据相机的位姿(相机→世界,R 行主序 9、t 3)。单视角旧数据不调用:
  // 保持原点、看 −Z。多相机 / 转正配置下由 CameraRig 视图相机给出(已含显示旋转)。
  // 同时把 3D 环绕的「上」设为该视图画面的上方向,转正后的画面上 = 3D 上。
  setViewPose({ R, t }) {
    const m = new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this._viewPoseQ = q.clone();
    this._pose2D.position.set(t[0], t[1], t[2]);
    this._pose2D.quaternion.copy(q);
    this._pose2D.target.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(q).add(this._pose2D.position));
    this._applyViewRoll();   // 显示旋转叠在数据相机朝向上(绕光轴,target 不变)
  }

  // 数据相机位姿(背景平面/视锥挂在它上面;不含显示旋转 —— 背景随相机一起转,不单独转)。
  viewPose() { return { position: this._pose2D.position.clone(), quaternion: (this._viewPoseQ ?? this._pose2D.quaternion).clone() }; }

  _applyPose(p) {
    this.camera.position.copy(p.position);
    this.camera.quaternion.copy(p.quaternion);
    this.camera.fov = p.fov;
    this.camera.updateProjectionMatrix();
  }

  _capturePose(target = 'auto') {
    const slot = (target === 'auto') ? (this.mode === '3d' ? this._pose3D : this._pose2D)
      : (target === '3d' ? this._pose3D : this._pose2D);
    slot.position.copy(this.camera.position);
    slot.quaternion.copy(this.camera.quaternion);
    slot.target.copy(this.controls.target);
    slot.fov = this.camera.fov;
  }

  // 更新 3D 位姿的看向目标(pelvis)，让将来 2D→3D 切换面向人体。默认不写 live
  // controls.target(避免 3D 编辑时被拽回 pelvis 的「视角重置」bug)。viewer 设
  // _followLiveTarget=true 时在 3D 静止态同步 live target(保其逐帧跟随手感)。
  set3DFollowTarget(vec3) {
    this._pose3D.target.copy(vec3);
    this._pose3D.quaternion.copy(this._quatLookingAt(this._pose3D.position, vec3));
    if (this._followLiveTarget && this.mode === '3d' && !this._tween) {
      this.controls.target.copy(vec3);
    }
  }

  // F 聚焦：仅 3D。保持朝向，把 controls.target 移到 center 并按 radius 拉开。
  focusOn(center, radius) {
    if (this.mode !== '3d' || this.isAnimating()) return false;
    const view = { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
    const out = focusPlacement(view, center, radius);
    this.camera.position.set(out.position[0], out.position[1], out.position[2]);
    this.controls.target.set(out.target[0], out.target[1], out.target[2]);
    this._pose3D.position.copy(this.camera.position);
    this._pose3D.target.copy(this.controls.target);
    this._pose3D.quaternion.copy(this._quatLookingAt(this.camera.position, this.controls.target));
    this.controls.update();
    return true;
  }

  isAnimating() { return this._tween !== null; }

  // 正在切入的模式：tween 中为目标态，否则当前态。视图相关可见性须用它而非 this.mode
  // (1s slerp 期间 this.mode 仍是旧值 → stale-mode bug)。
  intendedMode() { return this._tween ? this._tween.dest : this.mode; }

  // 背景平面参数(未旋转工厂 K/尺寸)：world 尺寸 = image_px * z / focal。
  bgPlaneParams() {
    const W = this._meta_W, H = this._meta_H;
    const fx = this._meta_K.fx, fy = this._meta_K.fy;
    return {
      near: { z: -this.bgPlaneZ3D, w: W * this.bgPlaneZ3D / fx, h: H * this.bgPlaneZ3D / fy },
      far: { z: -this.bgPlaneZ2D, w: W * this.bgPlaneZ2D / fx, h: H * this.bgPlaneZ2D / fy },
      frustum_visible: this.mode === '3d',
    };
  }

  switchTo(mode) {
    if (mode !== '2d' && mode !== '3d') throw new Error(`bad mode: ${mode}`);
    if (this.mode === mode && !this._tween) return;
    // 仅从「静止态」起步时 capture 离开的位姿；tween 中按按钮则直接 re-target(后按胜)。
    if (!this._tween) this._capturePose('auto');
    this.controls.enabled = false;
    const from = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
      target: this.controls.target.clone(),
      fov: this.camera.fov,
    };
    const to = (mode === '2d') ? this._pose2D : this._pose3D;
    // 投影过渡:起点 = 当前屏幕上的样子(静止态的 2D 缩放/填满/留边,或上一段动画的当前帧),终点 = 目标态。
    // 视野张角也算在里面,手柄与 2D 的画面像素对得上;2D 的缩放状态保留,切回 2D 时还原。
    const prev = this._tween;
    const view = this._vp ? {
      from: prev?.view ? prev.view.cur : this._settledView(this.mode),
      to: this._settledView(mode),
    } : null;
    this._tween = { from, to, startTs: performance.now(), dest: mode, view };
    if (view) view.cur = view.from;
    else { this._applyViewOffset(); this.camera.updateProjectionMatrix(); }   // 无容器尺寸(viewer):窗口直接换成目标态
  }

  // 静止态 mode 在「铺满整个容器」时的视锥,以及它在屏幕上的画布高度占比(手柄尺寸补偿用)、3D 物件可见度。
  _settledView(mode) {
    const v = this._view();
    const win = computeWindow(this._zoomArgs(mode));
    const view = { fullWidth: v.W, fullHeight: v.H, offsetX: win.winX, offsetY: win.winY, width: win.winW, height: win.winH };
    const { w: cw, h: ch } = this._vp;
    if (mode !== '2d') return { f: frustumOf({ fov: this._fovYDeg(), aspect: cw / ch, view }), rect: { x0: 0, y0: 0, x1: 1, y1: 1 }, hFrac: 1, w3d: 1 };
    const { cssW, cssH } = computeBackingSize({ containerW: cw, containerH: ch, imageAspect: this.effectiveAspect(), bufferPolicy: 'letterbox' });
    const x0 = (cw - cssW) / 2 / cw, y0 = (ch - cssH) / 2 / ch;
    const rect = { x0, y0, x1: x0 + cssW / cw, y1: y0 + cssH / ch };
    return { f: extendFrustum(frustumOf({ fov: this._fovYDeg(), aspect: v.W / v.H, view }), rect), rect, hFrac: cssH / ch, w3d: 0 };
  }

  // 切换动画中实际出图的区域(容器内归一化矩形):从 2D 画面所在的矩形渐变到整个容器,外面保持底色。
  // 静止态返回 null(画布本身就是出图区域)。
  transitionRect() { return this._tween?.view?.cur?.rect ?? null; }

  // 3D 专属物件(地面网格、视锥线、近处底图)的可见度 0..1:2D = 0,3D = 1,切换中渐变。
  blend3D() {
    const cur = this._tween?.view?.cur;
    if (cur) return cur.w3d;
    return this.intendedMode() === '3d' ? 1 : 0;
  }

  // 手柄尺寸系数:2D 抵消缩放/填满的放大;切换中按画布高度占比渐变,屏幕上手柄大小连续。
  handleScale() {
    const cur = this._tween?.view?.cur;
    if (cur) return cur.hFrac;
    return this.mode === '2d' ? 1 / Math.max(1e-3, this.getMagnification()) : 1;
  }

  // 动画结束:把投影换回目标态的正式参数(fov、aspect、viewOffset)。
  _settleProjection() {
    const p = this.mode === '2d' ? this._pose2D : this._pose3D;
    this.camera.fov = p.fov;
    this.camera.aspect = this.mode === '2d' ? this._effectiveAspect() : (this._vp ? this._vp.w / this._vp.h : this.camera.aspect);
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // 瞬时切换(初次加载用)。
  snapTo(mode) {
    if (mode !== '2d' && mode !== '3d') throw new Error(`bad mode: ${mode}`);
    this._tween = null;
    this.mode = mode;
    this._resetZoomPan();
    if (mode === '3d' && this._vp) this.camera.aspect = this._vp.w / this._vp.h;
    const slot = (mode === '2d') ? this._pose2D : this._pose3D;
    this._applyPose(slot);
    this.controls.target.copy(slot.target);
    this.controls.enabled = (mode === '3d');
    this.controls.update();
  }

  // 每帧渲染前调用，推进 tween。
  update(now = performance.now()) {
    if (!this._tween) {
      if (this.mode === '3d') this.controls.update();
      return;
    }
    const { from, to, startTs, dest, view } = this._tween;
    const t = Math.min(1, (now - startTs) / TWEEN_MS);
    const k = 0.5 - 0.5 * Math.cos(Math.PI * t); // ease-in-out
    this.camera.position.lerpVectors(from.position, to.position, k);
    this.camera.quaternion.copy(from.quaternion).slerp(to.quaternion, k);
    this.controls.target.lerpVectors(from.target, to.target, k);
    if (view) {
      // 画布在动画中填满容器;视锥从起点插到终点。
      const m = (a, b) => a + (b - a) * k;
      const r0 = view.from.rect, r1 = view.to.rect;
      view.cur = {
        f: lerpFrustum(view.from.f, view.to.f, k),
        rect: { x0: m(r0.x0, r1.x0), y0: m(r0.y0, r1.y0), x1: m(r0.x1, r1.x1), y1: m(r0.y1, r1.y1) },
        hFrac: m(view.from.hFrac, view.to.hFrac), w3d: m(view.from.w3d, view.to.w3d),
      };
      const o = viewOffsetFor(view.cur.f);
      this.camera.fov = o.fov;
      this.camera.setViewOffset(2, 2, o.x, o.y, o.w, o.h);
    } else {
      this.camera.fov = from.fov + (to.fov - from.fov) * k;
    }
    this.camera.updateProjectionMatrix();
    if (t >= 1) {
      this.mode = dest;
      this._tween = null;
      this.controls.enabled = (this.mode === '3d');
      this._applyPose(to);
      if (view) this._settleProjection();
      this.controls.target.copy(to.target);
      this.controls.update();   // 同步 OrbitControls spherical，避免下一帧瞬移
      this.onSettled?.();
    }
  }
}
