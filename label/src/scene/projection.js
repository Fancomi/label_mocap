// label/src/scene/projection.js
// Source coords: Y+ up, -Z depth. u = fx*X/(-Z)+cx, v = fy*(-Y)/(-Z)+cy.

export function projectPoint([x, y, z], { fx, fy, cx, cy }) {
  if (z >= 0) throw new Error('point behind camera (Z>=0) cannot be projected');
  return [fx * x / (-z) + cx, fy * (-y) / (-z) + cy];
}

// verts: flat Float32Array [x0,y0,z0, x1,y1,z1, ...]. Returns [x, y, w, h].
export function bboxFromPoints(verts, K) {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (let i = 0; i + 2 < verts.length; i += 3) {
    const z = verts[i + 2];
    if (z >= 0) continue;
    const [u, v] = projectPoint([verts[i], verts[i + 1], z], K);
    if (u < minU) minU = u;
    if (v < minV) minV = v;
    if (u > maxU) maxU = u;
    if (v > maxV) maxV = v;
  }
  if (!Number.isFinite(minU)) throw new Error('no projectable points');
  return [minU, minV, maxU - minU, maxV - minV];
}
