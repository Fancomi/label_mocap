// label_mocap/label/src/scene/scene.js
import * as THREE from 'three';

const BONES = [
  [0,3,0],[3,6,0],[6,9,0],[9,12,0],[12,15,0],
  [9,13,1],[13,16,1],[16,18,1],[18,20,1],[20,22,1],
  [9,14,2],[14,17,2],[17,19,2],[19,21,2],[21,23,2],
  [0,1,3],[1,4,3],[4,7,3],[7,10,3],
  [0,2,4],[2,5,4],[5,8,4],[8,11,4],
];
const BONE_COLORS = [0xd4b800, 0x4da6ff, 0xff7733, 0x33cc66, 0xcc44cc];

export class LabelScene {
  constructor(canvas) {
    this._canvas = canvas;
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._renderer.setClearColor(0x0f1216, 1);
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;

    this._scene = new THREE.Scene();
    this._scene.add(new THREE.HemisphereLight(0xddeeff, 0x223344, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(3, 5, -2);
    this._scene.add(key);
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.15));

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
    this._lastJoints = null;
  }

  // The underlying THREE.Scene — gizmos attach their proxy objects here.
  threeScene() { return this._scene; }

  // World position [x,y,z] of SMPL joint j from the last posed joints buffer.
  jointMeshes() {
    return this._jointsGroup ? this._jointsGroup.children : [];
  }

  jointWorldPosition(j) {
    if (!this._lastJoints) return [0, 0, 0];
    return [this._lastJoints[j * 3], this._lastJoints[j * 3 + 1], this._lastJoints[j * 3 + 2]];
  }

  // The posed mesh object (THREE.Mesh) for raycasting/occlusion, or null.
  meshObject() { return this._mesh; }

  // Highlight the selected joint sphere (SMPL index). Pass -1 to clear.
  setSelectedJoint(smplIndex) {
    if (!this._jointsGroup) return;
    this._jointsGroup.children.forEach((s, i) => {
      const sel = (i === smplIndex);
      s.material.color.set(sel ? 0x33ff88 : 0xffffff);
      s.scale.setScalar(sel ? 1.8 : 1.0);
    });
  }

  buildFrustum(meta) {
    if (this._frustum) {
      this._scene.remove(this._frustum);
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
    this._scene.add(this._frustum);
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

  _applyVisibility() {
    const is3d = this._cam && this._cam.mode === '3d';
    if (this._mesh) this._mesh.visible = this._flags.mesh;
    if (this._jointsGroup) this._jointsGroup.visible = this._flags.points;
    if (this._bonesGroup) this._bonesGroup.visible = this._flags.bones;
    if (this._grid) this._grid.visible = this._flags.grid && is3d;
    if (this._axes) this._axes.visible = this._flags.axes && is3d;
    if (this._bgFar) this._bgFar.visible = this._flags.bg;
    if (this._bgNear) this._bgNear.visible = this._flags.bg && is3d;
    if (this._frustum) this._frustum.visible = is3d;
  }

  prepareForSequence(meta) {
    this.buildFrustum(meta);
    this._applyVisibility();
  }

  setTopology(faces) {
    // Mesh
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
    this._mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({
      color: 0xf0f0f0, side: THREE.DoubleSide, transparent: false, opacity: 1, depthWrite: true,
    }));
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder = 5;
    this._scene.add(this._mesh);

    // Joint spheres
    this._jointsGroup = new THREE.Group();
    this._jointsGroup.frustumCulled = false;
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 8, 6),
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
    for (const [, , g] of BONES) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: BONE_COLORS[g], depthTest: false }));
      line.frustumCulled = false;
      line.renderOrder = 11;
      this._bonesGroup.add(line);
    }
    this._scene.add(this._bonesGroup);
    this.buildGrid();
  }

  setCamera(cameraModes) {
    this._cam = cameraModes;
  }

  // Fit the canvas/renderer to the parent container while matching the
  // camera's image aspect (letterboxed). Called on load and window resize.
  resize() {
    if (!this._cam) return;
    const parent = this._canvas.parentElement;
    const cw = parent.clientWidth;
    const ch = parent.clientHeight;
    if (cw <= 0 || ch <= 0) return;

    const targetAspect = this._cam.effectiveAspect();
    const containerAspect = cw / ch;
    let w;
    let h;
    if (containerAspect > targetAspect) {
      h = ch;
      w = Math.round(h * targetAspect);
    } else {
      w = cw;
      h = Math.round(w / targetAspect);
    }
    this._canvas.style.width = `${w}px`;
    this._canvas.style.height = `${h}px`;
    this._renderer.setSize(w, h, false);
    this._cam.camera.aspect = w / h;
    this._cam.camera.updateProjectionMatrix();
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

    // Joint positions
    for (let j = 0; j < 24; j++) {
      this._jointsGroup.children[j].position.set(
        joints[j * 3], joints[j * 3 + 1], joints[j * 3 + 2]);
    }

    // Bone endpoints
    for (let bi = 0; bi < BONES.length; bi++) {
      const [a, b] = BONES[bi];
      const line = this._bonesGroup.children[bi];
      line.geometry.setFromPoints([
        new THREE.Vector3(joints[a * 3], joints[a * 3 + 1], joints[a * 3 + 2]),
        new THREE.Vector3(joints[b * 3], joints[b * 3 + 1], joints[b * 3 + 2]),
      ]);
      line.geometry.attributes.position.needsUpdate = true;
    }
  }

  setBackgroundTexture(texture) {
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
      this._bgFar = mk(); this._bgFar.renderOrder = -1; this._scene.add(this._bgFar);
      this._bgNear = mk(); this._bgNear.renderOrder = 0; this._scene.add(this._bgNear);
    }
    this._bgFar.geometry.dispose();
    this._bgFar.geometry = new THREE.PlaneGeometry(p.far.w, p.far.h);
    this._bgFar.position.set(0, 0, p.far.z);
    this._bgNear.geometry.dispose();
    this._bgNear.geometry = new THREE.PlaneGeometry(p.near.w, p.near.h);
    this._bgNear.position.set(0, 0, p.near.z);
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
    this._cam.update();
    this._renderer.render(this._scene, this._cam.camera);
  }
}
