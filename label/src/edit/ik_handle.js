// label/src/edit/ik_handle.js — IK 末端拖拽手柄(复用 TransformControls translate)。
// 与 RootHandle 结构一致,但 objectChange 时不写 root_pos,而是回调 onDrag(worldPos),
// 由上层(IKController)据此对所选末端关节做两段 IK 反解。
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class IKHandle {
  constructor({ scene, camera, canvas, controls, getMode, getStore, onDrag }) {
    this._scene = scene;       // THREE.Scene
    this._controls = controls; // OrbitControls
    this._getMode = getMode || (() => '3d');
    this._getStore = getStore;
    this._onDrag = onDrag;     // (worldPos:[x,y,z]) => void
    this._attached = false;

    // 代理对象:TransformControls 实际操纵它,我们只取它的世界坐标喂给 IK。
    this._proxy = new THREE.Object3D();

    this._tc = new TransformControls(camera, canvas);
    this._tc.setMode('translate'); // 仅平移,不需要 rotate
    this._tc.attach(this._proxy);

    // 一次拖拽 = 一个 undo 事务:按下开启、松开提交。
    this._tc.addEventListener('mouseDown', () => this._getStore().beginEdit());
    this._tc.addEventListener('objectChange', () => {
      const p = this._proxy.position;
      this._onDrag([p.x, p.y, p.z]);
    });
    this._tc.addEventListener('mouseUp', () => this._getStore().commitEdit());
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
  }

  detach() {
    if (!this._attached) return;
    this._tc.visible = false;
    this._tc.enabled = false;
    this._scene.remove(this._tc);
    this._scene.remove(this._proxy);
    this._attached = false;
  }

  update() { /* TransformControls 自动跟随相机更新 */ }

  // isEngaged:悬停或拖拽(渲染循环据此提早锁住 OrbitControls);
  // isDragging:仅真正拖拽(用于拦截模式/标签切换)。
  isEngaged() { return !!(this._tc && (this._tc.dragging || this._tc.axis != null)); }
  isDragging() { return !!(this._tc && this._tc.dragging); }
}
