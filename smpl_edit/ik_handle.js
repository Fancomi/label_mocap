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

    // 占位标识:非活动态显示的灰白小立方体(形状区别于极向量的球),可被点选以切回末端柄。
    this._cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.04),
      new THREE.MeshBasicMaterial({ color: 0xcccccc, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this._cube.renderOrder = 999;
    this._cube.visible = false; // 默认活动(出箭头),立方体藏起
    this._proxy.add(this._cube);

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

  // 活动 = 出三轴箭头、藏立方体;非活动 = 藏箭头并禁用、显示立方体占位。
  setActive(active) {
    this._tc.visible = active;
    this._tc.enabled = active;
    this._cube.visible = !active;
  }

  // 供插件做切换拾取:返回占位标识 mesh(立方体)。
  markerMesh() { return this._cube; }

  update() { /* TransformControls 自动跟随相机更新 */ }

  // isEngaged:悬停或拖拽(渲染循环据此提早锁住 OrbitControls);
  // isDragging:仅真正拖拽(用于拦截模式/标签切换)。
  isEngaged() { return !!(this._tc && (this._tc.dragging || this._tc.axis != null)); }
  isDragging() { return !!(this._tc && this._tc.dragging); }
}
