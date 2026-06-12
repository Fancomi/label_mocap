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
    this._bgPlane = null;
    this._pendingTex = null;
  }

  setTopology(faces) {
    // Mesh
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
    this._mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({
      color: 0xf0f0f0, side: THREE.DoubleSide,
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
      s.frustumCulled = false;
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
      this._bonesGroup.add(line);
    }
    this._scene.add(this._bonesGroup);
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
    if (!this._bgPlane) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, depthWrite: false, side: THREE.DoubleSide,
      });
      this._bgPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      this._bgPlane.renderOrder = -1;
      this._scene.add(this._bgPlane);
    }
    const p = this._cam.bgPlaneParams();
    this._bgPlane.scale.set(p.far.w, p.far.h, 1);
    this._bgPlane.position.set(0, 0, p.far.z);
    this._bgPlane.material.map = texture;
    this._bgPlane.material.needsUpdate = true;
  }

  render() {
    if (!this._cam) return;

    // Apply any deferred texture
    if (this._pendingTex) {
      this._applyBgTexture(this._pendingTex);
      this._pendingTex = null;
    }

    this._cam.update();
    this._renderer.render(this._scene, this._cam.camera);
  }
}
