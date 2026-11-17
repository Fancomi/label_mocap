// label_mocap/label/src/scene/scene.js
import * as THREE from 'three';
import { createRenderer } from '../../../smpl_render/renderer.js';
import { applyContainerResize } from '../../../smpl_render/resize.js';

// 骨骼表 / 显示关节来自 BodyModel(smpl_core/body_model.js),本文件不写死任何骨架。
const BONE_COLORS = [0xd4b800, 0x4da6ff, 0xff7733, 0x33cc66, 0xcc44cc];

export class LabelScene {
  constructor(canvas) {
    this._canvas = canvas;
    this._renderer = createRenderer({ canvas });

    this._scene = new THREE.Scene();
    this._scene.add(new THREE.HemisphereLight(0xddeeff, 0x223344, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(3, 5, -2);
    this._scene.add(key);
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.15));
    this._headLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this._scene.add(this._headLight);
    this._scene.add(this._headLight.target);
    this._followCenter = null;

    this._cam = null;
    this._mesh = null;
    this._jointsGroup = null;
    this._bonesGroup = null;
    this._pendingTex = null;
    this._frustum = null;
    this._grid = null;
    this._axes = null;
    this._bgNear = null;
    this._bgFar = null;
    this._bgTex = null;
    this._gridSize = 20;
    this._gridStep = 0.5;
    this._flags = { mesh: true, points: true, bones: true, grid: true, axes: false, bg: true };
    this._personVisible = true;
    this._lastJoints = null;
    this._bones = [];
    this._displayJoints = [];
    // 数据相机挂点:背景平面与视锥都在数据相机系里建,随相机位姿(多相机/转正)整体摆放。
    // 单视角旧数据相机在原点 → 恒等,行为同前。
    this._dataCam = new THREE.Group();
    this._scene.add(this._dataCam);
    this._bgRotationDeg = 0;
  }

  // 数据相机位姿 + 背景显示旋转(顺时针度数,来自 cameras[].view_rotation_deg)。
  setDataCamera({ position, quaternion }, rotationDeg = 0) {
    this._dataCam.position.copy(position);
    this._dataCam.quaternion.copy(quaternion);
    this._bgRotationDeg = rotationDeg;
    if (this._bgTex) this._applyBgTexture(this._bgTex);
  }

  // The underlying THREE.Scene — gizmos attach their proxy objects here.
  threeScene() { return this._scene; }
  // 宿主自行分区渲染(多视图,如 mhr_label 的 ViewHub)时用。
  renderer() { return this._renderer; }

  // 关节球(userData.jointIndex = 骨架关节索引),供 JointPicker 射线拾取。
  jointMeshes() {
    return this._jointsGroup ? this._jointsGroup.children : [];
  }

  jointWorldPosition(j) {
    if (!this._lastJoints) return [0, 0, 0];
    return [this._lastJoints[j * 3], this._lastJoints[j * 3 + 1], this._lastJoints[j * 3 + 2]];
  }

  // The posed mesh object (THREE.Mesh) for raycasting/occlusion, or null.
  meshObject() { return this._mesh; }

  // Highlight the selected joint sphere (skeleton index). Pass -1 to clear.
  setSelectedJoint(jointIndex) {
    if (!this._jointsGroup) return;
    this._jointsGroup.children.forEach((s) => {
      const sel = (s.userData.jointIndex === jointIndex);
      s.material.color.set(sel ? 0x33ff88 : 0xffffff);
      s.scale.setScalar(sel ? 1.8 : 1.0);
    });
  }

  buildFrustum(meta) {
    if (this._frustum) {
      this._dataCam.remove(this._frustum);
      this._frustum.geometry.dispose();
      this._frustum.material.dispose();
    }
    const fovY = 2 * Math.atan(meta.image_h / (2 * meta.K.fy));
    const aspect = meta.image_w / meta.image_h;
    const d = 2.0;
    const h = 2 * Math.tan(fovY / 2) * d;
    const w = h * aspect;
    const c = [
      new THREE.Vector3(w / 2, h / 2, -d), new THREE.Vector3(-w / 2, h / 2, -d),
      new THREE.Vector3(-w / 2, -h / 2, -d), new THREE.Vector3(w / 2, -h / 2, -d),
    ];
    const O = new THREE.Vector3();
    const segs = [O, c[0], O, c[1], O, c[2], O, c[3], c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]];
    const geom = new THREE.BufferGeometry().setFromPoints(segs);
    this._frustum = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: 0x66aaff }));
    this._frustum.frustumCulled = false;
    this._dataCam.add(this._frustum);
  }

  buildGrid() {
    if (this._grid) {
      this._scene.remove(this._grid);
      this._grid.geometry.dispose();
      this._grid.material.dispose();
    }
    const divisions = Math.max(2, Math.round(this._gridSize / this._gridStep));
    this._grid = new THREE.GridHelper(this._gridSize, divisions, 0x6695c8, 0x4a6080);
    this._grid.position.y = -1.0;
    this._grid.material.opacity = 0.85;
    this._grid.material.transparent = true;
    this._grid.material.depthWrite = false;
    this._scene.add(this._grid);
    if (!this._axes) {
      this._axes = new THREE.AxesHelper(0.5);
      this._scene.add(this._axes);
    }
  }

  setGrid(size, step) {
    if (Number.isFinite(size) && size > 0) this._gridSize = size;
    if (Number.isFinite(step) && step > 0) this._gridStep = step;
    this.buildGrid();
    this._applyVisibility();
  }

  setFlag(key, value) { this._flags[key] = value; this._applyVisibility(); }

  setMeshOpacity(v) {
    if (!this._mesh) return;
    const m = this._mesh.material;
    if (v >= 1) { m.transparent = false; m.opacity = 1; m.depthWrite = true; }
    else { m.transparent = true; m.opacity = Math.max(0.05, v); m.depthWrite = false; }
    m.needsUpdate = true;
  }

  // Person-visibility gate independent of display flags. Hides the posed
  // mesh/joints/bones for empty frames (e.g. after deleting an annotation).
  setPersonVisible(v) { this._personVisible = v; this._applyVisibility(); }

  _applyVisibility() {
    const is3d = !!(this._cam && this._cam.mode === '3d');   // 无相机(宿主自管渲染)时为 false;Object3D.visible 只认 === false
    if (this._mesh) this._mesh.visible = this._flags.mesh && this._personVisible;
    if (this._jointsGroup) this._jointsGroup.visible = this._flags.points && this._personVisible;
    if (this._bonesGroup) this._bonesGroup.visible = this._flags.bones && this._personVisible;
    if (this._grid) this._grid.visible = this._flags.grid && is3d;
    if (this._axes) this._axes.visible = this._flags.axes && is3d;
    // 没有底图(该帧无画面 / 加载失败)时整块隐藏,而不是显示一块白色平面。
    if (this._bgFar) this._bgFar.visible = this._flags.bg && !!this._bgTex;
    if (this._bgNear) this._bgNear.visible = this._flags.bg && is3d && !!this._bgTex;
    if (this._frustum) this._frustum.visible = is3d;
  }

  prepareForSequence(meta) {
    this.buildFrustum(meta);
    this._applyVisibility();
  }

  // 换人体模型(或首次装载)时调用:body = BodyModel。旧网格/关节/骨骼整体替换。
  setBody(body) {
    for (const obj of [this._mesh, this._jointsGroup, this._bonesGroup]) {
      if (!obj) continue;
      this._scene.remove(obj);
      obj.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    }
    const faces = body.faces;
    this._bones = body.bones;
    this._displayJoints = body.displayJoints;
    this._lastJoints = null;
    // Mesh
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
    this._mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({
      color: 0xfafafa, side: THREE.DoubleSide, transparent: false, opacity: 1, depthWrite: true,
    }));
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder = 5;
    this._scene.add(this._mesh);

    // Joint spheres
    this._jointsGroup = new THREE.Group();
    this._jointsGroup.frustumCulled = false;
    for (const i of this._displayJoints) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.025 * (body.jointScale?.(i) ?? 1), 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false }));
      s.userData.jointIndex = i;
      s.frustumCulled = false;
      s.renderOrder = 11;
      this._jointsGroup.add(s);
    }
    this._scene.add(this._jointsGroup);

    // Bone line segments
    this._bonesGroup = new THREE.Group();
    this._bonesGroup.frustumCulled = false;
    for (const [, , g] of this._bones) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: BONE_COLORS[g], depthTest: false }));
      line.frustumCulled = false;
      line.renderOrder = 11;
      this._bonesGroup.add(line);
    }
    this._scene.add(this._bonesGroup);
    if (!this._grid) this.buildGrid();
    this._applyVisibility();
  }

  setCamera(cameraModes) {
    this._cam = cameraModes;
  }

  // Fit the canvas/renderer to the parent container via the shared resize
  // kernel. effectiveMode comes from the camera's intended mode:
  //   '2d'  → letterbox buffer + image aspect (背景对齐看图，无变形)
  //   其余   → fill buffer + container aspect (3D 自由视野跟容器，修了 letterbox bug)
  resize() {
    if (!this._cam) return;
    applyContainerResize({
      renderer: this._renderer,
      camera: this._cam.camera,
      canvas: this._canvas,
      container: this._canvas.parentElement,
      imageAspect: this._cam.effectiveAspect(),
      effectiveMode: this._cam.intendedMode(),
    });
  }

  updateMesh(vertices, joints) {
    if (!this._mesh) return;
    this._lastJoints = joints;

    // Resize position buffer if needed (first call)
    const needed = vertices.length;
    if (this._mesh.geometry.attributes.position.array.length !== needed) {
      this._mesh.geometry.setAttribute('position',
        new THREE.BufferAttribute(new Float32Array(needed), 3));
    }

    // Write vertices straight through
    const pos = this._mesh.geometry.attributes.position;
    pos.array.set(vertices);
    pos.needsUpdate = true;
    this._mesh.geometry.computeVertexNormals();
    this._mesh.geometry.computeBoundingSphere();   // 点选人体网格(JointPicker.onPickBody)要用最新包围球
    this._mesh.geometry.computeBoundingBox();

    // Joint positions
    for (const s of this._jointsGroup.children) {
      const j = s.userData.jointIndex;
      s.position.set(joints[j * 3], joints[j * 3 + 1], joints[j * 3 + 2]);
    }

    // Bone endpoints
    for (let bi = 0; bi < this._bones.length; bi++) {
      const [a, b] = this._bones[bi];
      const line = this._bonesGroup.children[bi];
      line.geometry.setFromPoints([
        new THREE.Vector3(joints[a * 3], joints[a * 3 + 1], joints[a * 3 + 2]),
        new THREE.Vector3(joints[b * 3], joints[b * 3 + 1], joints[b * 3 + 2]),
      ]);
      line.geometry.attributes.position.needsUpdate = true;
    }
  }

  setBackgroundTexture(texture) {
    if (!texture) {
      // 清屏:清掉背景面的贴图(加载失败/空数据集复位)。_applyVisibility 每帧按 _flags.bg
      // 重设 .visible,故这里清 material.map 而非只设 visible,避免旧底图残留。
      this._pendingTex = null;
      this._bgTex = null;
      for (const plane of [this._bgFar, this._bgNear]) {
        if (plane) { plane.material.map = null; plane.material.needsUpdate = true; }
      }
      return;
    }
    if (!this._cam) {
      // Defer until render() when cam is available
      this._pendingTex = texture;
      return;
    }
    this._applyBgTexture(texture);
  }

  _applyBgTexture(texture) {
    const p = this._cam.bgPlaneParams();
    if (!this._bgFar) {
      const mk = () => new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, side: THREE.DoubleSide }));
      this._bgFar = mk(); this._bgFar.renderOrder = -1; this._dataCam.add(this._bgFar);
      this._bgNear = mk(); this._bgNear.renderOrder = 0; this._dataCam.add(this._bgNear);
    }
    this._bgFar.geometry.dispose();
    this._bgFar.geometry = new THREE.PlaneGeometry(p.far.w, p.far.h);
    this._bgFar.position.set(0, 0, p.far.z);
    this._bgNear.geometry.dispose();
    this._bgNear.geometry = new THREE.PlaneGeometry(p.near.w, p.near.h);
    this._bgNear.position.set(0, 0, p.near.z);
    // 放大看细节:LinearFilter + 关 mipmap 直采原图最清晰。纹理对象共享,设一次即可。
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    // 原生帧按显示配置整幅旋转(顺时针 deg)。three 的 texture.rotation 正值 = UV 逆时针,
    // 画面随之逆时针 → 顺时针显示取负。
    texture.center.set(0.5, 0.5);
    texture.rotation = -this._bgRotationDeg * Math.PI / 180;
    texture.needsUpdate = true;
    for (const plane of [this._bgFar, this._bgNear]) {
      plane.material.map = texture;
      plane.material.needsUpdate = true;
    }
    this._bgTex = texture;
    this._applyVisibility();
  }

  render() {
    if (!this._cam) return;

    // Apply any deferred texture
    if (this._pendingTex) {
      this._applyBgTexture(this._pendingTex);
      this._pendingTex = null;
    }

    this._applyVisibility();
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
