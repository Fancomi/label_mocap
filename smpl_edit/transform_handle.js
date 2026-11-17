// smpl_edit/transform_handle.js
// 所有 SMPL 编辑手柄(RootHandle / PoseGizmo / DragHandle)的公共基类:
// 持有 TransformControls + 代理对象,统一「世界轴/自身轴」订阅、挂载/显隐、换 active 相机、
// 指针→NDC 重映射(多视口)、屏幕尺寸缩放、悬停/拖拽判定。改 vendored TC 接口只动这里。
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { tightenTranslatePicker } from './transform_picker.js';
import { GizmoSpace } from './gizmo_space.js';

// 所有编辑手柄的基准屏幕尺寸(TransformControls size)。three 默认 1 在远景/对齐视角里过大;
// 各页面统一用这个值,再乘上视图缩放补偿(2D 放大时 1/zoom)与关节尺寸系数(手指 0.35)。
export const HANDLE_SIZE = 0.6;

export class TransformHandle {
  // mode: 初始 TC 模式('translate'|'rotate')。space: 共享的 GizmoSpace(缺省则自建,仅本手柄使用)。
  constructor({ scene, camera, canvas, mode, space }) {
    this._scene = scene;
    this._mounted = false;
    this._proxy = new THREE.Object3D(); // TC 实际操纵它;子类从中读位置/朝向写回标注
    this._tc = new TransformControls(camera, canvas);
    this._tc.setMode(mode);
    this._tc.setSize(HANDLE_SIZE);
    if (mode === 'translate') tightenTranslatePicker(this._tc); // 命中范围贴合可见几何
    this._helper = this._tc.getHelper ? this._tc.getHelper() : this._tc;
    this._gizmoSpace = space || new GizmoSpace();
    this._spaceOverride = null;
    this._tc.space = this._gizmoSpace.get();
    this._gizmoSpace.onChange((s) => { this._tc.space = this._spaceOverride ?? s; });
  }

  // 强制本手柄的参考系(如受限关节只能绕自身轴转);null = 跟随共享的世界轴/自身轴选择。
  setSpaceOverride(space) {
    this._spaceOverride = space;
    this._tc.space = space ?? this._gizmoSpace.get();
  }

  // 只显示/响应部分轴(受限关节:不能动的轴不出现,也拖不动)。三轴全开时才有屏幕环/自由旋转。
  setAxes({ x = true, y = true, z = true } = {}) {
    this._tc.showX = x; this._tc.showY = y; this._tc.showZ = z;
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
  setHandleScale(s) { if (s > 0) this._tc.setSize(HANDLE_SIZE * s); }

  // isEngaged:悬停或拖拽(渲染循环据此提早锁住 OrbitControls)。
  // isDragging:仅真正拖拽(拦截模式/标签切换);dragging 由 down/up 切换不会卡死。
  isEngaged() { return !!(this._tc.dragging || this._tc.axis != null); }
  isDragging() { return !!this._tc.dragging; }
}
