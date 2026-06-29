// smpl_render/camera_modes.js
// 共享相机内核：一台 PerspectiveCamera，两模式(3d/2d)，1s ease-in-out slerp 切换。
// label 与 viewer 共用本基类。差异收口：
//   - 数据旋转(仅 viewer) → data_rotation.js#withDataRotation 挂载，基类只留 _dataRotN(默认0)。
//   - 3D 编辑时是否跟随 live target → _followLiveTarget(默认 false=label 语义；viewer 设 true)。
// 2D 缩放/平移内置(viewer 也要求该能力)，几何在 view_zoom.js(纯函数)。
//
// 内参模型：this.K 是当前生效 K；this._meta_K 是工厂基线(reset 用)。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { computeWindow, zoomAtSolve, imageToCanvasNorm, canvasNormToImage, clampPan } from './view_zoom.js';
import { rotateKn } from './data_rotation.js';
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

    this.mode = '3d';
    this._applyPose(this._pose3D);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.copy(this._pose3D.target);

    this._tween = null;
  }

  // ── 几何 helpers ──────────────────────────────────────────────────────────
  _fovYDeg() { return 2 * Math.atan(this.imageH / (2 * this.K.fy)) * 180 / Math.PI; }
  _effectiveAspect() { return this.imageW / this.imageH; }
  effectiveAspect() { return this._effectiveAspect(); }

  _quatLookingAt(eye, target) {
    const m = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  // PLACEHOLDER_INTRINSICS

  _applyViewOffset() {
    // 用 computeWindow 算缩放子窗口(zoom=1,pan=0 时退化为「主点偏移、窗口=整图」)。
    const win = computeWindow({
      imageW: this.imageW, imageH: this.imageH, cx: this.K.cx, cy: this.K.cy,
      zoom: this._zoom, panX: this._panX, panY: this._panY,
    });
    this._win = win;
    this.camera.setViewOffset(this.imageW, this.imageH, win.winX, win.winY, win.winW, win.winH);
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
    this.camera.aspect = this.imageW / this.imageH;
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
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
  configureForImage({ width, height, fx, fy }) {
    if (Number.isFinite(width) && width > 0) { this._meta_W = width; this.imageW = width; }
    if (Number.isFinite(height) && height > 0) { this._meta_H = height; this.imageH = height; }
    if (Number.isFinite(fx)) this._meta_K.fx = fx;
    if (Number.isFinite(fy)) this._meta_K.fy = fy;
    this._meta_K.cx = this.imageW / 2;
    this._meta_K.cy = this.imageH / 2;
    this.K = { ...this._meta_K };
    this.setIntrinsics(this.K);
  }

  // PLACEHOLDER_ZOOM

  // 统一写入缩放/平移尾巴：写 zoom → clampPan → 写 pan → 应用 viewOffset → 刷新投影。
  _setZoomPan(zoom, panX, panY) {
    this._zoom = zoom;
    const p = clampPan({ imageW: this.imageW, imageH: this.imageH, cx: this.K.cx, cy: this.K.cy, zoom, panX, panY });
    this._panX = p.panX; this._panY = p.panY;
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // 在画布归一化点 (u,v) 处按 factor 缩放，使该点下的图像保持不动。
  zoomAt(u, v, factor) {
    const r = zoomAtSolve({
      imageW: this.imageW, imageH: this.imageH, cx: this.K.cx, cy: this.K.cy,
      zoom: this._zoom, panX: this._panX, panY: this._panY, u, v, factor,
    });
    this._setZoomPan(r.zoom, r.panX, r.panY);
  }

  // 按画布归一化位移 (du,dv) 平移视图。pan 钳制回有效区间(消除沿边界拖拽死区)。
  panByCanvas(du, dv) {
    if (!this._win) this._applyViewOffset();
    const px = this._panX - du * this._win.winW;
    const py = this._panY - dv * this._win.winH;
    this._setZoomPan(this._zoom, px, py);
  }

  resetZoom() {
    if (this._zoom === 1 && this._panX === 0 && this._panY === 0) return;
    this._setZoomPan(1, 0, 0);
  }

  getZoom() { return this._zoom; }

  imageToCanvasNorm(ix, iy) {
    if (!this._win) this._applyViewOffset();
    return imageToCanvasNorm(ix, iy, this._win);
  }
  canvasNormToImage(u, v) {
    if (!this._win) this._applyViewOffset();
    return canvasNormToImage(u, v, this._win);
  }

  // PLACEHOLDER_POSE

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
    if (mode === '3d') this.resetZoom();   // 缩放只改 viewOffset，不影响 tween 位姿
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
    this._tween = { from, to, startTs: performance.now(), dest: mode };
  }

  // 瞬时切换(初次加载用)。
  snapTo(mode) {
    if (mode !== '2d' && mode !== '3d') throw new Error(`bad mode: ${mode}`);
    this._tween = null;
    this.mode = mode;
    if (mode === '3d') this.resetZoom();
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
    const { from, to, startTs, dest } = this._tween;
    const t = Math.min(1, (now - startTs) / TWEEN_MS);
    const k = 0.5 - 0.5 * Math.cos(Math.PI * t); // ease-in-out
    this.camera.position.lerpVectors(from.position, to.position, k);
    this.camera.quaternion.copy(from.quaternion).slerp(to.quaternion, k);
    this.controls.target.lerpVectors(from.target, to.target, k);
    this.camera.fov = from.fov + (to.fov - from.fov) * k;
    this.camera.updateProjectionMatrix();
    if (t >= 1) {
      this.mode = dest;
      this._tween = null;
      this.controls.enabled = (this.mode === '3d');
      this._applyPose(to);
      this.controls.target.copy(to.target);
      this.controls.update();   // 同步 OrbitControls spherical，避免下一帧瞬移
    }
  }
}
