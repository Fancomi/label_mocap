import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { verticalFovDeg, viewOffsetForCamera } from './camera_modes.js';

function copyToPositionAttribute(geometry, values, itemSize) {
  const current = geometry.getAttribute('position');
  if (!current || current.array.length !== values.length) {
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(values.length), itemSize)
    );
  }

  const attr = geometry.getAttribute('position');
  attr.array.set(values);
  attr.needsUpdate = true;
  return attr;
}

export class SmplScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x101418, 1);
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101418);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    this.camera.position.set(0, 1.2, 5);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0.9, 0);

    this.mesh = null;
    this.points = null;

    this.addLights();
    this.resize();
    globalThis.addEventListener('resize', () => this.resize());
  }

  addLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x27313a, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 4, 5);
    this.scene.add(key);
  }

  setTopology(faces) {
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));

    const material = new THREE.MeshStandardMaterial({
      color: 0x54d6ff,
      metalness: 0.05,
      roughness: 0.65,
      wireframe: true,
    });

    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }

    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);

    if (!this.points) {
      const pointGeom = new THREE.BufferGeometry();
      const pointMat = new THREE.PointsMaterial({
        color: 0xffd166,
        size: 0.035,
        sizeAttenuation: true,
      });
      this.points = new THREE.Points(pointGeom, pointMat);
      this.scene.add(this.points);
    }
  }

  updateFrame(vertices, joints) {
    if (!this.mesh || !this.points) {
      return;
    }

    copyToPositionAttribute(this.mesh.geometry, vertices, 3);
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();

    copyToPositionAttribute(this.points.geometry, joints, 3);
    this.points.geometry.computeBoundingSphere();
  }

  configure2DCamera(sequence) {
    if (!sequence?.image || !sequence?.camera) {
      return;
    }

    const { image, camera } = sequence;
    const view = viewOffsetForCamera(image.width, image.height, camera);

    this.camera.fov = verticalFovDeg(image.height, camera.fy);
    this.camera.aspect = image.width / image.height;
    this.camera.setViewOffset(
      view.fullWidth,
      view.fullHeight,
      view.x,
      view.y,
      view.width,
      view.height
    );
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);
    this.camera.updateProjectionMatrix();

    this.controls.target.set(0, 0, -1);
    this.controls.update();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(width, height, false);
    if (!this.camera.view?.enabled) {
      this.camera.aspect = width / height;
    }
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
