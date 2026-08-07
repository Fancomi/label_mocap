// pcd_label/src/io/background_loop.js
// 背景点云 loop：一个 kind="background" 的 png-sequence 目录（由 lidar_projects 的
// lidar_extract_background 产出）。它与前景序列共用同一套 manifest/解码路径,所以直接
// 复用 PcdDirSource / FileListSource —— 只多两件事:全帧缓存,以及按前景帧号取模跟随。
//
// 坐标系:两者都存【原始传感器坐标】,不施加任何旋转,因此直接叠加即对齐。这也是
// pcd_label 「几何不动、只改相机」这条约定的直接好处。
import { decodePngFile } from './png_pixels.js';
import { decodeXYZ } from '../scene/point_cloud_decode.js';

export class BackgroundLoop {
  // source: 具备 readManifest()/frameFile(i) 的目录源(PcdDirSource 或 FileListSource)。
  constructor(source) { this._source = source; this._cache = new Map(); this.manifest = null; }

  async open() {
    this.manifest = await this._source.readManifest();
    return this.manifest;
  }

  get frameCount() { return this.manifest?.frameCount ?? 0; }

  // 按前景帧号取模跟随(背景通常只有 10 帧)。解一次缓存住,播放时不再解码。
  async frameFor(foregroundIndex) {
    const n = this.frameCount;
    if (!n) return null;
    const key = ((foregroundIndex % n) + n) % n;
    if (!this._cache.has(key)) {
      const { pixels, channels } = await decodePngFile(await this._source.frameFile(key));
      this._cache.set(key, decodeXYZ(pixels, {
        pointWidth: this.manifest.pointWidth, pointHeight: this.manifest.pointHeight,
        scale: this.manifest.scale, center: this.manifest.center, channels,
      }));
    }
    return this._cache.get(key);
  }
}
