// smpl_edit/transform_handle.js
// 所有 SMPL 编辑手柄(RootHandle / PoseGizmo / DragHandle)的公共基类:
// 持有 TransformControls + 代理对象,统一「世界轴/自身轴」订阅、挂载/显隐、换 active 相机、
// 指针→NDC 重映射(多视口)、屏幕尺寸缩放、悬停/拖拽判定。改 vendored TC 接口只动这里。
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { tightenTranslatePicker } from './transform_picker.js';
import { GizmoSpace } from './gizmo_space.js';

export class TransformHandle {
  // mode: 初始 TC 模式('translate'|'rotate')。space: 共享的 GizmoSpace(缺省则自建,仅本手柄使用)。
  constructor({ scene, camera, canvas, mode, space }) {
    this._scene = scene;
    this._mounted = false;
    this._proxy = new THREE.Object3D(); // TC 实际操纵它;子类从中读位置/朝向写回标注
    this._tc = new TransformControls(camera, canvas);
    this._tc.setMode(mode);
    if (mode === 'translate') tightenTranslatePicker(this._tc); // 命中范围贴合可见几何
    this._helper = this._tc.getHelper ? this._tc.getHelper() : this._tc;
    const gizmoSpace = space || new GizmoSpace();
    this._tc.space = gizmoSpace.get();
    gizmoSpace.onChange((s) => { this._tc.space = s; });
  }

  // 手柄朝向 [x,y,z,w];「自身轴」下手柄的三轴/旋转环跟随它,「世界轴」下不受影响。
  setOrientation(q) {
    if (q) this._proxy.quaternion.set(q[0], q[1], q[2], q[3]);
    else this._proxy.quaternion.identity();
    this._proxy.updateMatrixWorld(true);
  }

  _mount() {
    if (this._mounted) return;
    this._scene.add(this._proxy);
    this._scene.add(this._helper);
    this._mounted = true;
  }

  _unmount() {
    if (!this._mounted) return;
    this._scene.remove(this._helper);
    this._scene.remove(this._proxy);
    this._mounted = false;
  }

  // 出/收 TC 手柄。detach 同时清 TC 的悬停轴,避免漏收 pointerleave 后残留。
  _setTcActive(on) {
    if (on) {
      if (!this._tc.object) this._tc.attach(this._proxy);
      this._helper.visible = true;
      this._tc.enabled = true;
    } else {
      if (this._tc.object) this._tc.detach();
      this._helper.visible = false;
      this._tc.enabled = false;
    }
  }

  // 场景中由本手柄 add 的对象(供 ViewportManager 注册为仅 active 视口可见)。
  sceneObjects() { return [this._proxy, this._helper]; }

  update() { /* TransformControls 自动跟随相机更新 */ }

  setCamera(camera) { if (camera) this._tc.camera = camera; }

  // 多视口:覆写 tc 的整块-canvas getPointer,改用 fn(event)→{x,y} 给出的 active 视口子矩形 NDC。
  setNdcMapper(fn) {
    if (!fn) return;
    this._tc._getPointer = (event) => { const p = fn(event); return { x: p.x, y: p.y, button: event.button }; };
  }

  // label 2D setViewOffset 假缩放下,按 1/zoom 反向抵消手柄屏幕尺寸。
  setHandleScale(s) { if (s > 0) this._tc.setSize(s); }

  // isEngaged:悬停或拖拽(渲染循环据此提早锁住 OrbitControls)。
  // isDragging:仅真正拖拽(拦截模式/标签切换);dragging 由 down/up 切换不会卡死。
  isEngaged() { return !!(this._tc.dragging || this._tc.axis != null); }
  isDragging() { return !!this._tc.dragging; }
}
