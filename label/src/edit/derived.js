// label/src/edit/derived.js
import { projectPoint } from '../scene/projection.js';

// joints: flat Float32Array (24*3) in source coords. Returns Array(slots*3).
// First 24 slots get projected (x, y, conf=2); behind-camera joints conf 0; rest 0.
export function reprojectKeypoints(joints, K, slots = 52) {
  const out = new Array(slots * 3).fill(0);
  const n = Math.min(24, Math.floor(joints.length / 3));
  for (let j = 0; j < n; j++) {
    const z = joints[j * 3 + 2];
    if (z >= 0) { out[j * 3] = 0; out[j * 3 + 1] = 0; out[j * 3 + 2] = 0; continue; }
    const [u, v] = projectPoint([joints[j * 3], joints[j * 3 + 1], z], K);
    out[j * 3] = u; out[j * 3 + 1] = v; out[j * 3 + 2] = 2;
  }
  return out;
}

