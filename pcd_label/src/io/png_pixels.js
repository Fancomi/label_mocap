// pcd_label/src/io/png_pixels.js
// 把 PNG File 解码成 RGBA 像素缓冲（Uint8ClampedArray, channels=4）+ 宽高。
export async function decodePngFile(file) {
  const bmp = await createImageBitmap(file);
  const w = bmp.width, h = bmp.height;
  const cnv = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close && bmp.close();
  const { data } = ctx.getImageData(0, 0, w, h);
  return { pixels: data, width: w, height: h, channels: 4 };
}
