// label/src/io/video_source.js
import * as THREE from 'three';

// Wraps an HTML5 <video> as a seekable per-frame background.
export class VideoSource {
  constructor(file, { fps = 30 } = {}) {
    this._url = URL.createObjectURL(file);
    this._fps = fps;
    this._video = document.createElement('video');
    this._video.muted = true;
    this._video.playsInline = true;
    this._video.preload = 'auto';
    this._video.src = this._url;
    this._texture = new THREE.VideoTexture(this._video);
    this._texture.colorSpace = THREE.SRGBColorSpace;
    this._ready = new Promise((resolve, reject) => {
      this._video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      this._video.addEventListener('error', () => reject(new Error('video load failed')), { once: true });
    });
  }

  async ready() { await this._ready; return this; }
  get fps() { return this._fps; }
  get width() { return this._video.videoWidth; }
  get height() { return this._video.videoHeight; }
  frameCount() { return Math.max(1, Math.floor((this._video.duration || 0) * this._fps)); }
  get texture() { return this._texture; }
  get videoEl() { return this._video; }

  // Seek to a frame index; resolves once the frame is displayable.
  seek(index) {
    const t = Math.min(this._video.duration || 0, (index + 0.001) / this._fps);
    return new Promise((resolve) => {
      const onSeeked = () => { this._texture.needsUpdate = true; resolve(); };
      this._video.addEventListener('seeked', onSeeked, { once: true });
      this._video.currentTime = t;
    });
  }

  dispose() {
    this._texture.dispose();
    URL.revokeObjectURL(this._url);
    this._video.removeAttribute('src');
    this._video.load();
  }
}
