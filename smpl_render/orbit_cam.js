// smpl_render/orbit_cam.js
// 纯自由 orbit 相机(pcd 用)。「上轴/前轴」只改【观察者】:相机 up 向量 + 摆位 + 环绕轴,
// 经由通用 view_frame 模块计算,绝不旋转任何几何(点云/SMPL 始终在原始数据系)。
// 与 CameraModes 差异大(无双模/tween/intrinsics/2D 缩放)，故独立类，只复用 createRenderer/
// resize 策略/view_frame，不进 CameraModes 继承树。
//
// 万向锁/拖拽偏差对策:改 up 后须让 OrbitControls 用新 up 重解 spherical，否则旧 up 残留
// → 拖拽方向错乱/伪万向锁。setFrame 里先写新 up，再写 position/target，最后 update()。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cameraPlacement } from '../smpl_edit/view_frame.js';

export class OrbitCam {
  constructor({ canvas }) {
    this.mode = '3d';
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
    this.camera.up.set(0, 0, 1); // 默认 Z-up
    this.camera.position.set(6, 0, 2);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);
    this._up = 'Z';
    this._front = 'X';
  }

  lookAtTarget(vec3) {
    this.controls.target.set(vec3.x, vec3.y, vec3.z);
    this.controls.update();
  }

  // 设定观察坐标系:up=上轴, front=朝向相机的轴。target=环绕中心, radius=点云半径。
  // 只移动相机与改 up,不触碰几何。
  setFrame(up, front, target = null, radius = null) {
    this._up = up; this._front = front;
    const tgt = target ? target.slice() : this.controls.target.toArray();
    const r = (radius && radius > 0) ? radius : (this.camera.position.distanceTo(this.controls.target) || 6);
    const place = cameraPlacement(up, front, tgt, r);
    // 先写 up，再写 position/target，最后 update() 让 OrbitControls 基于新 up 重建 spherical。
    this.camera.up.set(place.up[0], place.up[1], place.up[2]);
    this.camera.position.set(place.position[0], place.position[1], place.position[2]);
    this.controls.target.set(place.target[0], place.target[1], place.target[2]);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update() { this.controls.update(); }
}
