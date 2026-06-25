// smpl_edit/pose_gizmo.js
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { worldGizmoFromLocal, localFromWorldGizmo } from './gizmo_frame.js';

// Per-joint rotation gizmo. Displays at the joint's WORLD orientation and maps
// drags back to the joint LOCAL quaternion using the parent world rotation, so
// the on-screen rings align with what the user sees and edits don't jump.
export class PoseGizmo {
  constructor({ scene, camera, canvas, controls, getMode, getRotation, getStore, onEdit }) {
    this._scene = scene;
    this._getMode = getMode;
    this._getRotation = getRotation;
    this._getStore = getStore;
    this._onEdit = onEdit;
    this._jointBody = null;       // body-pose index (0..20)
    this._qParentWorld = [0, 0, 0, 1];
    this._proxy = new THREE.Object3D();
    this._scene.add(this._proxy);
    this._tc = new TransformControls(camera, canvas);
    this._tc.setMode('rotate');
    this._tc.setSpace('local');
    this._tc.addEventListener('dragging-changed', (e) => {
      if (e.value) this._getStore().beginEdit();
      else this._getStore().commitEdit();
    });
    this._tc.addEventListener('objectChange', () => this._onDrag());
    this._helper = this._tc.getHelper ? this._tc.getHelper() : this._tc;
    this._scene.add(this._helper);
    this.detach();
  }

  // 场景中由本 gizmo add 的对象(供 ViewportManager 注册为仅 active 视口可见)。
  sceneObjects() { return [this._proxy, this._helper]; }

  // qParentWorld: [x,y,z,w] parent joint world rotation. worldPos: [x,y,z].
  attach(jointBody, worldPos, qParentWorld) {
    this._jointBody = jointBody;
    this._qParentWorld = qParentWorld;
    const qLocal = this._getRotation().getJointQuat(jointBody);
    const qWorld = worldGizmoFromLocal(qParentWorld, qLocal);
    this._proxy.position.set(worldPos[0], worldPos[1], worldPos[2]);
    this._proxy.quaternion.set(qWorld[0], qWorld[1], qWorld[2], qWorld[3]);
    this._proxy.updateMatrixWorld(true);
    this._tc.attach(this._proxy);
    this._setVisible(true);
  }

  detach() {
    if (this._tc.object) this._tc.detach();
    this._setVisible(false);
    this._jointBody = null;
  }

  isEngaged() { return !!(this._tc && (this._tc.dragging || this._tc.axis != null)); }
  isDragging() { return !!(this._tc && this._tc.dragging); }

  setCamera(camera) { if (camera && this._tc) this._tc.camera = camera; }

  // 手柄屏幕尺寸缩放(label 2D setViewOffset 假缩放下,TC size 公式不吃 viewOffset,
  // 需按 1/zoom 反向缩放抵消)。s 直接喂 TransformControls.size。
  setHandleScale(s) { if (this._tc && s > 0) this._tc.setSize(s); }

  // 多视口:用 active 视口子矩形把指针重映射为 NDC(覆写 vendored TransformControls 的整块-canvas getPointer)。
  setNdcMapper(fn) {
    if (!this._tc) return;
    if (!fn) return;
    this._tc._getPointer = (event) => { const p = fn(event); return { x: p.x, y: p.y, button: event.button }; };
  }

  _setVisible(v) {
    const helper = this._tc.getHelper ? this._tc.getHelper() : this._tc;
    helper.visible = v;
    if (this._tc.enabled !== undefined) this._tc.enabled = v;
  }

  _onDrag() {
    if (this._jointBody === null) return;
    const q = this._proxy.quaternion;
    const qWorld = [q.x, q.y, q.z, q.w];
    const qLocal = localFromWorldGizmo(this._qParentWorld, qWorld);
    this._getRotation().setJointQuat(this._jointBody, qLocal);
    this._getStore().applyFields(this._getRotation().toAxisAngle());
    this._onEdit();
  }
}
