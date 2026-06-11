export function projectSrc([x, y, z], k) {
  if (z >= 0) {
    throw new Error('points behind camera (Z>=0) cannot be projected in src coords');
  }

  return [
    k.fx * x / (-z) + k.cx,
    k.fy * (-y) / (-z) + k.cy
  ];
}

export function verticalFovDeg(imageHeight, fy) {
  if (!Number.isFinite(imageHeight) || imageHeight <= 0) {
    throw new Error('imageHeight must be a positive finite number');
  }
  if (!Number.isFinite(fy) || fy <= 0) {
    throw new Error('fy must be a positive finite number');
  }

  return 2 * Math.atan(imageHeight / (2 * fy)) * 180 / Math.PI;
}

export function viewOffsetForCamera(imageWidth, imageHeight, camera) {
  return {
    fullWidth: imageWidth,
    fullHeight: imageHeight,
    x: imageWidth / 2 - camera.cx,
    y: imageHeight / 2 - camera.cy,
    width: imageWidth,
    height: imageHeight,
  };
}
