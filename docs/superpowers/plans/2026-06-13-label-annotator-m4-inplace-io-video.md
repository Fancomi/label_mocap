# SMPL Annotator — M4 In-Place IO + Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Load a dataset directory via a writable directory handle and save annotations IN PLACE (no download, no move). Read path == write path, fully aligned. A pure image/video folder with no data gets the `json_results/player_0/player_0.json` structure created and written on first save. Add HTML5 `<video>` background support (per-frame seek) alongside image sequences.

**Architecture:** Use the File System Access API (`showDirectoryPicker`) on Chromium to obtain a `FileSystemDirectoryHandle` with read+write. A new `DirSource` module walks the handle to discover the COCO json (`json_results/player_0/player_0.json`), image sequence (`images/*.jpg`), and/or a single video file, and exposes a `saveJson(obj)` that writes back to the same handle (creating `json_results/player_0/` if absent). A `VideoSource` wraps an `<video>` element for per-frame seeked textures. `app.js` switches its open + save paths to the handle; falls back to the existing `webkitdirectory` input + download when the API is unavailable.

**Tech Stack:** File System Access API, HTML5 video + THREE.VideoTexture/CanvasTexture, vanilla ES modules, `node --test` for the pure path/structure logic.

**Builds on:** M1–M3 complete. **Reference spec:** `docs/superpowers/specs/2026-06-12-label-mocap-annotator-design.md`.

---

## Conventions
- `node --test label/tests/<f>.test.js`; serve `npm run serve:label` (localhost → FS Access API works).
- Browser-only code: `node --check` + manual verify. Pure path/structure logic: unit-tested.
- Commit per task. Sample dir: `/Users/penghaotian/Downloads/20260609/test_data`.

## Existing facts
- `openFiles(fileList)` reads a `webkitdirectory` `<input>`'s FileList: finds `*.json`, `*.jpg`, builds `CocoDocument` + `AnnotationStore`, `images` Map (index→File). `saveJson()` currently serializes + downloads `player_0.json` and computes keypoints+occlusion per frame.
- `CocoDocument.serialize()` returns the round-tripped COCO object.
- Background today = image sequence only (`images.get(i)` → File → TextureLoader). No video.

## File structure (M4)
- Create: `label/src/io/dataset_paths.js` — pure: classify files, resolve canonical paths (tested)
- Create: `label/src/io/dir_source.js` — FileSystemDirectoryHandle walk + read + in-place write (browser)
- Create: `label/src/io/video_source.js` — `<video>` per-frame seek → texture (browser)
- Modify: `label/src/app.js` — open via dir picker (fallback to input), save in place, video background
- Modify: `label/index.html` — open button wording + fallback input retained
- Tests: `label/tests/dataset_paths.test.js`

---

## Task 1: Pure dataset-path classification (`dataset_paths.js`)

Decide, from a list of relative paths inside a chosen directory, where the data json lives (read==write), where images live, and whether a video exists. Pure + tested.

**Files:**
- Create: `label/src/io/dataset_paths.js`
- Test: `label/tests/dataset_paths.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyEntries, DATA_JSON_PATH } from '../src/io/dataset_paths.js';

test('canonical data json path is json_results/player_0/player_0.json', () => {
  assert.equal(DATA_JSON_PATH, 'json_results/player_0/player_0.json');
});

test('classify finds json, sorted images, and no video', () => {
  const r = classifyEntries([
    'json_results/player_0/player_0.json',
    'images/0001.jpg', 'images/0000.jpg', 'images/0002.jpg',
  ]);
  assert.equal(r.jsonPath, 'json_results/player_0/player_0.json');
  assert.deepEqual(r.imagePaths, ['images/0000.jpg', 'images/0001.jpg', 'images/0002.jpg']);
  assert.equal(r.videoPath, null);
});

test('classify finds a single video and no images', () => {
  const r = classifyEntries(['clip.mp4']);
  assert.equal(r.videoPath, 'clip.mp4');
  assert.deepEqual(r.imagePaths, []);
  assert.equal(r.jsonPath, null);
});

test('image-only folder: jsonPath null but writeJsonPath is the canonical target', () => {
  const r = classifyEntries(['images/0000.jpg', 'images/0001.jpg']);
  assert.equal(r.jsonPath, null);
  assert.equal(r.writeJsonPath, 'json_results/player_0/player_0.json');
});

test('images may sit at the directory root (no images/ prefix)', () => {
  const r = classifyEntries(['0000.jpg', '0001.jpg']);
  assert.deepEqual(r.imagePaths, ['0000.jpg', '0001.jpg']);
});

test('prefers mp4 over other video extensions, ignores non-media', () => {
  const r = classifyEntries(['a.mp4', 'notes.txt', 'b.webm']);
  assert.equal(r.videoPath, 'a.mp4');
});
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `node --test label/tests/dataset_paths.test.js`

- [ ] **Step 3: Implement**

```javascript
// label/src/io/dataset_paths.js
// Pure classification of a directory's relative file paths. Read path == write path.
export const DATA_JSON_PATH = 'json_results/player_0/player_0.json';

const isJpeg = (p) => /\.(jpe?g)$/i.test(p);
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v'];
const videoRank = (p) => {
  const lower = p.toLowerCase();
  const i = VIDEO_EXT.findIndex((e) => lower.endsWith(e));
  return i < 0 ? Infinity : i;
};

export function classifyEntries(paths) {
  const jsonPath = paths.includes(DATA_JSON_PATH) ? DATA_JSON_PATH
    : (paths.find((p) => p.endsWith('player_0.json')) ?? null);

  const imagePaths = paths.filter(isJpeg).sort((a, b) => a.localeCompare(b));

  let videoPath = null;
  let bestRank = Infinity;
  for (const p of paths) {
    const r = videoRank(p);
    if (r < bestRank) { bestRank = r; videoPath = p; }
  }

  return {
    jsonPath,
    writeJsonPath: jsonPath ?? DATA_JSON_PATH,
    imagePaths,
    videoPath,
  };
}
```

- [ ] **Step 4: Run, confirm 6/6 PASS**

Run: `node --test label/tests/dataset_paths.test.js`

- [ ] **Step 5: Commit**

```bash
git add label/src/io/dataset_paths.js label/tests/dataset_paths.test.js
git commit -m "feat(label): pure dataset-path classification (read==write paths)"
```

---

## Task 2: Directory-handle source (`dir_source.js`) — read + in-place write

Wrap a `FileSystemDirectoryHandle`. Walk it to collect relative paths, read the json + image/video Files, and write the json back to the SAME directory (creating `json_results/player_0/` if absent). Browser-only — `node --check` + manual verify.

**Files:**
- Create: `label/src/io/dir_source.js`

- [ ] **Step 1: Implement**

```javascript
// label/src/io/dir_source.js
// Wraps a FileSystemDirectoryHandle: recursive walk, file reads, and in-place
// JSON write to the same directory tree (read path == write path).
import { classifyEntries } from './dataset_paths.js';

export function fsAccessSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickDirectory() {
  // 'readwrite' so we can save in place without a second prompt.
  return window.showDirectoryPicker({ mode: 'readwrite' });
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
    // a freshly-created json is now the canonical read path for next save
    if (this._cls) this._cls.jsonPath = target;
    return target;
  }
}
```

- [ ] **Step 2: Verify**

Run: `node --check label/src/io/dir_source.js`

- [ ] **Step 3: Commit**

```bash
git add label/src/io/dir_source.js
git commit -m "feat(label): FileSystemDirectoryHandle source — walk, read, in-place JSON write"
```

---

## Task 3: Video background source (`video_source.js`)

Wrap an `<video>` element: load a video File, expose frame count (via fps + duration) and a per-frame seek that resolves when the frame is ready, producing a THREE texture. Browser-only.

**Files:**
- Create: `label/src/io/video_source.js`

- [ ] **Step 1: Implement**

```javascript
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
```

- [ ] **Step 2: Verify**

Run: `node --check label/src/io/video_source.js`

- [ ] **Step 3: Commit**

```bash
git add label/src/io/video_source.js
git commit -m "feat(label): HTML5 video background source with per-frame seek"
```

---

## Task 4: Wire app.js to dir-handle open + in-place save + video

Switch open/save to the directory handle; keep the old `webkitdirectory`+download path as a fallback when the FS Access API is missing. Add video background rendering.

**Files:**
- Modify: `label/src/app.js`
- Modify: `label/index.html` (button wording; keep fallback input)

- [ ] **Step 1: Open via directory picker (fallback to input)**

Import `fsAccessSupported, pickDirectory, DirSource` from `./io/dir_source.js`, `VideoSource` from `./io/video_source.js`, `classifyEntries` not needed directly.

Add module state: `let dirSource = null; let videoSource = null;`

Refactor open. Replace the `#btn-open` click handler:
```javascript
$('btn-open').addEventListener('click', async () => {
  if (fsAccessSupported()) {
    try {
      const handle = await pickDirectory();
      dirSource = new DirSource(handle);
      await dirSource.scan();
      await openFromDirSource();
    } catch (err) { if (err?.name !== 'AbortError') setStatus(String(err)); }
  } else {
    $('dir-input').click(); // legacy fallback
  }
});
```
Keep the existing `#dir-input` change listener calling the OLD `openFiles(fileList)` (download-save fallback).

Add `openFromDirSource()` modeled on `openFiles` but sourcing from `dirSource`:
```javascript
async function openFromDirSource() {
  images = new Map();
  videoSource?.dispose(); videoSource = null;
  const cls = dirSource.classification;

  let coco = null;
  const rawJson = await dirSource.readJson();
  if (rawJson) coco = new CocoDocument(rawJson);

  // background: image sequence or video
  let bgCount = cls.imagePaths.length;
  if (cls.imagePaths.length) {
    for (let i = 0; i < cls.imagePaths.length; i++) images.set(i, await dirSource.imageFile(i));
  } else if (cls.videoPath) {
    const vf = await dirSource.videoFile();
    videoSource = await new VideoSource(vf, { fps }).ready();
    bgCount = videoSource.frameCount();
  }
  const background = bgCount ? { kind: cls.videoPath && !cls.imagePaths.length ? 'video' : 'image_sequence', count: bgCount } : null;

  if (!coco) {
    coco = new CocoDocument({ images: Array.from({ length: bgCount }, (_, i) => ({ id: i })), annotations: [], categories: [] });
  }

  const ids = coco.imageIds();
  const dataFrameIndices = ids.map((id, idx) => (coco.getAnnotation(id) ? idx : -1)).filter((x) => x >= 0);
  buildFrames({ background, dataFrameIndices }); // validates union

  const info = coco.imageInfo(coco.imageIds()[0]);
  readOnly = info ? isPortrait(info) : false;
  if (readOnly) setStatus('⚠ 该数据为竖拍/旋转,标注器仅支持查看;请用其他软件转正后再标注');

  store = new AnnotationStore(coco);
  ui = new UIController({ readOnly });
  if (syncUI) ui.onChange(syncUI);
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
  $('slider').value = '0';
  $('right').classList.remove('disabled');
  if (!model) { model = await loadModel(MODEL_URL); scene.setTopology(model.faces); }
  scene.prepareForSequence({ K: cam.K, image_w: cam.imageW, image_h: cam.imageH });
  cam.snapTo('2d');
  scene.resize();
  await showFrame(0);
  if (syncUI) syncUI();
}
```

- [ ] **Step 2: Background texture in showFrame supports video**

In `showFrame(i)`, replace the image-only texture block with:
```javascript
  if (videoSource) {
    await videoSource.seek(i);
    scene.setBackgroundTexture(videoSource.texture);
  } else {
    const file = images.get(i);
    if (file) {
      const url = URL.createObjectURL(file);
      textureLoader ||= new THREE.TextureLoader();
      textureLoader.load(url, (tex) => {
        URL.revokeObjectURL(url);
        if (currentTexture) currentTexture.dispose();
        currentTexture = tex;
        scene.setBackgroundTexture(tex);
      });
    }
  }
```

- [ ] **Step 3: In-place save**

Replace `saveJson()`'s download tail. Keep the per-frame keypoints+occlusion recompute loop. After building `const json = doc.serialize();`:
```javascript
async function saveJson() {
  if (!store || !model) return;
  const doc = store.document();
  for (const id of doc.imageIds()) {
    const a = doc.getAnnotation(id);
    if (!a) continue;
    const out = forwardSmpl(model, { root_pos: a.root_pos, root_rota: a.root_rota, body_pose: a.body_pose, betas: a.betas });
    const keypoints = reprojectKeypoints(out.joints, cam.K, 52);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(out.vertices, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(model.faces), 1));
    const tmpMesh = new THREE.Mesh(g);
    const occlution_joint = computeOcclusion(out.joints, tmpMesh, cam.camera, 52);
    g.dispose();
    doc.setAnnotation(id, { keypoints, occlution_joint });
  }
  const obj = doc.serialize();
  if (dirSource) {
    const path = await dirSource.saveJson(obj);
    setStatus(`已原地保存 ${path}`);
  } else {
    // legacy download fallback
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'player_0.json'; link.click();
    URL.revokeObjectURL(url);
    setStatus('已下载 player_0.json(浏览器不支持原地保存)');
  }
}
```
Make `$('btn-save')` handler `() => saveJson().catch((e) => setStatus(String(e)))`.

- [ ] **Step 4: Reset uses dirSource when present**

In `resetFromDisk()`: if `dirSource`, re-read via `dirSource.readJson()` and rebuild store; else keep the `loadedJsonFile` path. Guard the no-json (image/video only) case → just re-show current frame.

- [ ] **Step 5: index.html wording**

Update `#btn-open` text to `📂 打开数据目录` and add a small hint line under it: `<div class="hint" id="open-hint">Chrome/Edge 可原地保存;其他浏览器为下载模式</div>`. Keep the hidden `#dir-input` fallback.

- [ ] **Step 6: Verify**

```bash
node --check label/src/app.js label/src/io/dir_source.js label/src/io/video_source.js label/src/io/dataset_paths.js
node --test label/tests/*.test.js
npm run serve:label >/tmp/s.log 2>&1 & sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5175/label/
pkill -f static_server.mjs
```
All parse; 65 tests pass (59 + 6 new); page 200.

- [ ] **Step 7: Commit**

```bash
git add label/src/app.js label/index.html
git commit -m "feat(label): open via directory handle, save in place, video background"
```

---

## Task 5: Manual verification

**Files:** none.

- [ ] **Step 1** Serve, open `http://127.0.0.1:5175/label/` in Chrome/Edge.
- [ ] **Step 2** Click 打开数据目录 → pick `/Users/penghaotian/Downloads/20260609/test_data` → grant read/write. Confirm mesh + image load.
- [ ] **Step 3** Edit a frame, 保存 → status shows `已原地保存 json_results/player_0/player_0.json`. Re-open the SAME directory WITHOUT moving anything → edits persisted. (This is the core requirement.)
- [ ] **Step 4** Image-only folder: copy some jpgs into an empty dir, open it, add a T-pose, 保存 → confirm `json_results/player_0/player_0.json` is CREATED in that dir.
- [ ] **Step 5** Video folder: a dir with one `.mp4` → opens, scrubbing seeks video frames; add data + save creates the json.
- [ ] **Step 6** Firefox/Safari (no FS Access API): 打开数据目录 falls back to the directory `<input>`; save downloads. Confirm no crash.
- [ ] **Step 7** Record pass/fail.

## Out of scope
- Occlusion already wired (M3). IK, multi-person, frame-extraction transcode — future.
- Writing rotated/transcoded media — forbidden (portrait is view-only).

## Self-review
- Read path == write path: `DirSource.saveJson` writes to `jsonPath` (the file it read) or the canonical `writeJsonPath`; re-open reads the same. ✓
- Image / image+data / data-only / video / empty-folder-first-save all covered. ✓
- Fallback path keeps Firefox/Safari working (download). ✓
- No placeholders; pure logic tested; browser paths node-checked + manually verified.



