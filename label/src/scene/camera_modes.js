// label_mocap/label/src/scene/camera_modes.js
// One PerspectiveCamera, two modes (3d/2d), 1s slerp on switch.
// Each switch interpolates from the *current* pose to the *last saved* target pose.
//
// Intrinsics model: `this.K` is the K currently in use by the camera.
// `this._meta_K` is the factory K kept for the reset button.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { computeWindow, zoomAtSolve, imageToCanvasNorm, canvasNormToImage, clampPan } from './view_zoom.js';
import { focusPlacement } from '../../../smpl_edit/framing.js';

const TWEEN_MS = 1000;

export class CameraModes {
  /**
   * @param {object} opts
   *   - canvas: the renderer canvas (for OrbitControls input)
   *   - meta:   {K:{fx,fy,cx,cy}, image_w, image_h}
   *   - bgPlaneZ3D: distance to image plane in 3D mode (positive number, default 1.5)
   *   - bgPlaneZ2D: distance to image plane in 2D mode (default 50)
   */
  constructor({ canvas, meta, bgPlaneZ3D = 1.5, bgPlaneZ2D = 50 }) {
    this.canvas = canvas;
    this.meta = meta;
    // Factory K + dims (un-rotated). For reset button, and as the un-rotated
    // reference for bg plane geometry (which lives in source coords; rotation
    // is applied to the plane mesh's rotation.z by the viewer).
    this._meta_K = { fx: meta.K.fx, fy: meta.K.fy, cx: meta.K.cx, cy: meta.K.cy };
    this._meta_W = meta.image_w;
    this._meta_H = meta.image_h;
    // Live K + image dims. User-editable via setIntrinsics.
    this.K = { ...this._meta_K };
    this.imageW = this._meta_W;
    this.imageH = this._meta_H;
    this.bgPlaneZ3D = bgPlaneZ3D;
    this.bgPlaneZ2D = bgPlaneZ2D;

    // 2D 缩放状态:必须在首次 _applyViewOffset() 之前初始化,
    // 否则 computeWindow 会拿到 undefined 的 zoom/pan。
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;

    const fovY = this._fovYDeg();
    this.camera = new THREE.PerspectiveCamera(fovY, this.imageW / this.imageH, 0.01, 200);
    this.camera.up.set(0, 1, 0);
    this._applyViewOffset();

    // Default 3D pose: behind and above the diver, looking at origin.
    this._pose3D = {
      position: new THREE.Vector3(2.5, 1.0, -2.5),
      quaternion: this._quatLookingAt(
        new THREE.Vector3(2.5, 1.0, -2.5),
        new THREE.Vector3(0, 0, -8)),
      target: new THREE.Vector3(0, 0, -8),  // OrbitControls target; per-frame updated by viewer
      fov: fovY,
    };
    // 2D pose: at origin, looking -Z, fov locked to intrinsics.
    this._pose2D = {
      position: new THREE.Vector3(0, 0, 0),
      quaternion: this._quatLookingAt(new THREE.Vector3(0, 0, 0),
                                      new THREE.Vector3(0, 0, -1)),
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

  // ── Geometry helpers ────────────────────────────────────────────────────

  /** Camera fov_y is computed directly from the live K + imageH. */
  _fovYDeg() {
    return 2 * Math.atan(this.imageH / (2 * this.K.fy)) * 180 / Math.PI;
  }

  _effectiveAspect() {
    return this.imageW / this.imageH;
  }

  _quatLookingAt(eye, target) {
    const m = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  _applyViewOffset() {
    const win = computeWindow({
      imageW: this.imageW, imageH: this.imageH, cx: this.K.cx, cy: this.K.cy,
      zoom: this._zoom, panX: this._panX, panY: this._panY,
    });
    this._win = win; // 缓存供映射方法用
    this.camera.setViewOffset(this.imageW, this.imageH, win.winX, win.winY, win.winW, win.winH);
  }

  /** User-edited intrinsics from the panel — overwrites this.K, refreshes camera. */
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

  /** Restore K to the factory `meta.K`. */
  resetIntrinsics() {
    this.K = { ...this._meta_K };
    this.imageW = this._meta_W;
    this.imageH = this._meta_H;
    this.setIntrinsics(this.K);
  }

  /** Adopt the loaded dataset's real image geometry as the factory baseline.
   *  Sets image dims and a centered principal point (cx=W/2, cy=H/2); keeps the
   *  current focal unless a finite fx/fy is given. This is the single place the
   *  camera learns the actual image size — without it everything assumes the
   *  hardcoded 1920x1080, which puts the principal point at the wrong pixel for
   *  any other resolution (person drifts toward the top-left, appears small).
   *  Becomes the reset baseline (_meta_*), so resetIntrinsics returns here. */
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

  effectiveAspect() { return this._effectiveAspect(); }

  // ── 2D 缩放/平移 ─────────────────────────────────────────────────────────

  // 统一写入缩放/平移尾巴:写 zoom → clampPan → 写 panX/panY → 应用 viewOffset → 刷新投影。
  _setZoomPan(zoom, panX, panY) {
    this._zoom = zoom;
    const p = clampPan({ imageW: this.imageW, imageH: this.imageH, cx: this.K.cx, cy: this.K.cy, zoom, panX, panY });
    this._panX = p.panX; this._panY = p.panY;
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // 在画布归一化点 (u,v) 处按 factor 缩放,使该点下的图像保持不动。
  zoomAt(u, v, factor) {
    const r = zoomAtSolve({
      imageW: this.imageW, imageH: this.imageH, cx: this.K.cx, cy: this.K.cy,
      zoom: this._zoom, panX: this._panX, panY: this._panY, u, v, factor,
    });
    this._setZoomPan(r.zoom, r.panX, r.panY);
  }

  // 按画布归一化位移 (du,dv) 平移视图。pan 钳制回有效区间(消除沿边界拖拽的死区)。
  panByCanvas(du, dv) {
    if (!this._win) this._applyViewOffset();
    const px = this._panX - du * this._win.winW;
    const py = this._panY - dv * this._win.winH;
    this._setZoomPan(this._zoom, px, py);
  }

  // 复位缩放/平移到初始状态(z=1, pan=0)。
  resetZoom() {
    if (this._zoom === 1 && this._panX === 0 && this._panY === 0) return;
    this._setZoomPan(1, 0, 0);
  }

  // 图像像素 → 画布归一化(考虑当前缩放窗口)。
  imageToCanvasNorm(ix, iy) {
    if (!this._win) this._applyViewOffset();
    return imageToCanvasNorm(ix, iy, this._win);
  }
  // 画布归一化 → 图像像素(考虑当前缩放窗口)。
  canvasNormToImage(u, v) {
    if (!this._win) this._applyViewOffset();
    return canvasNormToImage(u, v, this._win);
  }

  _applyPose(p) {
    this.camera.position.copy(p.position);
    this.camera.quaternion.copy(p.quaternion);
    this.camera.fov = p.fov;
    this.camera.updateProjectionMatrix();
  }

  _capturePose(target = 'auto') {
    // Save current camera state into the slot the user is leaving.
    const slot = (target === 'auto') ? (this.mode === '3d' ? this._pose3D : this._pose2D)
                                     : (target === '3d' ? this._pose3D : this._pose2D);
    slot.position.copy(this.camera.position);
    slot.quaternion.copy(this.camera.quaternion);
    slot.target.copy(this.controls.target);
    slot.fov = this.camera.fov;
  }

  /** Update the saved 3D pose's look target (pelvis) so a future 2D→3D switch
   *  faces the body. Does NOT touch the live controls.target in 3D — in free 3D
   *  the camera belongs to the user; overwriting controls.target on every edit
   *  (gizmo / IK drag / frame) would yank a panned/orbited view back to the
   *  pelvis (the "视角重置" bug). The saved pose is only applied on snapTo/switchTo. */
  set3DFollowTarget(vec3) {
    this._pose3D.target.copy(vec3);
    this._pose3D.quaternion.copy(
      this._quatLookingAt(this._pose3D.position, vec3));
  }

  /** F 聚焦:仅 3D 模式生效。保持朝向,把 controls.target 移到 center 并按 radius 拉开。
   *  2D 模式(锁内参看图)不响应——视口已足够小。返回是否执行。 */
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

  /** Returns true while a tween is in progress. */
  isAnimating() { return this._tween !== null; }

  /** The mode the camera is settling into: the tween destination while a switch
   *  is animating, else the current mode. View-dependent visibility (e.g. the
   *  2D bbox overlay, tab availability) MUST use this, not `this.mode` — during
   *  the 1s slerp `this.mode` still holds the OLD value, which otherwise shows a
   *  2D bbox in 3D and hides it in 2D (stale-mode bug). */
  intendedMode() { return this._tween ? this._tween.dest : this.mode; }

  /** Returns background plane params for the current state, used by scene to position bg planes.
   *  Plane width/height in world units = image_pixels * z / focal, using factory meta_K.
   */
  bgPlaneParams() {
    const W = this._meta_W, H = this._meta_H;
    const fx = this._meta_K.fx, fy = this._meta_K.fy;
    return {
      near: {
        z: -this.bgPlaneZ3D,
        w: W * this.bgPlaneZ3D / fx,
        h: H * this.bgPlaneZ3D / fy,
      },
      far: {
        z: -this.bgPlaneZ2D,
        w: W * this.bgPlaneZ2D / fx,
        h: H * this.bgPlaneZ2D / fy,
      },
      frustum_visible: this.mode === '3d',
    };
  }

  switchTo(mode) {
    if (mode !== '2d' && mode !== '3d') throw new Error(`bad mode: ${mode}`);
    // Already settled in the target mode → nothing to do.
    if (this.mode === mode && !this._tween) return;

    // 2D→3D 立即复位缩放:缩放只改 viewOffset,不影响 tween 位姿。
    if (mode === '3d') this.resetZoom();

    // Only capture the pose we're leaving when starting from a SETTLED state.
    // Mid-tween the camera is at an interpolated pose that isn't a real resting
    // slot — capturing it would corrupt the saved 2D/3D poses. Skipping capture
    // lets a press during the animation simply RE-TARGET (later press wins).
    if (!this._tween) this._capturePose('auto');

    // Lock controls during the tween (re-enabled after if landing in 3d).
    this.controls.enabled = false;

    const from = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
      target: this.controls.target.clone(),
      fov: this.camera.fov,
    };
    const to = (mode === '2d') ? this._pose2D : this._pose3D;

    const startTs = performance.now();
    this._tween = { from, to, startTs, dest: mode };
  }

  /** Instantly switch mode without slerp; used for initial sequence load. */
  snapTo(mode) {
    if (mode !== '2d' && mode !== '3d') throw new Error(`bad mode: ${mode}`);
    this._tween = null;
    this.mode = mode;
    if (mode === '3d') this.resetZoom(); // 切回 3D 时复位缩放
    const slot = (mode === '2d') ? this._pose2D : this._pose3D;
    this._applyPose(slot);
    this.controls.target.copy(slot.target);
    this.controls.enabled = (mode === '3d');
    this.controls.update();   // sync OrbitControls' spherical state to new pose
  }

  /** Advance any active tween. Call once per frame *before* renderer.render(). */
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
      // Snap to the exact target to kill any rounding error.
      this._applyPose(to);
      this.controls.target.copy(to.target);
      // Sync OrbitControls' internal spherical state to the freshly-snapped
      // camera/target. Without this, the next .update() can recompute the
      // quaternion from spherical coords stored before the tween → 瞬移.
      this.controls.update();
    }
  }

}
