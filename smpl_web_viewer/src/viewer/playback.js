export class Playback {
  constructor(frameCount, fps = 30) {
    const nFrames = Number(frameCount);
    const rate = Number(fps);

    this.frameCount = Number.isFinite(nFrames) ? Math.max(0, Math.trunc(nFrames)) : 0;
    this.fps = Number.isFinite(rate) && rate > 0 ? rate : 30;
    this.frame = 0;
    this.playing = false;
    this._accum = 0;
  }

  setFrame(frame) {
    if (this.frameCount <= 0) {
      this.frame = 0;
      return this.frame;
    }

    const next = Number.isFinite(Number(frame)) ? Math.trunc(Number(frame)) : 0;
    this.frame = Math.max(0, Math.min(this.frameCount - 1, next));
    return this.frame;
  }

  toggle() {
    this.playing = !this.playing;
    return this.playing;
  }

  tick(dtMs) {
    if (!this.playing || this.frameCount <= 0) {
      return this.frame;
    }

    if (typeof dtMs !== 'number' || !Number.isFinite(dtMs) || dtMs < 0) {
      return this.frame;
    }

    this._accum += dtMs;
    const step = 1000 / this.fps;
    const frames = Math.floor(this._accum / step + 1e-9);
    if (frames > 0) {
      this._accum -= frames * step;
      this.frame = (this.frame + frames) % this.frameCount;
    }
    return this.frame;
  }
}
