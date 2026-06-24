// smpl_edit/drag_handle.js — 通用平移拖拽手柄(TransformControls translate + 可点选标识 mesh)。
// IK 末端柄与极向量柄共用:差异仅在 marker 的外观,以及活动态是否仍显示 marker。
// 一次拖拽 = 一个 undo 事务(按下 beginEdit、松开 commitEdit);拖拽中回调 onDrag(worldPos)。
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { tightenTranslatePicker } from './transform_picker.js';

// 造一个统一风格的标识 mesh(始终可见于深度之上,便于点选)。
export function makeHandleMarker(geometry, color) {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }),
  );
  mesh.renderOrder = 999;
  return mesh;
}

export class DragHandle {
  // marker:THREE.Mesh,作占位标识与切换拾取目标(随代理移动)。
  // markerAlwaysVisible:true 则活动态也显示 marker(极向量青球作头标);false 则仅非活动显示。
  constructor({ scene, camera, canvas, getStore, onStart, onDrag, onEnd, marker, markerAlwaysVisible = false }) {
    this._scene = scene;
    this._getStore = getStore;
    this._onStart = onStart;
    this._onDrag = onDrag;
    this._onEnd = onEnd;
    this._marker = marker;
    this._markerAlwaysVisible = markerAlwaysVisible;
    this._attached = false;

    // 代理对象:TransformControls 实际操纵它,我们只取它的世界坐标喂给上层。
    this._proxy = new THREE.Object3D();
    this._proxy.add(marker);

    this._tc = new TransformControls(camera, canvas);
    this._tc.setMode('translate'); // 仅平移
    tightenTranslatePicker(this._tc); // 命中范围贴合可见几何,避免轴 picker 盖住平面方片
    this._tc.attach(this._proxy);

    this._tc.addEventListener('mouseDown', () => { this._getStore().beginEdit(); this._onStart?.(); });
    this._tc.addEventListener('objectChange', () => {
      const p = this._proxy.position;
      this._onDrag?.([p.x, p.y, p.z]);
    });
    this._tc.addEventListener('mouseUp', () => { this._onEnd?.(); this._getStore().commitEdit(); });
  }

  attach(pos) {
    if (pos) this._proxy.position.set(pos[0], pos[1], pos[2]);
    if (!this._attached) {
      this._scene.add(this._proxy);
      this._scene.add(this._tc);
      this._attached = true;
    }
    this.setActive(true); // 默认活动;上层随后据选择再 setActive(setActive 是可见性唯一权威)
  }

  detach() {
    if (!this._attached) return;
    this._tc.visible = false;
    this._tc.enabled = false;
    this._marker.visible = false;
    this._scene.remove(this._tc);
    this._scene.remove(this._proxy);
    this._attached = false;
  }

  // 活动 = 出三轴箭头;非活动 = 藏箭头并禁用、显示 marker 占位。
  // markerAlwaysVisible 时活动态也显示 marker(作头标)。
  setActive(active) {
    this._tc.visible = active;
    this._tc.enabled = active;
    this._marker.visible = this._markerAlwaysVisible || !active;
  }

  markerMesh() { return this._marker; }

  update() { /* TransformControls 自动跟随相机更新 */ }

  // isEngaged:悬停或拖拽(渲染循环据此提早锁住 OrbitControls);
  // isDragging:仅真正拖拽(用于拦截模式/标签切换)。
  isEngaged() { return !!(this._tc && (this._tc.dragging || this._tc.axis != null)); }
  isDragging() { return !!(this._tc && this._tc.dragging); }
}
