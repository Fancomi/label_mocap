// label/src/edit/pose_gizmo.js — rotation gizmo for a single SMPL body joint.
//
// FIDELITY NOTE: a true local-frame edit would require the parent chain's
// world orientation to convert a world-space gizmo delta into the joint's
// local frame. That parent orientation is not cheaply available here, so this
// gizmo uses DIRECT-QUATERNION mapping: the proxy is initialized to the
// joint's current LOCAL quaternion and whatever quaternion the gizmo produces
// is written straight back as the new local quaternion. Edits are therefore
// expressed in the joint's own frame (usable, but the gizmo's on-screen axes
// do not align with the joint's posed world orientation).
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class PoseGizmo {
  constructor({ scene, camera, canvas, controls, getMode, getRotation, getStore, getJointWorldPos, onEdit }) {
    this._scene = scene;
    this._controls = controls;
    this._getMode = getMode || (() => '3d');
    this._getRotation = getRotation;
    this._getStore = getStore;
    this._getJointWorldPos = getJointWorldPos;
    this._onEdit = onEdit;
    this._attached = false;
    this._jointIndex = null;

    this._proxy = new THREE.Object3D();

    this._tc = new TransformControls(camera, canvas);
    this._tc.setMode('rotate');
    this._tc.attach(this._proxy);

    this._tc.addEventListener('dragging-changed', (e) => {
      this._controls.enabled = e.value ? false : (this._getMode() === '3d');
    });
    this._tc.addEventListener('mouseDown', () => this._getStore().beginEdit());
    this._tc.addEventListener('objectChange', () => {
      if (this._jointIndex == null) return;
      const q = this._proxy.quaternion;
      const rot = this._getRotation();
      rot.setJointQuat(this._jointIndex, [q.x, q.y, q.z, q.w]);
      this._getStore().applyFields(rot.toAxisAngle());
      this._onEdit();
    });
    this._tc.addEventListener('mouseUp', () => this._getStore().commitEdit());
  }

  attach(jointIndex, worldPos, quat) {
    this._jointIndex = jointIndex;
    if (worldPos) this._proxy.position.set(worldPos[0], worldPos[1], worldPos[2]);
    if (quat) this._proxy.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
    if (!this._attached) {
      this._scene.add(this._proxy);
      this._scene.add(this._tc);
      this._attached = true;
    }
    this._tc.visible = true;
    this._tc.enabled = true;
  }

  detach() {
    if (!this._attached) return;
    this._tc.visible = false;
    this._tc.enabled = false;
    this._scene.remove(this._tc);
    this._scene.remove(this._proxy);
    this._attached = false;
    this._jointIndex = null;
  }

  update() { /* TransformControls auto-updates against the camera */ }
}
