// smpl_render/recorder.js — 标注器通用的画面录制(浏览器本地,不上传)。
// 录的是视图区:把 WebGL 画布按它在视图容器里的位置合成到一块固定尺寸的画布上(2D 留边、3D 填满、
// 切换动画都如实保留),再用 MediaRecorder 编码。DOM 叠加层(状态栏、按钮、标签)不录。
// 有持续渲染循环的页面(WebGL)在每次渲染之后调用 afterRender():同一任务里取帧,画布不需要
// preserveDrawingBuffer,帧与渲染一一对应。按需重绘的 2D canvas 页面传 poll: true,由录制器自己每帧取样。
// 录制从按下按钮开始,不含加载时间。

// 浏览器支持的第一种编码。mp4(H.264)优先,便于直接分享;否则 webm。
export const MIME_CANDIDATES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
export function pickMimeType(isSupported) {
  return MIME_CANDIDATES.find((m) => isSupported(m)) ?? '';
}

// 下载文件名:<页面>-YYYYMMDD-HHMMSS.<ext>(本地时间)。
export function recordingName(prefix, mime, date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${prefix}-${stamp}.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
}

// 录制画布尺寸:容器 CSS 尺寸 × 像素比,取偶数(H.264 要求)。
export function recordingSize(cssW, cssH, pixelRatio) {
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return { w: even(cssW * pixelRatio), h: even(cssH * pixelRatio) };
}

// 源画布在容器里的矩形(CSS px,相对容器左上)→ 录制画布上的矩形。容器尺寸变了按比例缩放并居中。
export function placeRect(src, frameW, frameH, outW, outH) {
  const s = Math.min(outW / frameW, outH / frameH);
  const ox = (outW - frameW * s) / 2, oy = (outH - frameH * s) / 2;
  return { x: ox + src.x * s, y: oy + src.y * s, w: src.w * s, h: src.h * s };
}

const fmtTime = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export class ViewRecorder {
  // canvas:WebGL 画布;frame:视图容器(录制范围);name:文件名前缀。
  constructor({ canvas, frame, name, fps = 30, bitrate = 16e6, poll = false }) {
    Object.assign(this, { _canvas: canvas, _frame: frame, _name: name, _fps: fps, _bitrate: bitrate, _poll: poll });
    this._rec = null;
    this.onChange = null;
  }

  static supported() {
    return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  recording() { return !!this._rec; }
  elapsed() { return this._rec ? performance.now() - this._t0 : 0; }

  start() {
    if (this._rec) return;
    const mime = pickMimeType((m) => MediaRecorder.isTypeSupported(m));
    const { w, h } = recordingSize(this._frame.clientWidth, this._frame.clientHeight, Math.min(window.devicePixelRatio || 1, 2));
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    this._out = out;
    this._ctx = out.getContext('2d');
    this._bg = getComputedStyle(this._frame).backgroundColor || '#000';
    this._stream = out.captureStream(0);   // 只在 afterRender 里推帧
    this._track = this._stream.getVideoTracks()[0];
    const chunks = [];
    const rec = new MediaRecorder(this._stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: this._bitrate });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'video/webm';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(chunks, { type }));
      a.download = recordingName(this._name, type);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    };
    rec.start(1000);
    this._rec = rec;
    this._t0 = performance.now();
    this._lastPush = -Infinity;
    this.afterRender();
    if (this._poll) {
      const tick = () => { if (!this._rec) return; this.afterRender(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }
    this.onChange?.();
  }

  stop() {
    if (!this._rec) return;
    this._rec.stop();
    this._track.stop();
    this._rec = null;
    this.onChange?.();
  }

  toggle() { if (this._rec) this.stop(); else this.start(); }

  // 每次渲染后调用:按 fps 限流,把画布当前内容合成进录制画布并推一帧。
  afterRender() {
    if (!this._rec) return;
    const now = performance.now();
    if (now - this._lastPush < 1000 / this._fps - 2) return;
    this._lastPush = now;
    const fr = this._frame.getBoundingClientRect(), cr = this._canvas.getBoundingClientRect();
    const r = placeRect({ x: cr.left - fr.left, y: cr.top - fr.top, w: cr.width, h: cr.height }, fr.width, fr.height, this._out.width, this._out.height);
    const g = this._ctx;
    g.fillStyle = this._bg;
    g.fillRect(0, 0, this._out.width, this._out.height);
    g.drawImage(this._canvas, r.x, r.y, r.w, r.h);
    this._track.requestFrame?.();
    this.onChange?.();
  }
}

// 在视图容器角落放一个不显眼的录制按钮(录制中变红并显示时长)。返回 recorder;不支持的浏览器返回 null。
// inset:[竖直, 水平] 离角落的 px,用来避开页面已有的角落控件。
export function installRecorder({ canvas, frame, name, corner = 'bottom-left', inset = [8, 8], fps, poll }) {
  if (!ViewRecorder.supported()) return null;
  const rec = new ViewRecorder({ canvas, frame, name, fps, poll });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'view-recorder';
  const [v, h] = corner.split('-');
  btn.style.cssText = `position:absolute;${v}:${inset[0]}px;${h}:${inset[1]}px;z-index:7;padding:2px 7px;font-size:11px;line-height:16px;`
    + 'background:rgba(17,25,34,.7);color:#bcd;border:1px solid #3a4658;border-radius:10px;cursor:pointer;opacity:.75';
  btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
  btn.addEventListener('mouseleave', () => { if (!rec.recording()) btn.style.opacity = '.75'; });
  btn.addEventListener('click', () => rec.toggle());
  let shown = '';
  rec.onChange = () => {
    const text = rec.recording() ? `■ ${fmtTime(rec.elapsed())}` : '● 录制';
    if (text === shown) return;
    shown = text;
    btn.textContent = text;
    btn.title = rec.recording() ? '停止录制并下载视频' : '录制视图区(不含面板;停止后下载视频)';
    btn.style.color = rec.recording() ? '#fff' : '#bcd';
    btn.style.background = rec.recording() ? 'rgba(200,40,40,.85)' : 'rgba(17,25,34,.7)';
    btn.style.opacity = rec.recording() ? '1' : '.75';
  };
  rec.onChange();
  frame.appendChild(btn);
  return rec;
}
