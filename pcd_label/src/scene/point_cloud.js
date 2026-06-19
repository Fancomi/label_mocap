// pcd_label/src/scene/point_cloud.js
import * as THREE from 'three';
import { turbo, normalizeRange } from './colormap.js';
import { applyMat3 } from './axis_frame.js';

// 配色模式：'height'(Z) | 'range' | 'axis'(XYZ->RGB) | 'solid'
export class PointCloud {
  constructor() {
    this._geom = new THREE.BufferGeometry();
    this._mat = new THREE.PointsMaterial({ size: 0.03, vertexColors: true, sizeAttenuation: true });
    this.object = new THREE.Points(this._geom, this._mat);
    this.object.frustumCulled = false;
    this._raw = null;
    this._mode = 'height';
    this._stride = 1;
    this._solid = [0.8, 0.85, 0.9];
  }

  setData({ positions, count }, M) {
    const disp = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const p = applyMat3(M, [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
      disp[i * 3] = p[0]; disp[i * 3 + 1] = p[1]; disp[i * 3 + 2] = p[2];
    }
    this._raw = { positions: disp, count };
    this._rebuild();
  }

  // 当前点云（显示系）的质心，用于把人/相机对到点云上。无数据时返回 null。
  centroid() {
    if (!this._raw || this._raw.count === 0) return null;
    const { positions, count } = this._raw;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < count; i++) { sx += positions[i * 3]; sy += positions[i * 3 + 1]; sz += positions[i * 3 + 2]; }
    return [sx / count, sy / count, sz / count];
  }

  setColorMode(mode) { this._mode = mode; this._rebuild(); }
  setDecimation(ratio) { this._stride = Math.max(1, Math.round(1 / Math.min(1, Math.max(0.01, ratio)))); this._rebuild(); }
  setPointSize(s) { this._mat.size = s; }
  setSolidColor(rgb) { this._solid = rgb; if (this._mode === 'solid') this._rebuild(); }

  _rebuild() {
    if (!this._raw) return;
    const { positions, count } = this._raw;
    const stride = this._stride;
    const kept = Math.ceil(count / stride);
    const pos = new Float32Array(kept * 3);
    const col = new Float32Array(kept * 3);
    let zmin = Infinity, zmax = -Infinity, rmax = 0;
    for (let i = 0; i < count; i += stride) {
      const y = positions[i * 3 + 1];
      if (y < zmin) zmin = y; if (y > zmax) zmax = y;
      const r = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      if (r > rmax) rmax = r;
    }
    let k = 0;
    for (let i = 0; i < count; i += stride) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      let c;
      if (this._mode === 'height') c = turbo(normalizeRange(y, zmin, zmax));
      else if (this._mode === 'range') c = turbo(normalizeRange(Math.hypot(x, y, z), 0, rmax || 1));
      else if (this._mode === 'axis') c = [normalizeRange(x, -10, 10), normalizeRange(y, -10, 10), normalizeRange(z, -10, 10)];
      else c = this._solid;
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
      k++;
    }
    this._geom.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
    this._geom.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, k * 3), 3));
    this._geom.attributes.position.needsUpdate = true;
    this._geom.attributes.color.needsUpdate = true;
  }

  setVisible(v) { this.object.visible = v; }
  dispose() { this._geom.dispose(); this._mat.dispose(); }
}
