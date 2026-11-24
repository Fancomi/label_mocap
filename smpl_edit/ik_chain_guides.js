import * as THREE from 'three';
import { chainsFor, writeChainPositions } from './ik_chains.js';

function guideLine(chain) {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(chain.joints.length * 3), 3);
  geometry.setAttribute('position', positions.setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.LineBasicMaterial({
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const line = new THREE.Line(geometry, material);
  line.name = chain.name;
  line.frustumCulled = false;
  line.renderOrder = 14;
  line.raycast = () => {};
  return line;
}

export class IKChainGuides {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'IK chain guides';
    this.group.visible = false;
    this.paths = [];
    scene.add(this.group);
  }

  update(skeleton, joints, selected) {
    this.group.visible = !!joints;
    if (!joints) return;
    if (this.skeleton !== skeleton) {
      this.clear();
      this.skeleton = skeleton;
      this.paths = chainsFor(skeleton).map(chain => ({ chain, line: guideLine(chain) }));
      for (const { line } of this.paths) this.group.add(line);
    }
    for (const { chain, line } of this.paths) {
      if (this.joints !== joints) {
        const positions = line.geometry.getAttribute('position');
        line.visible = writeChainPositions(positions.array, chain, joints);
        if (line.visible) positions.needsUpdate = true;
      }
      if (this.selected !== selected) {
        line.material.color.setHex(chain === selected ? 0xffd489 : 0x67e8f9);
        line.material.opacity = chain === selected ? 0.95 : 0.65;
      }
    }
    this.joints = joints;
    this.selected = selected;
  }

  clear() {
    for (const { line } of this.paths) {
      line.geometry.dispose();
      line.material.dispose();
    }
    this.group.clear();
    this.paths = [];
    this.joints = this.selected = undefined;
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
}
