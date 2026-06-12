// smpl_core/rotations.js — quaternion [x,y,z,w] is the hub format.

export function quatNormalize([x, y, z, w]) {
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

export function axisAngleToQuat([x, y, z]) {
  const angle = Math.hypot(x, y, z);
  if (angle < 1e-12) return [0, 0, 0, 1];
  const s = Math.sin(angle / 2) / angle;
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
}

export function quatToAxisAngle([x, y, z, w]) {
  const cw = Math.min(1, Math.max(-1, w));
  const angle = 2 * Math.acos(cw);
  const s = Math.sqrt(Math.max(0, 1 - cw * cw));
  if (s < 1e-9) return [0, 0, 0];
  const k = angle / s;
  return [x * k, y * k, z * k];
}

export function eulerXYZToQuat([rx, ry, rz]) {
  const qx = [Math.sin(rx / 2), 0, 0, Math.cos(rx / 2)];
  const qy = [0, Math.sin(ry / 2), 0, Math.cos(ry / 2)];
  const qz = [0, 0, Math.sin(rz / 2), Math.cos(rz / 2)];
  return quatMultiply(qz, quatMultiply(qy, qx)); // intrinsic XYZ
}

export function quatToEulerXYZ([x, y, z, w]) {
  // row-major R = Rz*Ry*Rx: m[6]=-sy, m[7]=sx*cy, m[8]=cx*cy
  // m[0]=cy*cz, m[3]=cy*sz => rz=atan2(m[3],m[0]), rx=atan2(m[7],m[8])
  const m = quatToMat3([x, y, z, w]);
  const nsy = m[6]; // -sin(ry)
  if (Math.abs(nsy) < 1 - 1e-7) {
    return [
      Math.atan2(m[7], m[8]),
      Math.asin(-nsy),
      Math.atan2(m[3], m[0]),
    ];
  }
  return [
    Math.atan2(-m[5], m[4]),
    Math.asin(Math.min(1, Math.max(-1, -nsy))),
    0,
  ];
}

export function quatToMat3([x, y, z, w]) {
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return new Float32Array([
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ]);
}

export function quatMultiply([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
