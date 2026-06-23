// smpl_edit/pole_handle.js — 极向量拖拽手柄。
// 镜像 ik_handle.js(TransformControls translate),但额外挂一个可见小球(青色),
// 让极向量点本身可见、可点选。拖拽中回调 onDrag(worldPos),由 IKController 据此
// 做「末端锁定、仅旋转弯折平面」的反解。
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { tightenTranslatePicker } from './transform_picker.js';

export class PoleHandle {
  constructor({ scene, camera, canvas, controls, getStore, onStart, onDrag, onEnd }) {
    this._scene = scene;
    this._controls = controls;
    this._getStore = getStore;
    this._onStart = onStart;
    this._onDrag = onDrag;
    this._onEnd = onEnd;
    this._attached = false;

    // 代理对象 + 可见小球(子节点,随代理移动)。
    this._proxy = new THREE.Object3D();
    this._sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x00d0d0, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this._sphere.renderOrder = 999;
    this._proxy.add(this._sphere);

    this._tc = new TransformControls(camera, canvas);
    this._tc.setMode('translate');
    tightenTranslatePicker(this._tc);
    this._tc.attach(this._proxy);

    this._tc.addEventListener('mouseDown', () => { this._getStore().beginEdit(); if (this._onStart) this._onStart(); });
    this._tc.addEventListener('objectChange', () => {
      const p = this._proxy.position;
      this._onDrag([p.x, p.y, p.z]);
    });
    this._tc.addEventListener('mouseUp', () => { if (this._onEnd) this._onEnd(); this._getStore().commitEdit(); });
  }

  attach(pos) {
    if (pos) this._proxy.position.set(pos[0], pos[1], pos[2]);
    if (!this._attached) {
      this._scene.add(this._proxy);
      this._scene.add(this._tc);
      this._attached = true;
    }
    this._tc.visible = true;
    this._tc.enabled = true;
    this._sphere.visible = true;
  }

  detach() {
    if (!this._attached) return;
    this._tc.visible = false;
    this._tc.enabled = false;
    this._sphere.visible = false;
    this._scene.remove(this._tc);
    this._scene.remove(this._proxy);
    this._attached = false;
  }

  update() { /* TransformControls 自动跟随相机更新 */ }

  isEngaged() { return !!(this._tc && (this._tc.dragging || this._tc.axis != null)); }
  isDragging() { return !!(this._tc && this._tc.dragging); }
}
