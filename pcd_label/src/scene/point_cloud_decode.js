// pcd_label/src/scene/point_cloud_decode.js
// 把导出端 PNG（RGB888 三段 band = X/Y/Z）的像素缓冲解码成有效点位置缓冲。
// 像素布局：图像宽 = pointWidth，图像高 = pointHeight*3；band b 的第 row 行在图像
// 第 b*pointHeight+row 行。每像素 RGB = 24 位整数高/中/低字节，encoded=(R<<16)|(G<<8)|B，
// value = encoded/scale - center；encoded==0 为无效点（任一 band 为 0 即丢弃该点）。
export function decodeXYZ(pixels, { pointWidth, pointHeight, scale, center, channels = 4 }) {
  const n = pointWidth * pointHeight;
  const positions = new Float32Array(n * 3);
  let count = 0;
  for (let row = 0; row < pointHeight; row++) {
    for (let col = 0; col < pointWidth; col++) {
      const enc = (b) => {
        const px = ((b * pointHeight + row) * pointWidth + col) * channels;
        return (pixels[px] << 16) | (pixels[px + 1] << 8) | pixels[px + 2];
      };
      const ex = enc(0), ey = enc(1), ez = enc(2);
      if (ex === 0 || ey === 0 || ez === 0) continue;
      positions[count * 3 + 0] = ex / scale - center;
      positions[count * 3 + 1] = ey / scale - center;
      positions[count * 3 + 2] = ez / scale - center;
      count++;
    }
  }
  return { positions: positions.subarray(0, count * 3), count };
}
