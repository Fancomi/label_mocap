// smpl_edit/ik_handle.js — IK 末端拖拽手柄(复用 TransformControls translate)。
// 与 RootHandle 结构一致,但 objectChange 时不写 root_pos,而是回调 onDrag(worldPos),
// 由上层(IKController)据此对所选末端关节做两段 IK 反解。
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { tightenTranslatePicker } from './transform_picker.js';

export class IKHandle {
  constructor({ scene, camera, canvas, controls, getMode, getStore, onStart, onDrag, onEnd }) {
    this._scene = scene;       // THREE.Scene
    this._controls = controls; // OrbitControls
    this._getMode = getMode || (() => '3d');
    this._getStore = getStore;
    this._onStart = onStart;   // () => void —— 拖拽起始,冻结 IK 参考
    this._onDrag = onDrag;     // (worldPos:[x,y,z]) => void
    this._onEnd = onEnd;       // () => void —— 拖拽结束,清 IK 参考
    this._attached = false;

    // 代理对象:TransformControls 实际操纵它,我们只取它的世界坐标喂给 IK。
    this._proxy = new THREE.Object3D();

    this._tc = new TransformControls(camera, canvas);
    this._tc.setMode('translate'); // 仅平移,不需要 rotate
    tightenTranslatePicker(this._tc); // 命中范围贴合可见几何,避免轴 picker 盖住平面方片
    this._tc.attach(this._proxy);

    // 一次拖拽 = 一个 undo 事务:按下开启事务并冻结 IK 参考、松开提交并清参考。
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
