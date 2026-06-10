// label_mocap/smpl_viewer/camera_modes.js
// One PerspectiveCamera, two modes (3d/2d), 1s slerp on switch.
// Each switch interpolates from the *current* pose to the *last saved* target pose.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
    // Live-mutable intrinsics — start as a copy of meta.K so resets work.
    this.K = { fx: meta.K.fx, fy: meta.K.fy, cx: meta.K.cx, cy: meta.K.cy };
    this.bgPlaneZ3D = bgPlaneZ3D;
    this.bgPlaneZ2D = bgPlaneZ2D;
    // Data rotation (N×90° CW about camera-out axis). Lives here so the
    // camera can swap fov/aspect — the rendered viewport must match the
    // *rotated* content's aspect, otherwise a portrait-rotated landscape
    // capture into a portrait browser becomes a tiny strip.
    this._dataRotN = 0;

    const fovY = this._fovYDeg();
    this.camera = new THREE.PerspectiveCamera(fovY, this._effectiveAspect(), 0.01, 200);
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

  // ── Geometry helpers (depend on dataRotN) ────────────────────────────────

  /** image_w / image_h after N×90° rotation. Odd N → swapped W/H. */
  _rotatedDims() {
    if (this._dataRotN % 2 === 0) {
      return { w: this.meta.image_w, h: this.meta.image_h };
    }
    return { w: this.meta.image_h, h: this.meta.image_w };
  }

  /** Camera fov_y is computed from the rotated effective image height.
   *  When N is odd, the original sensor "width" becomes the new height,
   *  so we need fy_eff = fx (because rotated H = original W).
   *  Generalized: pick the focal that maps original-along-Y axis after rotation.
   */
  _fovYDeg() {
    // After rotation, the new "vertical" pixel axis maps to:
    //   N=0: original v   (length image_h, focal fy)
    //   N=1: original  u  (length image_w, focal fx)  — turned 90°
    //   N=2: original v   (length image_h, focal fy)
    //   N=3: original  u  (length image_w, focal fx)
    const odd = this._dataRotN % 2 === 1;
    const newH = odd ? this.meta.image_w : this.meta.image_h;
    const newFy = odd ? this.K.fx : this.K.fy;
    return 2 * Math.atan(newH / (2 * newFy)) * 180 / Math.PI;
  }

  _effectiveAspect() {
    const d = this._rotatedDims();
    return d.w / d.h;
  }

  _quatLookingAt(eye, target) {
    const m = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  _applyViewOffset() {
    // Principal-point offset → setViewOffset. After dataRotN CW rotations
    // about camera-out, the principal point rotates with the content. We
    // also have to rotate (cx, cy) into the rotated full-frame so the
    // setViewOffset values are expressed in the rotated coordinate system.
    //
    // Image-space pixel coords are y-down. A CW rotation about the camera
    // -Z axis (looking at the image), in pixel space, maps:
    //   (u, v) → (H − 1 − v, u)
    // Practically: (cx, cy) → (H − cy, cx)   (we drop the −1, intrinsics are float)
    const W = this.meta.image_w, H = this.meta.image_h;
    let cxR = this.K.cx, cyR = this.K.cy;
    let fullW = W, fullH = H;
    const n = ((this._dataRotN % 4) + 4) % 4;
    for (let i = 0; i < n; i++) {
      const ncx = fullH - cyR;
      const ncy = cxR;
      cxR = ncx; cyR = ncy;
      const nfW = fullH, nfH = fullW;
      fullW = nfW; fullH = nfH;
    }
    const offX = fullW / 2 - cxR;
    const offY = fullH / 2 - cyR;
    this.camera.setViewOffset(fullW, fullH, offX, offY, fullW, fullH);
  }

  /** Update intrinsics live; called by viewer when user edits the K panel. */
  setIntrinsics({ fx, fy, cx, cy }) {
    if (Number.isFinite(fx)) this.K.fx = fx;
    if (Number.isFinite(fy)) this.K.fy = fy;
    if (Number.isFinite(cx)) this.K.cx = cx;
    if (Number.isFinite(cy)) this.K.cy = cy;
    const fovY = this._fovYDeg();
    this.camera.fov = fovY;
    this._pose3D.fov = fovY;
    this._pose2D.fov = fovY;
    this.camera.aspect = this._effectiveAspect();
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Set rotation count (mod 4). Recomputes fov, aspect, view offset. */
  setDataRotation(n) {
    this._dataRotN = ((n % 4) + 4) % 4;
    const fovY = this._fovYDeg();
    this.camera.fov = fovY;
    this._pose3D.fov = fovY;
    this._pose2D.fov = fovY;
    this.camera.aspect = this._effectiveAspect();
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
  }
  getDataRotation() { return this._dataRotN; }

  /**
   * Effective image aspect after dataRotN (CW about camera-out). Used by
   * the viewer to set the canvas's CSS `aspect-ratio` — letterbox is pure
   * CSS, no setViewport/setScissor scaling involved. K stays untouched.
   */
  effectiveAspect() {
    return this._effectiveAspect();
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
   *  IMPORTANT: plane geometry is NATIVE (un-rotated) image dims. The viewer
   *  will rotate the plane mesh by N×90° CW about camera-out, which then
   *  rotates the texture into screen-aligned position. If we used the rotated
   *  aspect here AND the viewer rotated the plane, we'd double-rotate (the
   *  plane would end up landscape on screen even when camera is portrait).
   *
   *  Native plane width/height in world units = image_pixels * z / focal.
   *  Verified: 1 image pixel at world distance z covers `z/f` world units.
   */
  bgPlaneParams() {
    const W = this.meta.image_w, H = this.meta.image_h;
    const fx = this.K.fx, fy = this.K.fy;
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

  // ── Effective intrinsics (after dataRotN rotation, image-pixel coords) ────

  /** Returns the *effective* K seen by an external observer of the rotated
   *  rendered image — fx/fy swap on odd N, (cx,cy) → (H − cy, cx) per CW step.
   *  Base K (this.K) is the physical sensor's intrinsics, never changed by
   *  rotation; the panel shows base K under "2D 内参" (editable) and the
   *  derived effective K under "旋后等效 K" (read-only). */
  effectiveK() {
    const W = this.meta.image_w, H = this.meta.image_h;
    let fx = this.K.fx, fy = this.K.fy;
    let cx = this.K.cx, cy = this.K.cy;
    let fullW = W, fullH = H;
    const n = ((this._dataRotN % 4) + 4) % 4;
    for (let i = 0; i < n; i++) {
      // 1×CW about camera-out (image y-down): (u, v) → (H − v, u)
      const ncx = fullH - cy;
      const ncy = cx;
      cx = ncx; cy = ncy;
      // focals also swap (rotated image's "horizontal" was original vertical)
      const nfx = fy, nfy = fx;
      fx = nfx; fy = nfy;
      const nfW = fullH, nfH = fullW;
      fullW = nfW; fullH = nfH;
    }
    return { fx, fy, cx, cy, image_w: fullW, image_h: fullH };
  }
}
