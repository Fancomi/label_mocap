export function projectSrc([x, y, z], k) {
  return [
    k.fx * x / (-z) + k.cx,
    k.fy * (-y) / (-z) + k.cy
  ];
}

export function verticalFovDeg(imageHeight, fy) {
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
