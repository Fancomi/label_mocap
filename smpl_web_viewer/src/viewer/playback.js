export class Playback {
  constructor(frameCount, fps = 30) {
    this.frameCount = Math.max(0, Math.trunc(Number(frameCount)));
    this.fps = Number(fps);
    this.frame = 0;
    this.playing = false;
    this._accum = 0;
  }

  setFrame(frame) {
    const next = Number.isFinite(Number(frame)) ? Math.trunc(Number(frame)) : 0;
    this.frame = Math.max(0, Math.min(this.frameCount - 1, next));
    return this.frame;
  }

  toggle() {
    this.playing = !this.playing;
    return this.playing;
  }

  tick(dtMs) {
    if (!this.playing || this.frameCount <= 0 || this.fps <= 0) {
      return this.frame;
    }

    this._accum += Number(dtMs);
    const step = 1000 / this.fps;
    while (this._accum >= step) {
      this._accum -= step;
      this.frame = (this.frame + 1) % this.frameCount;
    }
    return this.frame;
  }
}
