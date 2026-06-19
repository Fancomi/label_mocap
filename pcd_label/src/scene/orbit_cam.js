// pcd_label/src/scene/orbit_cam.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 纯自由 orbit 相机：透视 + OrbitControls。无 2D/内参概念。
export class OrbitCam {
  constructor({ canvas }) {
    this.mode = '3d';
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(0, 2, 6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1, 0);
  }

  lookAtTarget(vec3) {
    this.controls.target.set(vec3.x, vec3.y, vec3.z);
    this.controls.update();
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update() { this.controls.update(); }
}
