// smpl_edit/root_handle.js — translate/rotate gizmo for the SMPL root.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { tightenTranslatePicker } from './transform_picker.js';

export class RootHandle {
  constructor({ scene, camera, canvas, controls, getMode, getStore, getRotation, onEdit }) {
    this._scene = scene;       // THREE.Scene
    this._controls = controls; // OrbitControls
    this._getMode = getMode || (() => '3d');
    this._getStore = getStore;
    this._getRotation = getRotation;
    this._onEdit = onEdit;
    this._attached = false;
    this._mode = 'translate';

    this._proxy = new THREE.Object3D();

    this._tc = new TransformControls(camera, canvas);
    this._tc.setMode('translate');
    tightenTranslatePicker(this._tc); // 命中范围贴合可见几何,避免轴 picker 盖住平面方片
    this._tc.attach(this._proxy);

    this._tc.addEventListener('mouseDown', () => this._getStore().beginEdit());
    this._tc.addEventListener('objectChange', () => {
      if (this._mode === 'rotate') {
        const rot = this._getRotation && this._getRotation();
        if (!rot) return;
        const q = this._proxy.quaternion;
        rot.setRootQuat([q.x, q.y, q.z, q.w]);
        this._getStore().applyFields(rot.toAxisAngle());
      } else {
        const p = this._proxy.position;
        this._getStore().applyFields({ root_pos: [p.x, p.y, p.z] });
      }
      this._onEdit();
    });
    this._tc.addEventListener('mouseUp', () => this._getStore().commitEdit());
  }

  setMode(mode) {
    this._mode = (mode === 'rotate') ? 'rotate' : 'translate';
    this._tc.setMode(this._mode);
  }

  attach(rootPos) {
    if (rootPos) this._proxy.position.set(rootPos[0], rootPos[1], rootPos[2]);
    const rot = this._getRotation && this._getRotation();
    if (rot) {
      const q = rot.getRootQuat();
      if (q) this._proxy.quaternion.set(q[0], q[1], q[2], q[3]);
    }
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
  }

  update() { /* TransformControls auto-updates against the camera */ }

  setCamera(camera) { if (camera && this._tc) this._tc.camera = camera; }

  // 多视口:用 active 视口子矩形把指针重映射为 NDC(覆写 vendored TransformControls 的整块-canvas getPointer)。
  setNdcMapper(fn) {
    if (!this._tc) return;
    if (!fn) return;
    this._tc._getPointer = (event) => { const p = fn(event); return { x: p.x, y: p.y, button: event.button }; };
  }

  // isEngaged: hover OR drag — used by the render loop to lock orbit early.
  // isDragging: real drag only — used to block mode/tab switches. `axis` (hover)
  // can stick if a pointerleave is missed; `dragging` is toggled by down/up so
  // it never wedges, preventing a stuck hover from blocking camera switches.
  isEngaged() { return !!(this._tc && (this._tc.dragging || this._tc.axis != null)); }
  isDragging() { return !!(this._tc && this._tc.dragging); }
}
