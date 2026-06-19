// pcd_label/src/io/pcd_dir_source.js
// 单序列目录：含 manifest.json + frame_%06d.png（+ 可选 player_0.json 标注）。
import { parseManifest, frameFileName } from './manifest.js';

export function fsAccessSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}
export async function pickDirectory() {
  return window.showDirectoryPicker({ mode: 'readwrite' });
}

const ANNO_NAME = 'player_0.json';

export class PcdDirSource {
  constructor(dirHandle) { this._dir = dirHandle; this._manifest = null; }

  async readManifest() {
    const fh = await this._dir.getFileHandle('manifest.json');
    const raw = JSON.parse(await (await fh.getFile()).text());
    this._manifest = parseManifest(raw);
    return this._manifest;
  }

  async frameFile(i) {
    const name = frameFileName(this._manifest.framePattern, i);
    const fh = await this._dir.getFileHandle(name);
    return fh.getFile();
  }

  async readAnnotation() {
    try {
      const fh = await this._dir.getFileHandle(ANNO_NAME);
      return JSON.parse(await (await fh.getFile()).text());
    } catch { return null; }
  }

  async saveAnnotation(obj) {
    const fh = await this._dir.getFileHandle(ANNO_NAME, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(obj, null, 2));
    await w.close();
    return ANNO_NAME;
  }
}
