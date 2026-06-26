// kpt_label/src/video_frames.js
// HTML5 <video> 帧源（纯 2D；canvas drawImage 直接用 videoEl）。
export class VideoFrames {
  constructor(file, { fps = 30 } = {}) {
    this._url = URL.createObjectURL(file);
    this._fps = fps;
    this._video = document.createElement('video');
    this._video.muted = true;
    this._video.playsInline = true;
    this._video.preload = 'auto';
    this._video.src = this._url;
    this._ready = new Promise((resolve, reject) => {
      this._video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      this._video.addEventListener('error', () => reject(new Error('video load failed')), { once: true });
    });
  }

  async ready() { await this._ready; return this; }
  get fps() { return this._fps; }
  get width() { return this._video.videoWidth; }
  get height() { return this._video.videoHeight; }
  get videoEl() { return this._video; }
  frameCount() { return Math.max(1, Math.floor((this._video.duration || 0) * this._fps)); }

  // seek 到帧 index，resolve 后 videoEl 可直接 drawImage。
  seek(index) {
    const t = Math.min(this._video.duration || 0, (index + 0.001) / this._fps);
    return new Promise((resolve) => {
      this._video.addEventListener('seeked', () => resolve(), { once: true });
      this._video.currentTime = t;
    });
  }

  dispose() {
    URL.revokeObjectURL(this._url);
    this._video.removeAttribute('src');
    this._video.load();
  }
}
