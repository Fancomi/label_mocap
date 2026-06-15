// label/src/io/dir_source.js
// Wraps a FileSystemDirectoryHandle: recursive walk, file reads, and in-place
// JSON write to the same directory tree (read path == write path).
import { classifyEntries } from './dataset_paths.js';

const basename = (p) => String(p).split('/').pop();

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

async function writableAt(dirHandle, relPath) {
  const parts = relPath.split('/');
  let dir = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  return fh.createWritable();
}

export class DirSource {
  constructor(dirHandle) {
    this._dir = dirHandle;
    this._cls = null;
  }

  async scan() {
    const paths = [];
    await walk(this._dir, '', paths);
    this._cls = classifyEntries(paths);
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

  // In-place save: writes to jsonPath if it existed, else the canonical
  // writeJsonPath (creating json_results/player_0/). Returns the path written.
  async saveJson(obj) {
    const target = this._cls?.jsonPath ?? this._cls?.writeJsonPath;
    const w = await writableAt(this._dir, target);
    await w.write(JSON.stringify(obj, null, 2));
    await w.close();
    if (this._cls) this._cls.jsonPath = target;
    return target;
  }

  async writeFile(relPath, blob) {
    const w = await writableAt(this._dir, relPath);
    await w.write(blob);
    await w.close();
    return relPath;
  }
}
