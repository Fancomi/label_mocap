// pcd_label/src/scene/pcd_scene.js
import * as THREE from 'three';
import { createRenderer } from '../../../smpl_render/renderer.js';
import { applyContainerResize } from '../../../smpl_render/resize.js';
import { PointCloud } from './point_cloud.js';

const BONES = [
  [0,3,0],[3,6,0],[6,9,0],[9,12,0],[12,15,0],
  [9,13,1],[13,16,1],[16,18,1],[18,20,1],[20,22,1],
  [9,14,2],[14,17,2],[17,19,2],[19,21,2],[21,23,2],
  [0,1,3],[1,4,3],[4,7,3],[7,10,3],
  [0,2,4],[2,5,4],[5,8,4],[8,11,4],
];
const BONE_COLORS = [0xd4b800, 0x4da6ff, 0xff7733, 0x33cc66, 0xcc44cc];

export class PcdScene {
  constructor(canvas) {
    this._canvas = canvas;
    this._renderer = createRenderer({ canvas, preserveDrawingBuffer: false, clearColor: 0x05070a });

    this._scene = new THREE.Scene();
    this._scene.add(new THREE.HemisphereLight(0xddeeff, 0x223344, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.8); key.position.set(3, 5, 2);
    this._scene.add(key);
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.2));
    this._headLight = new THREE.DirectionalLight(0xffffff, 0.55);
    this._scene.add(this._headLight);
    this._scene.add(this._headLight.target);
    this._followCenter = null;

    this._cam = null;
    this._manager = null;
    this._mesh = null; this._jointsGroup = null; this._bonesGroup = null;
    this._lastJoints = null; this._personVisible = false;
    this._flags = { points: true, background: true, mesh: true, joints: true, bones: true, grid: true, axes: false };

    // 背景 loop 是【第二个独立图层】,不是像素合成 —— 与 lidar_viewer 的
    // background_cloud actor 同构。更小的点 + 半透明,压在前景之下。
    this.background = new PointCloud({ size: 1.4, opacity: 0.5 });
    this.pointCloud = new PointCloud();
    this._scene.add(this.background.object);
    this._scene.add(this.pointCloud.object);

    this._grid = new THREE.GridHelper(20, 40, 0x6695c8, 0x33455a);
    this._grid.material.opacity = 0.5; this._grid.material.transparent = true; this._scene.add(this._grid);
    this._axes = new THREE.AxesHelper(1.0); this._scene.add(this._axes);
  }

  threeScene() { return this._scene; }
  setCamera(cam) { this._cam = cam; }
  setManager(mgr) { this._manager = mgr; }

  // 地面网格朝向随「上轴」对齐(纯视觉:网格只是地平面参考,不旋转任何数据/SMPL)。
  // GridHelper 默认在 XZ 平面(法线 +Y)。Z-up → 绕 X 转 90° 使其落在 XY 平面;
  // X-up → 绕 Z 转 90°;Y-up → 不转。
  orientGroundTo(up) {
    if (!this._grid) return;
    if (up === 'Z') this._grid.rotation.set(Math.PI / 2, 0, 0);
    else if (up === 'X') this._grid.rotation.set(0, 0, Math.PI / 2);
    else this._grid.rotation.set(0, 0, 0);
  }
  jointMeshes() { return this._jointsGroup ? this._jointsGroup.children : []; }
  jointWorldPosition(j) { return this._lastJoints ? [this._lastJoints[j*3], this._lastJoints[j*3+1], this._lastJoints[j*3+2]] : [0,0,0]; }
  meshObject() { return this._mesh; }

  setSelectedJoint(smplIndex) {
    if (!this._jointsGroup) return;
    this._jointsGroup.children.forEach((s, i) => {
      const sel = (i === smplIndex);
      s.material.color.set(sel ? 0x33ff88 : 0xffffff);
      s.scale.setScalar(sel ? 1.8 : 1.0);
    });
  }

  setTopology(faces) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
    this._mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ color: 0xf2ddd0, side: THREE.DoubleSide }));
    this._mesh.frustumCulled = false; this._mesh.renderOrder = 5; this._scene.add(this._mesh);

    this._jointsGroup = new THREE.Group(); this._jointsGroup.frustumCulled = false;
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false }));
      s.userData.jointIndex = i; s.frustumCulled = false; s.renderOrder = 11;
      this._jointsGroup.add(s);
    }
    this._scene.add(this._jointsGroup);

    this._bonesGroup = new THREE.Group(); this._bonesGroup.frustumCulled = false;
    for (const [, , g] of BONES) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: BONE_COLORS[g], depthTest: false }));
      line.frustumCulled = false; line.renderOrder = 11; this._bonesGroup.add(line);
    }
    this._scene.add(this._bonesGroup);
  }

  updateMesh(vertices, joints) {
    if (!this._mesh) return;
    this._lastJoints = joints;
    const pos = this._mesh.geometry.attributes.position;
    if (!pos || pos.array.length !== vertices.length) {
      this._mesh.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices.length), 3));
    }
    this._mesh.geometry.attributes.position.array.set(vertices);
    this._mesh.geometry.attributes.position.needsUpdate = true;
    this._mesh.geometry.computeVertexNormals();
    for (let j = 0; j < 24; j++) this._jointsGroup.children[j].position.set(joints[j*3], joints[j*3+1], joints[j*3+2]);
    for (let bi = 0; bi < BONES.length; bi++) {
      const [a, b] = BONES[bi];
      this._bonesGroup.children[bi].geometry.setFromPoints([
        new THREE.Vector3(joints[a*3], joints[a*3+1], joints[a*3+2]),
        new THREE.Vector3(joints[b*3], joints[b*3+1], joints[b*3+2]),
      ]);
      this._bonesGroup.children[bi].geometry.attributes.position.needsUpdate = true;
    }
  }

  setPersonVisible(v) { this._personVisible = v; this._applyVisibility(); }
  setFlag(key, v) { this._flags[key] = v; this._applyVisibility(); }

  setMeshOpacity(v) {
    if (!this._mesh) return;
    const m = this._mesh.material;
    if (v >= 1) { m.transparent = false; m.opacity = 1; m.depthWrite = true; }
    else { m.transparent = true; m.opacity = Math.max(0.05, v); m.depthWrite = false; }
    m.needsUpdate = true;
  }

  _applyVisibility() {
    this.pointCloud.setVisible(this._flags.points);
    this.background.setVisible(this._flags.background);
    if (this._mesh) this._mesh.visible = this._flags.mesh && this._personVisible;
    if (this._jointsGroup) this._jointsGroup.visible = this._flags.joints && this._personVisible;
    if (this._bonesGroup) this._bonesGroup.visible = this._flags.bones && this._personVisible;
    if (this._grid) this._grid.visible = this._flags.grid;
    if (this._axes) this._axes.visible = this._flags.axes;
  }

  resize() {
    if (!this._cam) return;
    // 纯 3D 多视口:走内核 fill 分支(填满容器),设 backing buffer + 主 camera.aspect。
    // fill 分支不读 imageAspect(buffer=容器尺寸、aspect=cssW/cssH),传 1 占位即可。
    // 主 camera.aspect 随后被 manager.resize() 按主视口子区像素覆盖(无害);各 ortho
    // 视口 frustum 也由 manager.resize() 按子区比例重设。顺序:buffer 先,再 manager。
    const out = applyContainerResize({
      renderer: this._renderer,
      camera: this._cam.camera,
      canvas: this._canvas,
      container: this._canvas.parentElement,
      imageAspect: 1,
      effectiveMode: '3d',
    });
    if (!out) return; // 容器 0×0:布局未就绪,早退
    if (this._manager) this._manager.resize();
  }

  render() {
    this._applyVisibility();
    if (this._manager) {
      this.setLightFromCamera(this._manager.activeCamera(), this._followCenter);
      this._manager.render(this._renderer, this._scene);
      return;
    }
    if (!this._cam) return;
    this.setLightFromCamera(this._cam.camera, this._followCenter);
    this._cam.update();
    this._renderer.render(this._scene, this._cam.camera);
  }

  setFollowCenter(c) { this._followCenter = c; }
  // 头灯:光从相机方向打向人体中心,使面向相机的面受光。
  setLightFromCamera(cam, center) {
    if (!this._headLight || !cam) return;
    const c = center || [0, 0, 0];
    this._headLight.target.position.set(c[0], c[1], c[2]);
    this._headLight.position.copy(cam.position);
  }
}
