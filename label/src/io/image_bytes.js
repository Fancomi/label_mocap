// label/src/io/image_bytes.js
// 当前帧图像 → base64(喂给 gvhmr_client)。bytesToBase64 是纯逻辑(可单测);
// fileToBase64 / videoFrameToBase64 走浏览器 API(浏览器验证)。

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Uint8Array → base64 字符串。不依赖 btoa(Node 测试环境也能跑),手写 3→4 编码。
export function bytesToBase64(bytes) {
  let out = '';
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < n ? bytes[i + 1] : 0;
    const b2 = i + 2 < n ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < n ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < n ? B64[b2 & 63] : '=';
  }
  return out;
}

// 图像 File → base64(去掉 data: 前缀,只要裸 b64)。
export async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}

// 视频当前帧 → base64(jpeg)。把 VideoTexture 背后的 <video> 当前帧画到离屏 canvas。
// videoEl: HTMLVideoElement。复用单例 canvas,避免每帧新建。
let _frameCanvas = null;
export async function videoFrameToBase64(videoEl) {
  const w = videoEl.videoWidth, h = videoEl.videoHeight;
  if (!_frameCanvas) _frameCanvas = document.createElement('canvas');
  _frameCanvas.width = w; _frameCanvas.height = h;
  _frameCanvas.getContext('2d').drawImage(videoEl, 0, 0, w, h);
  const blob = await new Promise((res) => _frameCanvas.toBlob(res, 'image/jpeg', 0.92));
  return fileToBase64(blob);
}
