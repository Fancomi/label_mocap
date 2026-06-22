// pcd_label/src/scene/orbit_cam.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const UNIT = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

// 纯自由 orbit 相机：透视 + OrbitControls。无 2D/内参概念。
// 「上轴/前轴」只改相机：设置相机 up 向量 + 环绕起始方位，几何(点云/SMPL)绝不旋转。
export class OrbitCam {
  constructor({ canvas }) {
    this.mode = '3d';
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 1000);
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

  // 设定观察坐标系:up=上轴, front=朝向相机的轴。target/radius 决定环绕中心与距离。
  // 仅移动相机与改 up 向量,不触碰任何几何。
  setFrame(up, front, target = null, radius = null) {
    this._up = up; this._front = front;
    const u = UNIT[up], f = UNIT[front];
    const t = target ? new THREE.Vector3(target[0], target[1], target[2]) : this.controls.target.clone();
    const r = (radius && radius > 0) ? radius : this.camera.position.distanceTo(this.controls.target) || 6;
    this.camera.up.set(u[0], u[1], u[2]);
    // 相机放在 target 沿 +front 退开,并沿 +up 略微抬高,得到 3/4 俯视。
    const dist = r * 2.2 + 1;
    this.camera.position.set(
      t.x + f[0] * dist + u[0] * dist * 0.35,
      t.y + f[1] * dist + u[1] * dist * 0.35,
      t.z + f[2] * dist + u[2] * dist * 0.35,
    );
    this.controls.target.copy(t);
    this.camera.lookAt(t);
    this.controls.update();
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update() { this.controls.update(); }
}
