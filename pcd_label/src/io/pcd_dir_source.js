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

// 不支持 File System Access 的浏览器(如 Firefox/Safari)的退化路径:用
// <input webkitdirectory> 一次拿到整个目录的 FileList,全部 File 持有在内存里。
// 接口与 PcdDirSource 对齐;保存无法原地写,退化为下载 player_0.json。
function baseName(path) { const p = String(path); const i = p.lastIndexOf('/'); return i >= 0 ? p.slice(i + 1) : p; }

export class FileListSource {
  constructor(fileList) {
    this._byName = new Map();
    for (const f of Array.from(fileList ?? [])) this._byName.set(baseName(f.webkitRelativePath || f.name), f);
    this._manifest = null;
  }

  async readManifest() {
    const f = this._byName.get('manifest.json');
    if (!f) throw new Error('所选文件夹缺少 manifest.json');
    this._manifest = parseManifest(JSON.parse(await f.text()));
    return this._manifest;
  }

  async frameFile(i) {
    const name = frameFileName(this._manifest.framePattern, i);
    const f = this._byName.get(name);
    if (!f) throw new Error(`缺少帧文件 ${name}`);
    return f;
  }

  async readAnnotation() {
    const f = this._byName.get(ANNO_NAME);
    if (!f) return null;
    try { return JSON.parse(await f.text()); } catch { return null; }
  }

  // 无原地写权限:下载 player_0.json。
  async saveAnnotation(obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = ANNO_NAME; a.click();
    URL.revokeObjectURL(url);
    return `${ANNO_NAME}(已下载,请手动覆盖回数据目录)`;
  }
}

