// label_mocap/smpl_viewer/camera_modes.js
// One PerspectiveCamera, two modes (3d/2d), 1s slerp on switch.
// Each switch interpolates from the *current* pose to the *last saved* target pose.
//
// Intrinsics model: `this.K` is the K *currently in use* by the camera.
// `dataRotN` rotations transform K alongside content, so the panel always
// reflects what's actually rendering. `this._meta_K` is the factory K kept
// for the reset button and for bg-plane geometry (which lives in
// un-rotated world space — only the plane mesh's `rotation.z` follows N).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TWEEN_MS = 1000;

// Apply N×CW rotation about camera-out to (K, W, H). Image-space pixel
// coords are y-down, so 1× CW maps (u, v) → (h − v, u). Focals swap each step.
function rotateKn(K, W, H, n) {
  let fx = K.fx, fy = K.fy, cx = K.cx, cy = K.cy;
  let w = W, h = H;
  const steps = ((n % 4) + 4) % 4;
  for (let i = 0; i < steps; i++) {
    const ncx = h - cy;
    const ncy = cx;
    const nfx = fy, nfy = fx;
    fx = nfx; fy = nfy;
    cx = ncx; cy = ncy;
    const nw = h, nh = w;
    w = nw; h = nh;
  }
  return { fx, fy, cx, cy, w, h };
}

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
    // Live K + image dims. These rotate with dataRotN AND are user-editable.
    // The panel always shows / edits this.K — single source of truth.
    this.K = { ...this._meta_K };
    this.imageW = this._meta_W;
    this.imageH = this._meta_H;
    this.bgPlaneZ3D = bgPlaneZ3D;
    this.bgPlaneZ2D = bgPlaneZ2D;
    this._dataRotN = 0;     // 0..3, CW about camera-out

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

  // ── Geometry helpers (single K is now the live, rotated K) ─────────────

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
    // Principal-point offset → setViewOffset. K is already rotated, so we
    // express the offset directly in the live (rotated) image frame.
    const offX = this.imageW / 2 - this.K.cx;
    const offY = this.imageH / 2 - this.K.cy;
    this.camera.setViewOffset(this.imageW, this.imageH, offX, offY,
                              this.imageW, this.imageH);
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

  /** Restore K to the factory `meta.K` for the *current* dataRotN. */
  resetIntrinsics() {
    const r = rotateKn(this._meta_K, this._meta_W, this._meta_H, this._dataRotN);
    this.K.fx = r.fx; this.K.fy = r.fy; this.K.cx = r.cx; this.K.cy = r.cy;
    this.imageW = r.w; this.imageH = r.h;
    this.setIntrinsics(this.K);   // re-apply (also updates camera matrix)
  }

  /** Set rotation count; rotates this.K AND imageW/H so panel shows live values. */
  setDataRotation(n) {
    const target = ((n % 4) + 4) % 4;
    const delta = ((target - this._dataRotN) % 4 + 4) % 4;
    if (delta !== 0) {
      // Apply `delta` CW steps to the *current* live K (so user edits made
      // mid-rotation are preserved through the next rotation).
      const r = rotateKn(this.K, this.imageW, this.imageH, delta);
      this.K.fx = r.fx; this.K.fy = r.fy; this.K.cx = r.cx; this.K.cy = r.cy;
      this.imageW = r.w; this.imageH = r.h;
    }
    this._dataRotN = target;
    const fovY = this._fovYDeg();
    this.camera.fov = fovY;
    this._pose3D.fov = fovY;
    this._pose2D.fov = fovY;
    this.camera.aspect = this.imageW / this.imageH;
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
  }
  getDataRotation() { return this._dataRotN; }

  effectiveAspect() { return this._effectiveAspect(); }

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

  /** Update the 3D OrbitControls target (call per frame to follow root joint).
   *  Also re-aim the saved 3D pose so a 2D→3D switch lerps to a quaternion
   *  that actually faces the new pelvis (otherwise tween lands aimed at the
   *  prior target and OrbitControls.update() would snap-correct → "瞬移"). */
  set3DFollowTarget(vec3) {
    this._pose3D.target.copy(vec3);
    // Re-derive the saved-pose quaternion using the saved-pose position →
    // new target. Keeps the user's rotated/zoomed eye, just re-aims.
    this._pose3D.quaternion.copy(
      this._quatLookingAt(this._pose3D.position, vec3));
    if (this.mode === '3d' && !this._tween) {
      this.controls.target.copy(vec3);
    }
  }

  /** Returns true while a tween is in progress. */
  isAnimating() { return this._tween !== null; }

  /** Returns 'background plane params' for the current state, used by viewer to position bg planes.
   *
   *  IMPORTANT: plane geometry is NATIVE (un-rotated, factory-K) image dims.
   *  The viewer rotates the plane mesh by `mesh.rotation.z` to track dataRotN.
   *  If we used the live rotated K AND rotated the plane mesh, we'd double-
   *  rotate. Plane geometry stays in source coords; live K/rotation only
   *  affects camera projection.
   *
   *  Native plane width/height in world units = image_pixels * z / focal,
   *  using the *factory* meta_K (un-rotated). 1 image pixel at world distance
   *  z covers `z/f` world units.
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
    if (this.mode === mode || this._tween) return;

    // Save the pose we're leaving.
    this._capturePose('auto');

    // Lock controls during the tween (we re-enable after if landing in 3d).
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
