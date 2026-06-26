// label/src/io/dir_source.js
// Wraps a FileSystemDirectoryHandle: recursive walk, file reads, and in-place
// JSON write to the same directory tree (read path == write path).
import { classifyEntries } from './dataset_paths.js';
import { basename } from './image_order.js';

export function fsAccessSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickDirectory() {
  // 'readwrite' so we can save in place without a second prompt.
  return window.showDirectoryPicker({ mode: 'readwrite' });
}

export function videoOpenSupported() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

export async function pickVideoFile() {
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'Video', accept: { 'video/*': ['.mp4', '.webm', '.mov', '.m4v'] } }],
    multiple: false,
  });
  return handle.getFile(); // File object
}

export function jsonOpenSupported() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

export async function pickJsonFile() {
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    multiple: false,
  });
  return handle.getFile(); // File object
}

async function walk(dirHandle, prefix, out) {
  for await (const [name, handle] of dirHandle.entries()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'file') out.push(rel);
    else if (handle.kind === 'directory') await walk(handle, rel, out);
  }
}

async function fileAt(dirHandle, relPath) {
  const parts = relPath.split('/');
  let dir = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
  const fh = await dir.getFileHandle(parts[parts.length - 1]);
  return fh.getFile();
}

// 抗只读写入：正常 createWritable 写入；若目标文件被 OS 置为只读（macOS 下载目录
// 里的 0444 文件常见），createWritable 抛 NoModificationAllowedError/InvalidStateError，
// 此时删掉旧文件再以 create:true 重建（新文件默认可写）后写入。重建仍失败则抛出。
async function dirChainFor(dirHandle, relPath) {
  const parts = relPath.split('/');
  let dir = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  return { dir, name: parts[parts.length - 1] };
}

export async function writeFileResilient(dirHandle, relPath, data) {
  const { dir, name } = await dirChainFor(dirHandle, relPath);
  const writeVia = async (fh) => { const w = await fh.createWritable(); await w.write(data); await w.close(); };
  const fh = await dir.getFileHandle(name, { create: true });
  try {
    await writeVia(fh);
  } catch (e) {
    if (e?.name === 'NoModificationAllowedError' || e?.name === 'InvalidStateError') {
      await dir.removeEntry(name);
      const fresh = await dir.getFileHandle(name, { create: true });
      await writeVia(fresh);
    } else {
      throw e;
    }
  }
  return relPath;
}

export class DirSource {
  constructor(dirHandle) {
    this._dir = dirHandle;
    this._cls = null;
  }

  async scan(opts = {}) {
    const paths = [];
    await walk(this._dir, '', paths);
    // rootName = the picked directory's own name, so a loose-images / fallback
    // dataset writes <rootName>.json at the parent root. videoName lets the
    // explicit video-file flow name the json after the picked mp4.
    this._cls = classifyEntries(paths, { rootName: this._dir.name, ...opts });
    return this._cls;
  }

  get classification() { return this._cls; }

  async readJson() {
    if (!this._cls?.jsonPath) return null;
    const f = await fileAt(this._dir, this._cls.jsonPath);
    return JSON.parse(await f.text());
  }

  async imageFile(index) {
    const p = this._cls?.imagePaths?.[index];
    return p ? fileAt(this._dir, p) : null;
  }

  // Match by file basename (not by sorted position): the COCO json's images[]
  // order is authoritative, so frame i's background is the file whose basename
  // equals the json entry's file_name basename. Returns null if not on disk.
  async imageFileByName(name) {
    const want = basename(name);
    const p = (this._cls?.imagePaths ?? []).find((rel) => basename(rel) === want);
    return p ? fileAt(this._dir, p) : null;
  }

  async videoFile() {
    return this._cls?.videoPath ? fileAt(this._dir, this._cls.videoPath) : null;
  }

  // In-place save: writes to jsonPath if it existed, else writeJsonPath (the
  // sibling <dataItemName>.json at the parent root, or the diving path). Returns
  // the path written, and pins jsonPath so the next save is in place.
  async saveJson(obj) {
    const target = this._cls?.jsonPath ?? this._cls?.writeJsonPath;
    await writeFileResilient(this._dir, target, JSON.stringify(obj, null, 2));
    if (this._cls) this._cls.jsonPath = target;
    return target;
  }

  async writeFile(relPath, blob) {
    return writeFileResilient(this._dir, relPath, blob);
  }

  // 按相对路径读任意文件（与 writeFile 对称）；不存在返回 null。
  async readFile(relPath) {
    try { return await fileAt(this._dir, relPath); }
    catch { return null; }
  }
}
