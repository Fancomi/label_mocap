// label/src/ui/joint_picker.js
import * as THREE from 'three';

// Raycast a pointer event against the scene's joint spheres.
// Returns the SMPL joint index (0..23) or null. onPick(smplIndex) is called on hit.
export class JointPicker {
  constructor({ canvas, camera, getJointMeshes, onPick, canPick }) {
    this._canvas = canvas;
    this._camera = camera;
    this._getJointMeshes = getJointMeshes;
    this._onPick = onPick;
    this._canPick = canPick || (() => true);
    this._ray = new THREE.Raycaster();
    this._enabled = false;
    this._handler = (e) => this._onPointerDown(e);
    canvas.addEventListener('pointerdown', this._handler);
  }

  setEnabled(v) { this._enabled = v; }

  _onPointerDown(e) {
    if (!this._enabled) return;
    if (this._canPick && !this._canPick()) return;
    const rect = this._canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this._ray.setFromCamera(ndc, this._camera);
    const meshes = this._getJointMeshes();
    const hits = this._ray.intersectObjects(meshes, false);
    if (hits.length) {
      const idx = hits[0].object.userData.jointIndex;
      if (typeof idx === 'number') this._onPick(idx);
    }
  }

  dispose() { this._canvas.removeEventListener('pointerdown', this._handler); }
}
