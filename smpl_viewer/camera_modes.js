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
    this.bgPlaneZ3D = bgPlaneZ3D;
    this.bgPlaneZ2D = bgPlaneZ2D;

    const fovY = 2 * Math.atan(meta.image_h / (2 * meta.K.fy)) * 180 / Math.PI;
    const aspect = meta.image_w / meta.image_h;
    this.camera = new THREE.PerspectiveCamera(fovY, aspect, 0.01, 200);
    this.camera.up.set(0, 1, 0);

    // Apply principal-point offset once; both modes use the same K.
    const offX = meta.image_w / 2 - meta.K.cx;
    const offY = meta.image_h / 2 - meta.K.cy;
    this.camera.setViewOffset(meta.image_w, meta.image_h, offX, offY,
                              meta.image_w, meta.image_h);

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

  _quatLookingAt(eye, target) {
    const m = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromRotationMatrix(m);
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

  /** Update the 3D OrbitControls target (call per frame to follow root joint). */
  set3DFollowTarget(vec3) {
    this._pose3D.target.copy(vec3);
    if (this.mode === '3d' && !this._tween) this.controls.target.copy(vec3);
  }

  /** Returns true while a tween is in progress. */
  isAnimating() { return this._tween !== null; }

  /** Returns 'background plane params' for the current state, used by viewer to position the bg plane. */
  bgPlaneParams() {
    const fovY = THREE.MathUtils.degToRad(this.camera.fov);
    if (this.mode === '3d') {
      // Plane in front of camera at bgPlaneZ3D, sized to fov (frustum near).
      const h = 2 * Math.tan(fovY / 2) * this.bgPlaneZ3D;
      const w = h * this.meta.image_w / this.meta.image_h;
      return { z: -this.bgPlaneZ3D, w, h, frustum_visible: true };
    } else {
      const h = 2 * Math.tan(fovY / 2) * this.bgPlaneZ2D;
      const w = h * this.meta.image_w / this.meta.image_h;
      return { z: -this.bgPlaneZ2D, w, h, frustum_visible: false };
    }
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
    }
  }
}
