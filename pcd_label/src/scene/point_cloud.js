// pcd_label/src/scene/point_cloud.js
import * as THREE from 'three';
import { turbo, normalizeRange } from './colormap.js';

// 配色模式：'height' | 'range' | 'axis'(XYZ->RGB) | 'solid'
// 点云存的是【原始数据系】坐标，不施加任何旋转——坐标轴(上/前)只改相机，几何不动。
export class PointCloud {
  constructor() {
    this._geom = new THREE.BufferGeometry();
    // sizeAttenuation:false → 屏幕像素恒定大小,不随 scissor 子视口高度错算(三视口一致)。
    this._mat = new THREE.PointsMaterial({ size: 3, vertexColors: true, sizeAttenuation: false });
    this.object = new THREE.Points(this._geom, this._mat);
    this.object.frustumCulled = false;
    this._raw = null;
    this._mode = 'height';
    this._stride = 1;
    this._solid = [0.8, 0.85, 0.9];
    this._heightAxis = 2; // 高度配色取哪一轴分量(默认 Z = LiDAR 上轴)
  }

  // 直接存原始数据系坐标，不做基变换。
  setData({ positions, count }) {
    this._raw = { positions, count };
    this._rebuild();
  }

  // 当前点云质心(原始系)，用于把人/相机对到点云上。无数据返回 null。
  centroid() {
    const b = this.bounds();
    return b ? b.center : null;
  }

  // 质心 + 包围半径,用于相机自动取景。无数据返回 null。
  bounds() {
    if (!this._raw || this._raw.count === 0) return null;
    const { positions, count } = this._raw;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < count; i++) { sx += positions[i * 3]; sy += positions[i * 3 + 1]; sz += positions[i * 3 + 2]; }
    const cx = sx / count, cy = sy / count, cz = sz / count;
    let r2 = 0;
    for (let i = 0; i < count; i++) {
      const dx = positions[i * 3] - cx, dy = positions[i * 3 + 1] - cy, dz = positions[i * 3 + 2] - cz;
      const d = dx * dx + dy * dy + dz * dz; if (d > r2) r2 = d;
    }
    return { center: [cx, cy, cz], radius: Math.sqrt(r2) };
  }

  setColorMode(mode) { this._mode = mode; this._rebuild(); }
  setDecimation(ratio) { this._stride = Math.max(1, Math.round(1 / Math.min(1, Math.max(0.01, ratio)))); this._rebuild(); }
  setPointSize(s) { this._mat.size = s; }
  setSolidColor(rgb) { this._solid = rgb; if (this._mode === 'solid') this._rebuild(); }
  setHeightAxis(idx) { this._heightAxis = idx; if (this._mode === 'height') this._rebuild(); }

  _rebuild() {
    if (!this._raw) return;
    const { positions, count } = this._raw;
    const stride = this._stride;
    const ha = this._heightAxis;
    const kept = Math.ceil(count / stride);
    const pos = new Float32Array(kept * 3);
    const col = new Float32Array(kept * 3);
    let hmin = Infinity, hmax = -Infinity, rmax = 0;
    for (let i = 0; i < count; i += stride) {
      const h = positions[i * 3 + ha];
      if (h < hmin) hmin = h; if (h > hmax) hmax = h;
      const r = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      if (r > rmax) rmax = r;
    }
    let k = 0;
    for (let i = 0; i < count; i += stride) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      let c;
      if (this._mode === 'height') c = turbo(normalizeRange(positions[i * 3 + ha], hmin, hmax));
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
