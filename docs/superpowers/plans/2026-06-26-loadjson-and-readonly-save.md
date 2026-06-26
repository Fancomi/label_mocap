# 通用 JSON 加载入口 + 修复只读保存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 label / pcd_label / kpt_label 三个标注器统一加上「加载标注 JSON」入口，并修复原地保存遇到 OS 只读目标文件时的写入失败。

**Architecture:** 在三个 app 已共享的 IO 模块 `label/src/io/dir_source.js` 中集中两个新通用能力——抗只读写入 `writeFileResilient()` 与 JSON 选择器 `pickJsonFile()`；格式校验抽成纯函数模块 `label/src/io/anno_validate.js`（可单测）。pcd 自有的 `pcd_dir_source.js` 改为复用该写入 helper。三个 app 各自接线「加载」入口，复用既有挂载/重置路径重建 store。

**Tech Stack:** 浏览器原生 File System Access API、ES modules、`node --test`（纯逻辑单测）。

## Global Constraints

- 浏览器内运行，无构建步骤：纯 ES module，相对路径 import（verbatim 现状）。
- 三个 app 共享 `label/src/io/dir_source.js`：kpt 已 import 它；pcd 本任务新增 import。
- 纯逻辑才单测；three.js / DOM / FileSystem 句柄在浏览器内验证（项目约定）。
- 抗只读写入策略：`createWritable()` 抛 `NoModificationAllowedError` 或 `InvalidStateError` 时，`removeEntry` 删旧文件再 `create:true` 重建后写入；重建仍失败则向上抛，由 app 退回下载。
- 加载入口要求先打开数据（目录/视频/图像）；未打开时禁用或提示「请先打开数据」。
- 格式校验：label/pcd 用 `isCocoDoc(obj)`（含 `images` 数组）；kpt 用 `isKptProject(obj)`（`obj.schema === 'kpt-label/v1'`）。不符拒加，不改内存。
- 保存目标文件名固定：label/pcd = `player_0.json`，kpt = `kpt_label_project.json`。
- 测试命令：`npm run test:web`，单文件 `node --test <path>`。
- 提交信息以 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` 结尾。

---

### Task 1: 格式校验纯函数模块

**Files:**
- Create: `label/src/io/anno_validate.js`
- Test: `label/tests/anno_validate.test.js`

**Interfaces:**
- Produces:
  - `isCocoDoc(obj): boolean` — `obj` 是非空对象且 `Array.isArray(obj.images)`。用于 label / pcd 加载校验。
  - `isKptProject(obj): boolean` — `obj` 是非空对象且 `obj.schema === 'kpt-label/v1'`。用于 kpt 加载校验。

- [ ] **Step 1: Write the failing test**

```js
// label/tests/anno_validate.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCocoDoc, isKptProject } from '../src/io/anno_validate.js';

test('isCocoDoc：含 images 数组为真', () => {
  assert.equal(isCocoDoc({ images: [], annotations: [] }), true);
  assert.equal(isCocoDoc({ images: [{ id: 0 }] }), true);
});

test('isCocoDoc：缺 images / 非数组 / 非对象为假', () => {
  assert.equal(isCocoDoc({ annotations: [] }), false);
  assert.equal(isCocoDoc({ images: 'x' }), false);
  assert.equal(isCocoDoc(null), false);
  assert.equal(isCocoDoc(42), false);
  assert.equal(isCocoDoc(undefined), false);
});

test('isKptProject：schema 精确匹配为真', () => {
  assert.equal(isKptProject({ schema: 'kpt-label/v1', images: [] }), true);
});

test('isKptProject：schema 不符 / 缺失 / 非对象为假', () => {
  assert.equal(isKptProject({ schema: 'kpt-label/v2' }), false);
  assert.equal(isKptProject({ images: [] }), false);
  assert.equal(isKptProject(null), false);
  assert.equal(isKptProject('kpt-label/v1'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test label/tests/anno_validate.test.js`
Expected: FAIL（`Cannot find module '../src/io/anno_validate.js'`）

- [ ] **Step 3: Write minimal implementation**

```js
// label/src/io/anno_validate.js
// 标注 JSON 的格式判据（纯函数，无 DOM/IO）。加载手动指定的 JSON 前用它确认
// 格式正确，避免把 kpt 工程加进 SMPL 标注器、或反之。
const isObj = (v) => typeof v === 'object' && v !== null;

// COCO 标注（label / pcd 的 player_0.json）：CocoDocument 的最小入参契约 = images 数组。
export function isCocoDoc(obj) {
  return isObj(obj) && Array.isArray(obj.images);
}

// kpt 工程（kpt_label_project.json）：由 KptStore.serialize 写出，schema 标记版本。
export function isKptProject(obj) {
  return isObj(obj) && obj.schema === 'kpt-label/v1';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test label/tests/anno_validate.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add label/src/io/anno_validate.js label/tests/anno_validate.test.js
git commit -m "feat(io): 标注 JSON 格式校验纯函数（isCocoDoc/isKptProject）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 共享 IO 能力——抗只读写入 + JSON 选择器

**Files:**
- Modify: `label/src/io/dir_source.js`（新增导出 + `writableAt`/`saveJson`/`writeFile` 改走 helper）

**Interfaces:**
- Consumes: 无（标准 File System Access API）。
- Produces：
  - `writeFileResilient(dirHandle, relPath, data): Promise<string>` — 沿 `relPath` 逐级 `getDirectoryHandle({create:true})`，对叶子文件 `createWritable` 写 `data`（string/Blob/BufferSource）；遇 `NoModificationAllowedError`/`InvalidStateError` 则 `removeEntry` 删旧文件后 `create:true` 重建再写；返回 `relPath`。
  - `jsonOpenSupported(): boolean` — `typeof window.showOpenFilePicker === 'function'`。
  - `pickJsonFile(): Promise<File>` — `showOpenFilePicker` 选一个 `.json`，返回 `File`。

说明：本任务无独立单测（纯浏览器 FS 句柄边界，按项目约定浏览器内验证）。验证靠 `npm run test:web` 不回归 + Task 6 浏览器验收。

- [ ] **Step 1: 新增 `writeFileResilient` helper（替换 `writableAt` 的内部写入语义）**

在 `label/src/io/dir_source.js` 顶部、`walk` 之后新增 helper，并改写 `writableAt` 调用方。先看现状（`writableAt` 返回一个未关闭的 writable，被 `saveJson`/`writeFile` 各自 `write`+`close`）。统一为「helper 内完成 write+close」，消除散落的 try/重试。

新增 helper：

```js
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
```

- [ ] **Step 2: 改写 `DirSource.saveJson` 与 `writeFile` 走 helper**

把 `saveJson` 与 `writeFile` 改为调用 `writeFileResilient`，删除旧的 `writableAt`（不再被使用）。改后：

```js
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
```

删除文件中现有的 `writableAt` 函数定义（约 44-52 行那段），其唯一调用方已改走 helper。

- [ ] **Step 3: 新增 JSON 选择器导出**

在 `videoOpenSupported`/`pickVideoFile` 之后新增（紧邻、风格一致）：

```js
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
```

- [ ] **Step 4: 跑全量 web 测试确认无回归**

Run: `npm run test:web`
Expected: PASS（含 Task 1 新增，无失败）

- [ ] **Step 5: Commit**

```bash
git add label/src/io/dir_source.js
git commit -m "feat(io): 抗只读写入 writeFileResilient + pickJsonFile（共享 IO）

删重建同名文件以绕过 OS 只读目标；saveJson/writeFile 统一走 helper。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: pcd 写入复用 helper + 加载 JSON 入口

**Files:**
- Modify: `pcd_label/src/io/pcd_dir_source.js`（`saveAnnotation` 走 helper；新增 `loadAnnotationFile`）
- Modify: `pcd_label/index.html`（加载按钮 + 隐藏 file input）
- Modify: `pcd_label/src/app.js`（接线加载入口）

**Interfaces:**
- Consumes: `writeFileResilient` from `../../../label/src/io/dir_source.js`；`isCocoDoc` from `../../../label/src/io/anno_validate.js`。
- Produces: app 内 `loadAnnotationJson()` 流程；`PcdDirSource.saveAnnotation` 抗只读。

- [ ] **Step 1: pcd `saveAnnotation` 改走共享 helper**

编辑 `pcd_label/src/io/pcd_dir_source.js`。顶部 import 旁加：

```js
import { writeFileResilient } from '../../../label/src/io/dir_source.js';
```

把 `PcdDirSource.saveAnnotation` 改为：

```js
  async saveAnnotation(obj) {
    await writeFileResilient(this._dir, ANNO_NAME, JSON.stringify(obj, null, 2));
    return ANNO_NAME;
  }
```

（删除原 `getFileHandle`/`createWritable`/`write`/`close` 四行。）

- [ ] **Step 2: pcd index.html 加「加载标注 JSON」入口**

编辑 `pcd_label/index.html`，把现有单按钮区（约 76-78 行）改为打开按钮 + 并列加载按钮 + 两个隐藏 input：

```html
    <button id="btn-open" class="primary" style="width:100%">📂 打开序列目录</button>
    <button id="btn-load-json" style="width:100%;margin-top:4px" disabled>📥 加载标注 JSON</button>
    <input id="dir-input" type="file" webkitdirectory directory multiple hidden>
    <input id="json-input" type="file" accept=".json" hidden>
    <div class="hint" id="open-hint">Chrome/Edge 可原地保存写回目录;Firefox/Safari 仅能下载 JSON,需手动覆盖回数据目录</div>
```

- [ ] **Step 3: pcd app.js 接线加载流程**

编辑 `pcd_label/src/app.js`。在 import 区加：

```js
import { jsonOpenSupported, pickJsonFile } from '../../label/src/io/dir_source.js';
import { isCocoDoc } from '../../label/src/io/anno_validate.js';
```

在 `mountSequence()` 末尾（`setStatus(\`已加载 ${manifest.frameCount} 帧\`);` 之后）加一行启用加载按钮：

```js
  $('btn-load-json').disabled = false;
```

新增加载函数（放在 `saveAnnotation` 之后）：

```js
// 手动加载标注 JSON：覆盖内存的 SMPL 标注，保存仍写回当前序列目录的 player_0.json。
// 需先打开序列目录（按钮在 mountSequence 后才启用）。
async function loadAnnotationJson(file) {
  const raw = JSON.parse(await file.text());
  if (!isCocoDoc(raw)) { setStatus('该文件不是 SMPL 标注（COCO）格式，未加载'); return; }
  store = new AnnotationStore(new CocoDocument(raw));
  ui = new UIController({ modes: ['root', 'pose', 'beta'] });
  if (syncUI) ui.onChange(syncUI);
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
  await showFrame(Math.min(store.currentFrame(), store.frameCount() - 1));
  setStatus(`已加载标注 JSON（${file.name}）— 保存写回 player_0.json`);
}
```

在 `boot()` 内 `$('btn-save')` 接线附近加按钮接线：

```js
  $('btn-load-json').addEventListener('click', () => {
    if (!store) { setStatus('请先打开序列目录'); return; }
    if (jsonOpenSupported()) {
      pickJsonFile().then((f) => loadAnnotationJson(f)).catch((e) => { if (e?.name !== 'AbortError') setStatus(String(e)); });
    } else { $('json-input').click(); }
  });
  $('json-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0]; if (f) loadAnnotationJson(f).catch((err) => setStatus(String(err)));
    e.target.value = '';
  });
```

- [ ] **Step 4: 跑全量 web 测试确认无回归**

Run: `npm run test:web`
Expected: PASS（pcd 无单测，确认 import 路径不破坏其他测试）

- [ ] **Step 5: Commit**

```bash
git add pcd_label/src/io/pcd_dir_source.js pcd_label/index.html pcd_label/src/app.js
git commit -m "feat(pcd): 加载标注 JSON 入口 + 抗只读保存

saveAnnotation 复用 writeFileResilient；新增加载按钮（先打开目录后启用）。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: label 加载 JSON 入口

**Files:**
- Modify: `label/index.html`（下拉菜单加第三项）
- Modify: `label/src/app.js`（接线加载流程）

**Interfaces:**
- Consumes: `pickJsonFile`, `jsonOpenSupported` from `./io/dir_source.js`；`isCocoDoc` from `./io/anno_validate.js`。
- Produces: app 内 `loadAnnotationJson()` 流程。保存路径（`saveJson`）已通过 Task 2 的 `DirSource.saveJson` 自动获得抗只读能力，无需改 app。

- [ ] **Step 1: label index.html 下拉加第三项 + 隐藏 input**

编辑 `label/index.html`。`#open-menu` 内（约 76-78 行）加第三项；并在 `#dir-input` 旁加 `#json-input`：

```html
      <div id="open-menu" hidden>
        <button id="open-dir">📁 图像/标注目录</button>
        <button id="open-video">🎬 视频文件</button>
        <button id="open-json">📥 加载标注 JSON</button>
      </div>
    </div>
    <input id="dir-input" type="file" webkitdirectory directory multiple hidden>
    <input id="json-input" type="file" accept=".json" hidden>
```

- [ ] **Step 2: label app.js 加载流程**

编辑 `label/src/app.js`。import 区把现有 dir_source import 补上两个名字，并加校验 import：

```js
import { fsAccessSupported, pickDirectory, DirSource, videoOpenSupported, pickVideoFile, jsonOpenSupported, pickJsonFile } from './io/dir_source.js';
import { isCocoDoc } from './io/anno_validate.js';
```

新增加载函数（放在 `saveJson` 之后）。沿用 `resetFromDisk` 的 store 重建方式，要求已打开数据（`store` 存在）：

```js
// 手动加载标注 JSON：覆盖内存的标注，保存仍写回已打开目录的标准 json。
// 需先打开数据（store 存在）；保留当前帧。
async function loadAnnotationJson(file) {
  if (!store) { setStatus('请先打开数据（目录/视频）'); return; }
  const raw = JSON.parse(await file.text());
  if (!isCocoDoc(raw)) { setStatus('该文件不是 SMPL 标注（COCO）格式，未加载'); return; }
  store = new AnnotationStore(new CocoDocument(raw));
  ui = new UIController({ readOnly, modes: editorModes });
  if (syncUI) ui.onChange(syncUI);
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
  await showFrame(Math.min(store.currentFrame(), store.frameCount() - 1));
  setStatus(`已加载标注 JSON（${file.name}）`);
}
```

在 `boot()` 内 `$('open-video')` 接线之后加：

```js
  $('open-json').addEventListener('click', () => {
    $('open-menu').hidden = true;
    if (!store) { setStatus('请先打开数据（目录/视频）'); return; }
    if (jsonOpenSupported()) {
      pickJsonFile().then((f) => loadAnnotationJson(f)).catch(onLoadError);
    } else { $('json-input').click(); }
  });
  $('json-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0]; if (f) loadAnnotationJson(f).catch(onLoadError);
    e.target.value = '';
  });
```

- [ ] **Step 3: 跑全量 web 测试确认无回归**

Run: `npm run test:web`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add label/index.html label/src/app.js
git commit -m "feat(label): 加载标注 JSON 入口（并入选择数据下拉）

校验 COCO 格式后覆盖内存，保存仍写回目录标准 json（已具抗只读）。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: kpt 加载 JSON 入口

**Files:**
- Modify: `kpt_label/index.html`（下拉菜单加项 + 隐藏 input）
- Modify: `kpt_label/src/app.js`（接线加载流程）

**Interfaces:**
- Consumes: `pickJsonFile`, `jsonOpenSupported` from `../../label/src/io/dir_source.js`；`isKptProject` from `../../label/src/io/anno_validate.js`；现有 `KptStore.fromJSON`。
- Produces: app 内 `loadProjectJson()` 流程。保存路径（`saveProject` → `DirSource.writeFile`）已通过 Task 2 自动抗只读。

- [ ] **Step 1: kpt index.html 下拉加项 + 隐藏 input**

编辑 `kpt_label/index.html`。`#open-menu` 内（约 50-52 行）加项；并在菜单容器后加隐藏 input：

```html
      <div id="open-menu" hidden>
        <button id="open-dir">📁 图像目录</button>
        <button id="open-video">🎬 视频文件</button>
        <button id="open-json">📥 加载标注 JSON</button>
      </div>
    </div>
    <input id="json-input" type="file" accept=".json" hidden>
```

- [ ] **Step 2: kpt app.js 加载流程**

编辑 `kpt_label/src/app.js`。import 区把现有 dir_source import 补上两个名字，并加校验 import：

```js
import { DirSource, fsAccessSupported, pickDirectory, videoOpenSupported, pickVideoFile, jsonOpenSupported, pickJsonFile } from '../../label/src/io/dir_source.js';
import { isKptProject } from '../../label/src/io/anno_validate.js';
```

新增加载函数（放在 `saveProject` 之后）。沿用 `openDirectory` 的续标重建方式，要求已打开数据（`state.store` 存在）：

```js
// 手动加载 kpt 工程 JSON：覆盖内存，保存仍写回已打开目录的 PROJECT_FILE。
// 需先打开数据；用工程的 images[] 重建（fromJSON 往返保真），保留当前帧。
async function loadProjectJson(file) {
  if (!state.store) { $('status').textContent = '请先打开数据（图像目录/视频）'; return; }
  const obj = JSON.parse(await file.text());
  if (!isKptProject(obj)) { $('status').textContent = '该文件不是 kpt 工程（schema 不符），未加载'; return; }
  const at = state.store.currentFrame();
  state.store = KptStore.fromJSON(obj, skel.names.length);
  $('frame-slider').max = String(state.store.frameCount() - 1);
  await loadFrame(Math.min(at, state.store.frameCount() - 1));
  $('status').textContent = `已加载工程（${file.name}）`;
}
```

在 `boot()` 区 `$('open-video')` 接线之后加（与现有菜单接线同风格）：

```js
$('open-json').addEventListener('click', () => {
  $('open-menu').hidden = true;
  if (!state.store) { $('status').textContent = '请先打开数据（图像目录/视频）'; return; }
  if (jsonOpenSupported()) { pickJsonFile().then((f) => loadProjectJson(f)).catch(reportErr); }
  else { $('json-input').click(); }
});
$('json-input').addEventListener('change', (e) => {
  const f = e.target.files?.[0]; if (f) loadProjectJson(f).catch(reportErr);
  e.target.value = '';
});
```

- [ ] **Step 3: 跑全量 web 测试确认无回归**

Run: `npm run test:web`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add kpt_label/index.html kpt_label/src/app.js
git commit -m "feat(kpt): 加载工程 JSON 入口（并入选择数据下拉）

校验 schema 后用 fromJSON 重建，保存仍写回 PROJECT_FILE（已具抗只读）。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 浏览器验收（手动）

**Files:** 无改动——仅手动验证。

**Interfaces:** 无。

- [ ] **Step 1: 只读保存验收（问题 2）**

在 Chrome 准备一个含 **只读** `player_0.json`（`chmod 0444 player_0.json`）的 pcd 序列目录。`npm run serve:pcd`，打开 `/pcd_label/`，打开该目录，新建/编辑一帧标注，点「保存标注」。
Expected: 状态栏「已保存 player_0.json」，无 `NoModificationAllowedError`；磁盘上文件被更新。label / kpt 同法各验一次（label 用只读 `player_0.json`，kpt 用只读 `kpt_label_project.json`）。

- [ ] **Step 2: 加载 JSON 验收（问题 1）**

每个 app：先打开数据目录，点「加载标注 JSON」选一份**正确格式**的 JSON。
Expected: 内存被覆盖并渲染；再点保存，写回目录标准文件名。
再选一份**错误格式**（如把 kpt 工程喂给 label）。
Expected: 状态栏提示格式不符，内存不变（画面不动）。
未打开数据时点加载入口。
Expected: 提示「请先打开数据」。

- [ ] **Step 3: 记录验收结果**

在 PR 描述或对话中记录三个 app 的 Step 1/2/3 实测结果（通过/异常）。
