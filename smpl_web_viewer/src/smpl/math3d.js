export function axisAngleToMat3(v) {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  const angle = Math.hypot(x, y, z);
  if (angle < 1e-8) {
    return new Float32Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1
    ]);
  }

  const nx = x / angle;
  const ny = y / angle;
  const nz = z / angle;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;

  return new Float32Array([
    t * nx * nx + c, t * nx * ny - s * nz, t * nx * nz + s * ny,
    t * ny * nx + s * nz, t * ny * ny + c, t * ny * nz - s * nx,
    t * nz * nx - s * ny, t * nz * ny + s * nx, t * nz * nz + c
  ]);
}

export function mat4FromRt(R, t) {
  return new Float32Array([
    R[0], R[1], R[2], t[0],
    R[3], R[4], R[5], t[1],
    R[6], R[7], R[8], t[2],
    0, 0, 0, 1
  ]);
}

export function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4 + 0] * b[0 * 4 + c] +
        a[r * 4 + 1] * b[1 * 4 + c] +
        a[r * 4 + 2] * b[2 * 4 + c] +
        a[r * 4 + 3] * b[3 * 4 + c];
    }
  }
  return out;
}

export function transformPoint(m, p) {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  return new Float32Array([
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11]
  ]);
}
