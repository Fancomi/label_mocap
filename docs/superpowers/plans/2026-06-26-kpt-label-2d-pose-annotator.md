# kpt_label 2D 人体关键点+框标注工具 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建独立纯 2D Web app `kpt_label/`，标注多人「框 + COCO-17 关键点」，导出可直接训练的 Ultralytics YOLO-pose 数据集。

**Architecture:** 纯 2D（无 three.js / 无 SMPL）。复用 `label/src/scene/view_zoom.js` 视口数学与 `label/src/io/*` 的目录/帧/视频 IO。新建独立多人标注模型 `kpt_store`，保真中间 JSON 工作格式，一键导出 YOLO `images/ labels/ + dataset.yaml`。Canvas 主渲染 + SVG 人体图选关节 + 最近邻命中测试。

**Tech Stack:** 原生 ES modules、Canvas 2D、SVG、File System Access API；测试用 `node --test`（纯逻辑）+ Python stdlib 校验脚本（YOLO 格式）。

**复用约定（直接 import，不改原文件）：**
- `../../label/src/scene/view_zoom.js` — `computeWindow/zoomAtSolve/imageToCanvasNorm/canvasNormToImage/clampPan`，常量 `ZOOM_MIN/ZOOM_MAX`。**调用时令 `cx=imageW/2, cy=imageH/2`**，使基准窗口左上为 (0,0)、画布归一化直接覆盖整图。
- `../../label/src/io/image_order.js` — `orderedImageNames/basename`
- `../../label/src/io/dataset_paths.js` — `classifyEntries`
- `../../label/src/io/source_loader.js` — `assertHasContent/isPortrait`
- `../../label/src/io/dir_source.js` — `DirSource/pickDirectory/fsAccessSupported/videoOpenSupported/pickVideoFile`
- `../../label/src/io/video_source.js` — 视频帧（浏览器内）
- `../../label/src/io/image_bytes.js` — base64（浏览器内）

**测试命令前置：** 计划中所有 `node --test kpt_label/tests/...` 在仓库根目录执行。最终在 `package.json` 的 `test:web` glob 追加 `kpt_label/tests/*.test.js`（Task 11）。

---

### Task 1: skeleton 配置（COCO-17，配置驱动）

**Files:**
- Create: `kpt_label/src/skeleton.js`
- Test: `kpt_label/tests/skeleton.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
// kpt_label/tests/skeleton.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COCO17, getSkeleton } from '../src/skeleton.js';

test('COCO17 有 17 个关节，名称不重复', () => {
  assert.equal(COCO17.names.length, 17);
  assert.equal(new Set(COCO17.names).size, 17);
});

test('flip_idx 长度 = 关节数，且为合法置换', () => {
  assert.equal(COCO17.flip_idx.length, 17);
  const sorted = [...COCO17.flip_idx].sort((a, b) => a - b);
  assert.deepEqual(sorted, Array.from({ length: 17 }, (_, i) => i));
});

test('flip_idx 对称：flip(flip(i)) === i', () => {
  COCO17.flip_idx.forEach((j, i) => assert.equal(COCO17.flip_idx[j], i));
});

test('edges 索引合法（0..16）', () => {
  for (const [a, b] of COCO17.edges) {
    assert.ok(a >= 0 && a < 17 && b >= 0 && b < 17, `bad edge ${a},${b}`);
  }
});

test('layout 覆盖全部关节，坐标归一化到 [0,1]', () => {
  assert.equal(COCO17.layout.length, 17);
  for (const p of COCO17.layout) {
    assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, `bad layout ${p.name}`);
    assert.ok(COCO17.names.includes(p.name), `unknown joint ${p.name}`);
  }
});

test('getSkeleton 默认返回 COCO17', () => {
  assert.equal(getSkeleton('coco17'), COCO17);
  assert.equal(getSkeleton(), COCO17);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test kpt_label/tests/skeleton.test.js`
Expected: FAIL（`Cannot find module '../src/skeleton.js'`）

- [ ] **Step 3: 实现 skeleton.js**

COCO-17 标准顺序：0 nose,1 left_eye,2 right_eye,3 left_ear,4 right_ear,5 left_shoulder,6 right_shoulder,7 left_elbow,8 right_elbow,9 left_wrist,10 right_wrist,11 left_hip,12 right_hip,13 left_knee,14 right_knee,15 left_ankle,16 right_ankle。

```javascript
// kpt_label/src/skeleton.js
// 配置驱动的关键点骨架定义。换骨架只需新增一个同形对象并在 REGISTRY 注册。
// names.length 自动驱动 YOLO 的 kpt_shape=[N,3]。
export const COCO17 = {
  id: 'coco17',
  names: [
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  ],
  // 骨架连线（画线用），COCO 标准连接。
  edges: [
    [0, 1], [0, 2], [1, 3], [2, 4],          // 头部
    [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],  // 双臂
    [5, 11], [6, 12], [11, 12],               // 躯干
    [11, 13], [13, 15], [12, 14], [14, 16],   // 双腿
  ],
  // 水平翻转时关节索引互换（左右镜像）。导出 dataset.yaml 用。
  flip_idx: [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15],
  // SVG 人体图归一化坐标（正面视角，x 右为正、y 下为正）。
  layout: [
    { name: 'nose', x: 0.50, y: 0.10 },
    { name: 'left_eye', x: 0.45, y: 0.07 },
    { name: 'right_eye', x: 0.55, y: 0.07 },
    { name: 'left_ear', x: 0.40, y: 0.10 },
    { name: 'right_ear', x: 0.60, y: 0.10 },
    { name: 'left_shoulder', x: 0.38, y: 0.25 },
    { name: 'right_shoulder', x: 0.62, y: 0.25 },
    { name: 'left_elbow', x: 0.30, y: 0.42 },
    { name: 'right_elbow', x: 0.70, y: 0.42 },
    { name: 'left_wrist', x: 0.26, y: 0.58 },
    { name: 'right_wrist', x: 0.74, y: 0.58 },
    { name: 'left_hip', x: 0.43, y: 0.55 },
    { name: 'right_hip', x: 0.57, y: 0.55 },
    { name: 'left_knee', x: 0.42, y: 0.75 },
    { name: 'right_knee', x: 0.58, y: 0.75 },
    { name: 'left_ankle', x: 0.42, y: 0.95 },
    { name: 'right_ankle', x: 0.58, y: 0.95 },
  ],
};

const REGISTRY = { coco17: COCO17 };

export function getSkeleton(id = 'coco17') {
  return REGISTRY[id] ?? COCO17;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test kpt_label/tests/skeleton.test.js`
Expected: PASS（6 个测试）

- [ ] **Step 5: 提交**

```bash
git add kpt_label/src/skeleton.js kpt_label/tests/skeleton.test.js
git commit -m "feat(kpt): COCO-17 配置驱动骨架定义"
```

---

### Task 2: kpt_store 多人标注模型（核心状态）

**Files:**
- Create: `kpt_label/src/kpt_store.js`
- Test: `kpt_label/tests/kpt_store.test.js`

数据形：一帧持有有序 `persons` 列表，每人 `{ id, bbox:[x,y,w,h]|null, keypoints: Array(N) of [x,y,v] }`。`store` 跨帧持有所有帧的标注，按 `image_idx` 索引。N 由 skeleton 决定。

- [ ] **Step 1: 写失败测试**

```javascript
// kpt_label/tests/kpt_store.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KptStore } from '../src/kpt_store.js';

const mk = () => new KptStore({
  images: [{ file_name: 'a.jpg', width: 100, height: 100 },
           { file_name: 'b.jpg', width: 100, height: 100 }],
  nkpt: 17,
});

test('初始：每帧 0 人，无选中', () => {
  const s = mk();
  assert.equal(s.frameCount(), 2);
  assert.equal(s.persons().length, 0);
  assert.equal(s.selectedId(), null);
});

test('addPerson：新建人、自动选中、id 递增、keypoints 定长全 0', () => {
  const s = mk();
  const p = s.addPerson();
  assert.equal(p.id, 1);
  assert.equal(s.selectedId(), 1);
  assert.equal(p.bbox, null);
  assert.equal(p.keypoints.length, 17);
  assert.deepEqual(p.keypoints[0], [0, 0, 0]);
  assert.equal(s.addPerson().id, 2);
});

test('id 在同一帧内唯一且不复用已删 id', () => {
  const s = mk();
  s.addPerson(); s.addPerson();      // 1, 2
  s.select(1); s.deletePerson();     // 删 1
  assert.equal(s.addPerson().id, 3); // 不复用 1
});

test('select / deletePerson：删后选中切到剩余首个或 null', () => {
  const s = mk();
  s.addPerson(); s.addPerson();      // 1,2 选中 2
  s.select(1); s.deletePerson();
  assert.equal(s.selectedId(), 2);
  s.deletePerson();
  assert.equal(s.selectedId(), null);
});

test('setKeypoint：写入选中人的某关节 [x,y,v]', () => {
  const s = mk();
  s.addPerson();
  s.setKeypoint(5, 30, 40, 2);
  assert.deepEqual(s.persons()[0].keypoints[5], [30, 40, 2]);
});

test('setBbox：写入选中人的框', () => {
  const s = mk();
  s.addPerson();
  s.setBbox([10, 20, 30, 40]);
  assert.deepEqual(s.persons()[0].bbox, [10, 20, 30, 40]);
});

test('帧切换隔离：不同帧 persons 互不影响', () => {
  const s = mk();
  s.addPerson();
  s.setFrame(1);
  assert.equal(s.persons().length, 0);
  s.addPerson();
  s.setFrame(0);
  assert.equal(s.persons().length, 1);
});

test('undo 还原 addPerson / setKeypoint / deletePerson', () => {
  const s = mk();
  s.addPerson();
  s.setKeypoint(0, 5, 5, 2);
  s.undo();                                   // 撤销 setKeypoint
  assert.deepEqual(s.persons()[0].keypoints[0], [0, 0, 0]);
  s.undo();                                   // 撤销 addPerson
  assert.equal(s.persons().length, 0);
});

test('serialize 产出保真中间 JSON', () => {
  const s = mk();
  s.addPerson();
  s.setBbox([1, 2, 3, 4]);
  s.setKeypoint(0, 5, 6, 2);
  const obj = s.serialize();
  assert.equal(obj.schema, 'kpt-label/v1');
  assert.equal(obj.skeleton, 'coco17');
  assert.equal(obj.images.length, 2);
  assert.equal(obj.annotations[0].image_idx, 0);
  assert.deepEqual(obj.annotations[0].persons[0].bbox, [1, 2, 3, 4]);
  assert.deepEqual(obj.annotations[0].persons[0].keypoints[0], [5, 6, 2]);
});

test('fromJSON ⟷ serialize 往返一致', () => {
  const s = mk();
  s.addPerson(); s.setBbox([1, 2, 3, 4]); s.setKeypoint(1, 7, 8, 1);
  const obj = s.serialize();
  const s2 = KptStore.fromJSON(obj, 17);
  assert.deepEqual(s2.serialize(), obj);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test kpt_label/tests/kpt_store.test.js`
Expected: FAIL（`Cannot find module '../src/kpt_store.js'`）

- [ ] **Step 3: 实现 kpt_store.js**

```javascript
// kpt_label/src/kpt_store.js
// 多人 2D 标注模型（纯逻辑，无 DOM）。一帧 = 有序 persons 列表。
// 每人：{ id, bbox:[x,y,w,h]|null, keypoints: Array(nkpt) of [x,y,v] }。
// 撤销：每个写操作前快照该帧 persons，commit 时入栈。
const clone = (v) => structuredClone(v);

export class KptStore {
  constructor({ images, skeleton = 'coco17', nkpt }) {
    this._images = images.map((im) => ({ file_name: im.file_name, width: im.width, height: im.height }));
    this._skeleton = skeleton;
    this._nkpt = nkpt;
    this._frames = images.map(() => ({ persons: [] }));   // 按 image_idx
    this._nextId = images.map(() => 1);                   // 每帧独立、单调递增的 id 计数
    this._frame = 0;
    this._sel = null;                                     // 选中 person id（本帧）
    this._undo = [];
    this._pending = null;                                 // 拖拽事务快照
  }

  static fromJSON(obj, nkpt) {
    const s = new KptStore({ images: obj.images, skeleton: obj.skeleton, nkpt });
    for (const ann of obj.annotations ?? []) {
      const f = s._frames[ann.image_idx];
      if (!f) continue;
      f.persons = (ann.persons ?? []).map((p) => ({
        id: p.id,
        bbox: p.bbox ? p.bbox.slice() : null,
        keypoints: p.keypoints.map((k) => k.slice()),
      }));
      const maxId = f.persons.reduce((m, p) => Math.max(m, p.id), 0);
      s._nextId[ann.image_idx] = maxId + 1;
    }
    return s;
  }

  frameCount() { return this._frames.length; }
  setFrame(i) { this._frame = i; this._sel = null; }
  currentFrame() { return this._frame; }
  imageInfo(i = this._frame) { return this._images[i]; }
  persons() { return this._frames[this._frame].persons; }
  selectedId() { return this._sel; }
  selected() { return this.persons().find((p) => p.id === this._sel) ?? null; }
  select(id) { this._sel = this.persons().some((p) => p.id === id) ? id : null; }

  _emptyKpts() { return Array.from({ length: this._nkpt }, () => [0, 0, 0]); }
  _snapshot() { return clone(this._frames[this._frame].persons); }
  _commit(before) { this._undo.push({ frame: this._frame, before, selBefore: this._sel }); }
  _txn(fn) { const before = this._snapshot(); const sel = this._sel; fn(); this._undo.push({ frame: this._frame, before, selBefore: sel }); }

  addPerson() {
    let p;
    this._txn(() => {
      p = { id: this._nextId[this._frame]++, bbox: null, keypoints: this._emptyKpts() };
      this.persons().push(p);
      this._sel = p.id;
    });
    return p;
  }

  deletePerson() {
    if (this._sel == null) return;
    this._txn(() => {
      const list = this.persons();
      const i = list.findIndex((p) => p.id === this._sel);
      if (i >= 0) list.splice(i, 1);
      this._sel = list.length ? list[0].id : null;
    });
  }

  setBbox(bbox) {
    if (this._sel == null) return;
    this._txn(() => { this.selected().bbox = bbox ? bbox.slice() : null; });
  }

  setKeypoint(idx, x, y, v) {
    if (this._sel == null) return;
    this._txn(() => { this.selected().keypoints[idx] = [x, y, v]; });
  }

  // 拖拽事务：begin → applyKeypoint*/applyBbox* → commit（一个 undo 单元）。
  beginEdit() { if (this._pending === null) this._pending = this._snapshot(); }
  applyKeypoint(idx, x, y, v) { const p = this.selected(); if (p) p.keypoints[idx] = [x, y, v]; }
  applyBbox(bbox) { const p = this.selected(); if (p) p.bbox = bbox ? bbox.slice() : null; }
  commitEdit() {
    if (this._pending === null) return;
    this._commit(this._pending);
    this._pending = null;
  }

  undo() {
    const u = this._undo.pop();
    if (!u) return;
    this._frames[u.frame].persons = u.before;
    if (u.frame === this._frame) this._sel = u.selBefore;
  }

  serialize() {
    return {
      schema: 'kpt-label/v1',
      skeleton: this._skeleton,
      images: this._images.map((im) => ({ ...im })),
      annotations: this._frames.map((f, image_idx) => ({
        image_idx,
        persons: f.persons.map((p) => ({
          id: p.id,
          bbox: p.bbox ? p.bbox.slice() : null,
          keypoints: p.keypoints.map((k) => k.slice()),
        })),
      })),
    };
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test kpt_label/tests/kpt_store.test.js`
Expected: PASS（10 个测试）

- [ ] **Step 5: 提交**

```bash
git add kpt_label/src/kpt_store.js kpt_label/tests/kpt_store.test.js
git commit -m "feat(kpt): 多人标注模型 KptStore + 撤销 + 序列化"
```

---

### Task 3: bbox_geom 纯几何（画框/拖角/点包围盒补齐）

**Files:**
- Create: `kpt_label/src/bbox_geom.js`
- Test: `kpt_label/tests/bbox_geom.test.js`

`resizeBboxByCorner` 直接复用 `label` 的实现思路（重写一份避免跨 app 深耦合到 projection.js）。`bboxFromKeypoints` 是新逻辑：取 v>0 的点求包围盒 + 边距，裁剪到图像内。

- [ ] **Step 1: 写失败测试**

```javascript
// kpt_label/tests/bbox_geom.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resizeBboxByCorner, normRect, bboxFromKeypoints } from '../src/bbox_geom.js';

test('resizeBboxByCorner：拖右下角', () => {
  assert.deepEqual(resizeBboxByCorner([10, 10, 20, 20], 'br', [50, 60]), [10, 10, 40, 50]);
});

test('resizeBboxByCorner：拖左上角，对角固定', () => {
  assert.deepEqual(resizeBboxByCorner([10, 10, 20, 20], 'tl', [5, 5]), [5, 5, 25, 25]);
});

test('resizeBboxByCorner：拖动越过对角仍得正矩形', () => {
  assert.deepEqual(resizeBboxByCorner([10, 10, 20, 20], 'br', [0, 0]), [0, 0, 10, 10]);
});

test('normRect：两点 → [x,y,w,h]，规整顺序', () => {
  assert.deepEqual(normRect(50, 60, 10, 20), [10, 20, 40, 40]);
});

test('bboxFromKeypoints：取 v>0 点包围盒 + 边距，裁到图像内', () => {
  const kpts = [[20, 30, 2], [60, 80, 1], [0, 0, 0], [10, 10, 0]];
  // 可见点范围 x:[20,60] y:[30,80]，5% 边距 = 2,2.5
  const b = bboxFromKeypoints(kpts, { width: 200, height: 200, margin: 0.05 });
  assert.deepEqual(b, [18, 27.5, 44, 55]);
});

test('bboxFromKeypoints：边距裁剪不出界', () => {
  const kpts = [[0, 0, 2], [200, 200, 2]];
  const b = bboxFromKeypoints(kpts, { width: 200, height: 200, margin: 0.5 });
  assert.deepEqual(b, [0, 0, 200, 200]);
});

test('bboxFromKeypoints：无可见点返回 null', () => {
  assert.equal(bboxFromKeypoints([[1, 2, 0], [3, 4, 0]], { width: 100, height: 100 }), null);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test kpt_label/tests/bbox_geom.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 bbox_geom.js**

```javascript
// kpt_label/src/bbox_geom.js
// 2D 框纯几何（无 DOM）。坐标均为图像像素。
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// corner: 'tl'|'tr'|'bl'|'br'，对角固定。返回规整 [x,y,w,h]。
export function resizeBboxByCorner([x, y, w, h], corner, [px, py]) {
  let x0 = x, y0 = y, x1 = x + w, y1 = y + h;
  if (corner === 'tl') { x0 = px; y0 = py; }
  else if (corner === 'tr') { x1 = px; y0 = py; }
  else if (corner === 'bl') { x0 = px; y1 = py; }
  else if (corner === 'br') { x1 = px; y1 = py; }
  return normRect(x0, y0, x1, y1);
}

// 两个对角点 → 规整 [x,y,w,h]（左上 + 正宽高）。
export function normRect(ax, ay, bx, by) {
  return [Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)];
}

// 由 v>0 的关键点求包围盒 + margin（占点云跨度比例），裁剪到图像内。
// 无可见点返回 null。
export function bboxFromKeypoints(keypoints, { width, height, margin = 0.05 }) {
  const pts = keypoints.filter((k) => k[2] > 0);
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const mx = (maxX - minX) * margin;
  const my = (maxY - minY) * margin;
  const x0 = clamp(minX - mx, 0, width);
  const y0 = clamp(minY - my, 0, height);
  const x1 = clamp(maxX + mx, 0, width);
  const y1 = clamp(maxY + my, 0, height);
  return [x0, y0, x1 - x0, y1 - y0];
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test kpt_label/tests/bbox_geom.test.js`
Expected: PASS（7 个测试）

- [ ] **Step 5: 提交**

```bash
git add kpt_label/src/bbox_geom.js kpt_label/tests/bbox_geom.test.js
git commit -m "feat(kpt): bbox 纯几何 — 拖角/规整/点包围盒补齐"
```

---

### Task 4: yolo_export 导出（最关键，格式正确性）

**Files:**
- Create: `kpt_label/src/yolo_export.js`
- Test: `kpt_label/tests/yolo_export.test.js`

把中间 JSON 转 YOLO：每人一行 `class cx cy w h (x y v)*N`（全部归一化），无框者用 `bboxFromKeypoints` 补；生成 `dataset.yaml` 文本；按 valRatio 确定性分配 train/val。

- [ ] **Step 1: 写失败测试**

```javascript
// kpt_label/tests/yolo_export.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { personToYoloLine, imageLabelText, datasetYaml, buildExport } from '../src/yolo_export.js';
import { COCO17 } from '../src/skeleton.js';

const IMG = { width: 100, height: 200 };

test('personToYoloLine：归一化 bbox(中心) + 关键点，字段数 = 5 + N*3', () => {
  const p = { bbox: [10, 20, 30, 40], keypoints: Array.from({ length: 17 }, () => [0, 0, 0]) };
  p.keypoints[0] = [50, 100, 2];
  const nums = personToYoloLine(p, IMG, COCO17).split(' ').map(Number);
  assert.equal(nums.length, 5 + 17 * 3);
  assert.equal(nums[0], 0);
  assert.ok(Math.abs(nums[1] - 0.25) < 1e-9);  // cx=(10+15)/100
  assert.ok(Math.abs(nums[2] - 0.20) < 1e-9);  // cy=(20+20)/200
  assert.ok(Math.abs(nums[3] - 0.30) < 1e-9);  // w=30/100
  assert.ok(Math.abs(nums[4] - 0.20) < 1e-9);  // h=40/200
  assert.ok(Math.abs(nums[5] - 0.50) < 1e-9);  // kp0 x=50/100
  assert.ok(Math.abs(nums[6] - 0.50) < 1e-9);  // kp0 y=100/200
  assert.equal(nums[7], 2);
});

test('personToYoloLine：v=0 点输出 0 0 0', () => {
  const p = { bbox: [0, 0, 10, 10], keypoints: Array.from({ length: 17 }, () => [0, 0, 0]) };
  const nums = personToYoloLine(p, IMG, COCO17).split(' ').map(Number);
  assert.deepEqual(nums.slice(5, 8), [0, 0, 0]);
});

test('personToYoloLine：无框者用关键点包围盒补齐', () => {
  const kpts = Array.from({ length: 17 }, () => [0, 0, 0]);
  kpts[0] = [20, 40, 2]; kpts[1] = [60, 120, 2];
  const nums = personToYoloLine({ bbox: null, keypoints: kpts }, IMG, COCO17).split(' ').map(Number);
  // 包围盒 x:[20,60] y:[40,120] +5%边距对称 → 中心 (40,80) 归一化 (0.4,0.4)
  assert.ok(Math.abs(nums[1] - 0.40) < 1e-9);
  assert.ok(Math.abs(nums[2] - 0.40) < 1e-9);
});

test('personToYoloLine：无框且无可见点 → null', () => {
  const p = { bbox: null, keypoints: Array.from({ length: 17 }, () => [0, 0, 0]) };
  assert.equal(personToYoloLine(p, IMG, COCO17), null);
});

test('imageLabelText：多人多行；无人空串', () => {
  const persons = [
    { bbox: [0, 0, 10, 10], keypoints: Array.from({ length: 17 }, () => [0, 0, 0]) },
    { bbox: [50, 50, 10, 10], keypoints: Array.from({ length: 17 }, () => [0, 0, 0]) },
  ];
  assert.equal(imageLabelText(persons, IMG, COCO17).split('\n').length, 2);
  assert.equal(imageLabelText([], IMG, COCO17), '');
});

test('datasetYaml：含 kpt_shape/flip_idx/names/nc/train/val', () => {
  const y = datasetYaml(COCO17, { hasVal: true });
  assert.match(y, /kpt_shape: \[17, 3\]/);
  assert.match(y, /flip_idx: \[0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15\]/);
  assert.match(y, /nc: 1/);
  assert.match(y, /train: images\/train/);
  assert.match(y, /val: images\/val/);
});

test('datasetYaml：无 val 时 val 指向 train', () => {
  assert.match(datasetYaml(COCO17, { hasVal: false }), /val: images\/train/);
});

test('buildExport：valRatio=0 全 train；标签与图像一一对应、无人空 txt', () => {
  const doc = {
    schema: 'kpt-label/v1', skeleton: 'coco17',
    images: [{ file_name: 'a.jpg', width: 100, height: 200 },
             { file_name: 'b.jpg', width: 100, height: 200 }],
    annotations: [
      { image_idx: 0, persons: [{ bbox: [0, 0, 10, 10], keypoints: Array.from({ length: 17 }, () => [0, 0, 0]) }] },
      { image_idx: 1, persons: [] },
    ],
  };
  const out = buildExport(doc, COCO17, { valRatio: 0 });
  const files = Object.fromEntries(out.labelFiles.map((f) => [f.path, f.text]));
  assert.ok('labels/train/a.txt' in files);
  assert.equal(files['labels/train/b.txt'], '');
  assert.equal(out.images[0].split, 'train');
  assert.match(out.yaml, /val: images\/train/);
});

test('buildExport：valRatio=0.5 时部分进 val', () => {
  const doc = {
    schema: 'kpt-label/v1', skeleton: 'coco17',
    images: Array.from({ length: 4 }, (_, i) => ({ file_name: `${i}.jpg`, width: 100, height: 100 })),
    annotations: Array.from({ length: 4 }, (_, i) => ({ image_idx: i, persons: [] })),
  };
  const out = buildExport(doc, COCO17, { valRatio: 0.5 });
  assert.equal(out.images.filter((im) => im.split === 'val').length, 2);
  assert.match(out.yaml, /val: images\/val/);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test kpt_label/tests/yolo_export.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 yolo_export.js**

```javascript
// kpt_label/src/yolo_export.js
// 中间 JSON → Ultralytics YOLO-pose 数据集（纯逻辑，无 IO）。
// 一人一行：class cx cy w h (x y v)*N，全部归一化到 [0,1]。
import { bboxFromKeypoints } from './bbox_geom.js';

const fmt = (n) => String(Math.round(n * 1e6) / 1e6);   // 6 位小数，去浮点尾噪

// 一人 → 一行；无框者用关键点包围盒补，无可见点返回 null。
export function personToYoloLine(person, img, skel) {
  const { width: W, height: H } = img;
  const bbox = person.bbox ?? bboxFromKeypoints(person.keypoints, { width: W, height: H });
  if (!bbox) return null;
  const [bx, by, bw, bh] = bbox;
  const parts = ['0', fmt((bx + bw / 2) / W), fmt((by + bh / 2) / H), fmt(bw / W), fmt(bh / H)];
  for (let i = 0; i < skel.names.length; i++) {
    const [x, y, v] = person.keypoints[i] ?? [0, 0, 0];
    if (v > 0) parts.push(fmt(x / W), fmt(y / H), String(v));
    else parts.push('0', '0', '0');
  }
  return parts.join(' ');
}

// 一图所有人 → 多行文本；无人空串。
export function imageLabelText(persons, img, skel) {
  return persons.map((p) => personToYoloLine(p, img, skel)).filter(Boolean).join('\n');
}

// dataset.yaml 文本。hasVal=false 时 val 指向 train 以免 ultralytics 报错。
export function datasetYaml(skel, { hasVal }) {
  const names = skel.names.map((n, i) => `  ${i}: ${n}`).join('\n');
  return [
    'path: .',
    'train: images/train',
    `val: images/${hasVal ? 'val' : 'train'}`,
    'nc: 1',
    'names:',
    names,
    `kpt_shape: [${skel.names.length}, 3]`,
    `flip_idx: [${skel.flip_idx.join(', ')}]`,
    '',
  ].join('\n');
}

// 完整导出包：每图分配 split，产出 label 文件清单 + yaml + 图像→split 映射。
// valRatio∈[0,1]：确定性地每隔 round(1/valRatio) 取一张进 val（非随机，可复现）。
export function buildExport(doc, skel, { valRatio = 0 } = {}) {
  const stem = (f) => f.replace(/\.[^.]+$/, '');
  const step = valRatio > 0 ? Math.max(2, Math.round(1 / valRatio)) : 0;
  const images = doc.images.map((im, i) => ({
    file_name: im.file_name,
    split: step && (i % step === 0) ? 'val' : 'train',
  }));
  const hasVal = images.some((im) => im.split === 'val');
  const labelFiles = doc.annotations.map((ann) => {
    const im = doc.images[ann.image_idx];
    const split = images[ann.image_idx].split;
    return {
      path: `labels/${split}/${stem(im.file_name)}.txt`,
      text: imageLabelText(ann.persons, im, skel),
    };
  });
  return { images, labelFiles, yaml: datasetYaml(skel, { hasVal }) };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test kpt_label/tests/yolo_export.test.js`
Expected: PASS（10 个测试）

- [ ] **Step 5: 提交**

```bash
git add kpt_label/src/yolo_export.js kpt_label/tests/yolo_export.test.js
git commit -m "feat(kpt): YOLO-pose 导出 — 归一化行/yaml/train-val 划分"
```

---

### Task 5: hit_test 命中测试（选人/选关节/选框角）

**Files:**
- Create: `kpt_label/src/hit_test.js`
- Test: `kpt_label/tests/hit_test.test.js`

输入图像像素坐标（调用方已把鼠标 canvas 坐标经 `canvasNormToImage` 转成图像像素，半径也已换算成图像像素）。返回最近命中。

- [ ] **Step 1: 写失败测试**

```javascript
// kpt_label/tests/hit_test.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hitKeypoint, hitBboxCorner, hitPerson } from '../src/hit_test.js';

const person = (id, bbox, kpts) => ({ id, bbox, keypoints: kpts });
const K = (overrides) => { const a = Array.from({ length: 17 }, () => [0, 0, 0]); Object.assign(a, overrides); return a; };

test('hitKeypoint：返回半径内最近的可见关节索引', () => {
  const p = person(1, null, K({ 0: [50, 50, 2], 5: [52, 52, 2] }));
  assert.equal(hitKeypoint(p, [51, 51], 5), 5);  // 52,52 更近
  assert.equal(hitKeypoint(p, [50, 50], 5), 0);
});

test('hitKeypoint：跳过 v=0 关节；超出半径返回 -1', () => {
  const p = person(1, null, K({ 3: [10, 10, 0], 4: [200, 200, 2] }));
  assert.equal(hitKeypoint(p, [10, 10], 5), -1);
});

test('hitBboxCorner：命中四角之一', () => {
  const p = person(1, [10, 10, 100, 100], K());
  assert.equal(hitBboxCorner(p, [10, 10], 6), 'tl');
  assert.equal(hitBboxCorner(p, [110, 110], 6), 'br');
  assert.equal(hitBboxCorner(p, [60, 60], 6), null);  // 中心不命中角
});

test('hitBboxCorner：无框返回 null', () => {
  assert.equal(hitBboxCorner(person(1, null, K()), [0, 0], 6), null);
});

test('hitPerson：点击落在某人框内或近其关键点 → 该人 id；多人取最近', () => {
  const ps = [
    person(1, [0, 0, 100, 100], K()),
    person(2, null, K({ 0: [300, 300, 2] })),
  ];
  assert.equal(hitPerson(ps, [50, 50], 10), 1);     // 框内
  assert.equal(hitPerson(ps, [301, 301], 10), 2);   // 近关键点
  assert.equal(hitPerson(ps, [900, 900], 10), null);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test kpt_label/tests/hit_test.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 hit_test.js**

```javascript
// kpt_label/src/hit_test.js
// 命中测试（纯逻辑）。坐标与半径均为图像像素，调用方负责按当前缩放换算。
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
const inRect = (px, py, [x, y, w, h]) => px >= x && px <= x + w && py >= y && py <= y + h;

const CORNERS = { tl: (b) => [b[0], b[1]], tr: (b) => [b[0] + b[2], b[1]],
                  bl: (b) => [b[0], b[1] + b[3]], br: (b) => [b[0] + b[2], b[1] + b[3]] };

// 半径 r 内最近的可见关节索引；无命中 -1。
export function hitKeypoint(person, [px, py], r) {
  let best = -1, bestD = r * r;
  person.keypoints.forEach((k, i) => {
    if (k[2] <= 0) return;
    const d = dist2(px, py, k[0], k[1]);
    if (d <= bestD) { bestD = d; best = i; }
  });
  return best;
}

// 命中的框角名 'tl'|'tr'|'bl'|'br'，无则 null。
export function hitBboxCorner(person, [px, py], r) {
  if (!person.bbox) return null;
  let best = null, bestD = r * r;
  for (const name of Object.keys(CORNERS)) {
    const [cx, cy] = CORNERS[name](person.bbox);
    const d = dist2(px, py, cx, cy);
    if (d <= bestD) { bestD = d; best = name; }
  }
  return best;
}

// 点击命中的人 id：优先框内/近关键点，多人取最近代表距离；无命中 null。
export function hitPerson(persons, [px, py], r) {
  let best = null, bestD = Infinity;
  for (const p of persons) {
    let d = Infinity;
    if (p.bbox && inRect(px, py, p.bbox)) d = 0;
    for (const k of p.keypoints) if (k[2] > 0) d = Math.min(d, dist2(px, py, k[0], k[1]));
    if (d <= bestD && (d === 0 || d <= r * r)) { bestD = d; best = p.id; }
  }
  return best;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test kpt_label/tests/hit_test.test.js`
Expected: PASS（5 个测试）

- [ ] **Step 5: 提交**

```bash
git add kpt_label/src/hit_test.js kpt_label/tests/hit_test.test.js
git commit -m "feat(kpt): 命中测试 — 选人/选关节/选框角"
```

---

### Task 6: YOLO 格式校验脚本（不依赖 ultralytics）

**Files:**
- Create: `kpt_label/tools/validate_yolo_pose.py`
- Test: `kpt_label/tools/test_validate_yolo_pose.py`

按 ultralytics dataloader 的规则离线校验一个导出目录：每行列数 = `5 + 3*N`、所有归一化值 ∈ [0,1]、v ∈ {0,1,2}、`dataset.yaml` 含必需字段且 `kpt_shape[0]` 与标签关节数一致。这是「能直接导入训练」的可复现门禁；环境若有 ultralytics 再跑真训练（Task 12 手动冒烟）。

- [ ] **Step 1: 写失败测试**

```python
# kpt_label/tools/test_validate_yolo_pose.py
import os, tempfile, unittest
from validate_yolo_pose import validate_dataset

YAML = """path: .
train: images/train
val: images/train
nc: 1
names:
  0: person
kpt_shape: [17, 3]
flip_idx: [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15]
"""

def write(root, rel, text):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        f.write(text)

class T(unittest.TestCase):
    def test_valid_dataset_passes(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "dataset.yaml", YAML)
            line = "0 0.5 0.5 0.2 0.2 " + " ".join(["0.5", "0.5", "2"] * 17)
            write(d, "labels/train/a.txt", line + "\n")
            write(d, "images/train/a.jpg", "")  # 占位
            errors = validate_dataset(d)
            self.assertEqual(errors, [])

    def test_wrong_column_count_fails(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "dataset.yaml", YAML)
            write(d, "labels/train/a.txt", "0 0.5 0.5 0.2 0.2 0.1 0.1 2\n")  # 只 1 个点
            errors = validate_dataset(d)
            self.assertTrue(any("columns" in e for e in errors))

    def test_out_of_range_fails(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "dataset.yaml", YAML)
            line = "0 1.5 0.5 0.2 0.2 " + " ".join(["0.5", "0.5", "2"] * 17)
            write(d, "labels/train/a.txt", line + "\n")
            errors = validate_dataset(d)
            self.assertTrue(any("range" in e for e in errors))

    def test_bad_visibility_fails(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "dataset.yaml", YAML)
            line = "0 0.5 0.5 0.2 0.2 " + " ".join(["0.5", "0.5", "3"] * 17)  # v=3 非法
            write(d, "labels/train/a.txt", line + "\n")
            errors = validate_dataset(d)
            self.assertTrue(any("visibility" in e for e in errors))

    def test_empty_label_is_valid(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "dataset.yaml", YAML)
            write(d, "labels/train/a.txt", "")  # 背景，合法
            errors = validate_dataset(d)
            self.assertEqual(errors, [])

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd kpt_label/tools && python3 -m unittest test_validate_yolo_pose -v`
Expected: FAIL（`ModuleNotFoundError: validate_yolo_pose`）

- [ ] **Step 3: 实现 validate_yolo_pose.py**

```python
# kpt_label/tools/validate_yolo_pose.py
# 离线校验 YOLO-pose 导出目录是否符合 Ultralytics 加载规则（不依赖 ultralytics）。
# 用法: python3 validate_yolo_pose.py <dataset_dir>
import os
import re
import sys


def _parse_yaml(path):
    """极简解析所需字段：nc, kpt_shape, flip_idx, names 数量。仅支持本工具产出的扁平格式。"""
    cfg = {"names": []}
    with open(path) as f:
        for raw in f:
            line = raw.rstrip("\n")
            if re.match(r"^\s+\d+:", line):
                cfg["names"].append(line)
                continue
            m = re.match(r"^(\w+):\s*(.*)$", line)
            if not m:
                continue
            key, val = m.group(1), m.group(2).strip()
            if key == "kpt_shape":
                cfg["kpt_shape"] = [int(x) for x in re.findall(r"\d+", val)]
            elif key == "flip_idx":
                cfg["flip_idx"] = [int(x) for x in re.findall(r"\d+", val)]
            elif key == "nc":
                cfg["nc"] = int(val)
    return cfg


def validate_dataset(root):
    """返回错误字符串列表；空列表表示通过。"""
    errors = []
    yaml_path = os.path.join(root, "dataset.yaml")
    if not os.path.isfile(yaml_path):
        return ["missing dataset.yaml"]
    cfg = _parse_yaml(yaml_path)

    if cfg.get("nc") != 1:
        errors.append("nc must be 1")
    ks = cfg.get("kpt_shape")
    if not ks or len(ks) != 2 or ks[1] != 3:
        errors.append("kpt_shape must be [N, 3]")
        return errors
    n = ks[0]
    if len(cfg.get("flip_idx", [])) != n:
        errors.append(f"flip_idx length must equal {n}")
    if len(cfg["names"]) != cfg.get("nc", -1):
        errors.append("names count must equal nc")

    expect_cols = 5 + 3 * n
    for split in ("train", "val"):
        ldir = os.path.join(root, "labels", split)
        if not os.path.isdir(ldir):
            continue
        for fn in sorted(os.listdir(ldir)):
            if not fn.endswith(".txt"):
                continue
            with open(os.path.join(ldir, fn)) as f:
                for li, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue
                    cols = line.split()
                    where = f"{split}/{fn}:{li}"
                    if len(cols) != expect_cols:
                        errors.append(f"{where}: columns={len(cols)} expected {expect_cols}")
                        continue
                    vals = [float(c) for c in cols]
                    if vals[0] != 0:
                        errors.append(f"{where}: class must be 0")
                    for v in vals[1:5]:
                        if not (0.0 <= v <= 1.0):
                            errors.append(f"{where}: bbox out of range [0,1]")
                            break
                    for k in range(n):
                        x, y, vis = vals[5 + k * 3:8 + k * 3]
                        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
                            errors.append(f"{where}: kpt{k} range [0,1]")
                        if vis not in (0, 1, 2):
                            errors.append(f"{where}: kpt{k} visibility must be 0/1/2")
    return errors


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: validate_yolo_pose.py <dataset_dir>")
        sys.exit(2)
    errs = validate_dataset(sys.argv[1])
    if errs:
        print("INVALID:")
        for e in errs:
            print("  " + e)
        sys.exit(1)
    print("OK: dataset is valid YOLO-pose")
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd kpt_label/tools && python3 -m unittest test_validate_yolo_pose -v`
Expected: PASS（5 个测试）

- [ ] **Step 5: 提交**

```bash
git add kpt_label/tools/validate_yolo_pose.py kpt_label/tools/test_validate_yolo_pose.py
git commit -m "feat(kpt): YOLO-pose 离线格式校验脚本 + 测试"
```

---

### Task 7: render 绘制层（canvas 底图 + 框 + 骨架 + 点）

**Files:**
- Create: `kpt_label/src/render.js`

纯绘制，不改状态。坐标走 `view_zoom` 的 `imageToCanvasNorm`，再乘画布宽高得像素。非选中人淡化，选中人高亮。无单测（canvas 2D 上下文，浏览器内验证）；但导出一个可单测的纯函数 `kptColor`。

- [ ] **Step 1: 实现 render.js**

```javascript
// kpt_label/src/render.js
// Canvas 2D 绘制层（只画不改状态）。
// 约定：win = computeWindow(...)，cw/ch = canvas 像素尺寸。
import { imageToCanvasNorm } from '../../label/src/scene/view_zoom.js';

// 可见性 → 颜色（v=2 实心绿，v=1 橙，其余不画由调用方控制）。
export function kptColor(v) { return v === 2 ? '#39d353' : v === 1 ? '#e3a008' : '#888'; }

const toCanvas = (ix, iy, win, cw, ch) => {
  const [u, v] = imageToCanvasNorm(ix, iy, win);
  return [u * cw, v * ch];
};

// 画底图：drawImage 整图，按 win 裁剪到画布。img 为已解码 ImageBitmap/HTMLImageElement。
export function drawImage(ctx, img, win, cw, ch) {
  ctx.clearRect(0, 0, cw, ch);
  // 源矩形 = win，目标 = 整画布。
  ctx.drawImage(img, win.winX, win.winY, win.winW, win.winH, 0, 0, cw, ch);
}

function drawBbox(ctx, bbox, win, cw, ch, { color, lineWidth, handle }) {
  const [x, y, w, h] = bbox;
  const [sx, sy] = toCanvas(x, y, win, cw, ch);
  const [ex, ey] = toCanvas(x + w, y + h, win, cw, ch);
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
  ctx.strokeRect(sx, sy, ex - sx, ey - sy);
  if (handle) {
    ctx.fillStyle = color;
    for (const [cx, cy] of [[sx, sy], [ex, sy], [sx, ey], [ex, ey]]) {
      ctx.fillRect(cx - 4, cy - 4, 8, 8);
    }
  }
}

function drawSkeleton(ctx, person, skel, win, cw, ch, alpha) {
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2; ctx.strokeStyle = '#4493f8';
  for (const [a, b] of skel.edges) {
    const ka = person.keypoints[a], kb = person.keypoints[b];
    if (ka[2] <= 0 || kb[2] <= 0) continue;
    const [ax, ay] = toCanvas(ka[0], ka[1], win, cw, ch);
    const [bx, by] = toCanvas(kb[0], kb[1], win, cw, ch);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  person.keypoints.forEach((k) => {
    if (k[2] <= 0) return;
    const [px, py] = toCanvas(k[0], k[1], win, cw, ch);
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2);
    if (k[2] === 2) { ctx.fillStyle = kptColor(2); ctx.fill(); }
    else { ctx.strokeStyle = kptColor(1); ctx.lineWidth = 2; ctx.stroke(); }
  });
  ctx.globalAlpha = 1;
}

// 画一帧所有人。selectedId 高亮（实线粗框 + 角手柄 + 不透明），其余淡化。
export function drawPersons(ctx, persons, selectedId, skel, win, cw, ch) {
  for (const p of persons) {
    const sel = p.id === selectedId;
    const alpha = sel ? 1 : 0.4;
    if (p.bbox) drawBbox(ctx, p.bbox, win, cw, ch, {
      color: sel ? '#ffcc33' : 'rgba(255,204,51,0.4)',
      lineWidth: sel ? 2 : 1, handle: sel,
    });
    drawSkeleton(ctx, p, skel, win, cw, ch, alpha);
  }
}
```

- [ ] **Step 2: 写 kptColor 的单测**

```javascript
// kpt_label/tests/render_color.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kptColor } from '../src/render.js';

test('kptColor 三态', () => {
  assert.equal(kptColor(2), '#39d353');
  assert.equal(kptColor(1), '#e3a008');
  assert.equal(kptColor(0), '#888');
});
```

> 注意：`render.js` import 了 `view_zoom.js`，`node --test` 能解析该相对路径（同仓库），`kptColor` 不触发 canvas，可安全单测。

- [ ] **Step 3: 运行测试，确认通过**

Run: `node --test kpt_label/tests/render_color.test.js`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add kpt_label/src/render.js kpt_label/tests/render_color.test.js
git commit -m "feat(kpt): canvas 绘制层 — 底图/框/骨架/三态点"
```

---

### Task 8: body_diagram SVG 人体图（选关节）

**Files:**
- Create: `kpt_label/src/body_diagram.js`

数据驱动的 SVG 人体图：从 `skel.layout` 画可点击圆点 + `skel.edges` 画连线。点击关节回调 `onPick(index)`。根据 store 状态着色（已标 v=2 绿、v=1 橙、未标灰、待放置高亮、选中描边）。轻 DOM，浏览器内验证。

- [ ] **Step 1: 实现 body_diagram.js**

```javascript
// kpt_label/src/body_diagram.js
// 数据驱动的 SVG 人体图图例：选关节用。layout 归一化坐标映射到 viewBox 100x110。
const NS = 'http://www.w3.org/2000/svg';
const VW = 100, VH = 110;

export class BodyDiagram {
  // host: 容器元素；skel: 骨架配置；onPick(index): 选中关节回调。
  constructor(host, skel, onPick) {
    this._skel = skel;
    this._onPick = onPick;
    this._svg = document.createElementNS(NS, 'svg');
    this._svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
    this._svg.classList.add('body-diagram');
    host.appendChild(this._svg);
    this._dots = [];
    this._build();
  }

  _xy(p) { return [p.x * VW, p.y * VH]; }

  _build() {
    const { layout, edges } = this._skel;
    for (const [a, b] of edges) {
      const [ax, ay] = this._xy(layout[a]);
      const [bx, by] = this._xy(layout[b]);
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', ax); ln.setAttribute('y1', ay);
      ln.setAttribute('x2', bx); ln.setAttribute('y2', by);
      ln.setAttribute('stroke', '#555'); ln.setAttribute('stroke-width', '1');
      this._svg.appendChild(ln);
    }
    layout.forEach((p, i) => {
      const [cx, cy] = this._xy(p);
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', '3.5');
      c.style.cursor = 'pointer';
      c.addEventListener('click', () => this._onPick(i));
      this._svg.appendChild(c);
      this._dots[i] = c;
    });
  }

  // 按当前选中人的 keypoints + 待放置索引刷新着色。
  // kpts: Array(N) of [x,y,v] 或 null（无选中人）；armed: 待放置关节索引或 -1。
  update(kpts, armed = -1) {
    this._dots.forEach((c, i) => {
      const v = kpts ? kpts[i][2] : 0;
      const fill = v === 2 ? '#39d353' : v === 1 ? '#e3a008' : '#444';
      c.setAttribute('fill', fill);
      c.setAttribute('stroke', i === armed ? '#fff' : 'none');
      c.setAttribute('stroke-width', i === armed ? '2' : '0');
    });
  }
}
```

- [ ] **Step 2: 提交（无单测；浏览器内验证）**

```bash
git add kpt_label/src/body_diagram.js
git commit -m "feat(kpt): SVG 人体图图例 — 数据驱动选关节"
```

---

### Task 9: video_frames 视频帧源（纯 2D，无 three.js）

**Files:**
- Create: `kpt_label/src/video_frames.js`

`label` 的 `video_source.js` 依赖 `THREE.VideoTexture`，不适用纯 2D。这里用 HTML5 `<video>` + seek，暴露 `videoEl`（供 canvas `drawImage` 直接画）与帧数/尺寸。逻辑薄、浏览器内验证。

- [ ] **Step 1: 实现 video_frames.js**

```javascript
// kpt_label/src/video_frames.js
// HTML5 <video> 帧源（纯 2D；canvas drawImage 直接用 videoEl）。
export class VideoFrames {
  constructor(file, { fps = 30 } = {}) {
    this._url = URL.createObjectURL(file);
    this._fps = fps;
    this._video = document.createElement('video');
    this._video.muted = true;
    this._video.playsInline = true;
    this._video.preload = 'auto';
    this._video.src = this._url;
    this._ready = new Promise((resolve, reject) => {
      this._video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      this._video.addEventListener('error', () => reject(new Error('video load failed')), { once: true });
    });
  }

  async ready() { await this._ready; return this; }
  get fps() { return this._fps; }
  get width() { return this._video.videoWidth; }
  get height() { return this._video.videoHeight; }
  get videoEl() { return this._video; }
  frameCount() { return Math.max(1, Math.floor((this._video.duration || 0) * this._fps)); }

  // seek 到帧 index，resolve 后 videoEl 可直接 drawImage。
  seek(index) {
    const t = Math.min(this._video.duration || 0, (index + 0.001) / this._fps);
    return new Promise((resolve) => {
      this._video.addEventListener('seeked', () => resolve(), { once: true });
      this._video.currentTime = t;
    });
  }

  dispose() {
    URL.revokeObjectURL(this._url);
    this._video.removeAttribute('src');
    this._video.load();
  }
}
```

- [ ] **Step 2: 提交（无单测；浏览器内验证）**

```bash
git add kpt_label/src/video_frames.js
git commit -m "feat(kpt): 纯 2D 视频帧源（drawImage，无 three.js）"
```

---

### Task 10: index.html 布局骨架

**Files:**
- Create: `kpt_label/index.html`

三栏布局：左=数据/帧导航/导出，中=canvas 舞台，右=人物列表 + 模式 Tab + SVG 人体图。importmap 仅需 `view_zoom`/IO 的相对 import（无 three.js）。

- [ ] **Step 1: 实现 index.html**

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>2D 关键点标注器</title>
  <style>
    html,body { height:100%; margin:0; background:#1a1f2a; color:#eee; font-family:system-ui,monospace; font-size:12px; }
    body { display:flex; }
    #left, #right { width:280px; background:#1a1a1a; padding:10px; display:flex; flex-direction:column; gap:8px; overflow-y:auto; }
    #left { border-right:1px solid #333; } #right { border-left:1px solid #333; }
    #stage { position:relative; flex:1; background:#0f1216; overflow:hidden; min-width:0; }
    canvas { display:block; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); cursor:crosshair; }
    #status { position:absolute; top:8px; left:8px; background:rgba(0,0,0,.6); padding:5px 9px; border-radius:3px; }
    h2 { font-size:14px; color:#7df; margin:0 0 4px; }
    h3 { font-size:11px; color:#8ab; margin:0 0 2px; }
    .card { border-top:1px solid #2a2a2a; padding-top:8px; display:flex; flex-direction:column; gap:5px; }
    button { padding:6px 8px; background:#2a2a2a; border:1px solid #444; color:#eee; border-radius:4px; cursor:pointer; font:inherit; }
    button:hover { background:#3a3a3a; }
    button.on { background:#0066cc; border-color:#3399ff; }
    button.primary { background:#1f6f43; border-color:#2e9e60; }
    .row { display:flex; gap:5px; } .row > * { flex:1; }
    .hint { color:#9ab; font-size:11px; line-height:1.5; background:#222b33; padding:6px 8px; border-radius:4px; }
    .status { background:#222; border:1px solid #333; color:#ffa; padding:4px 6px; border-radius:3px; min-height:16px; }
    #tabs { display:flex; gap:3px; } #tabs .tab { flex:1; border-radius:4px 4px 0 0; }
    #person-list { display:flex; flex-direction:column; gap:2px; max-height:200px; overflow-y:auto; }
    #person-list .item { padding:4px 6px; border:1px solid #333; border-radius:3px; cursor:pointer; display:flex; justify-content:space-between; }
    #person-list .item.on { background:#0066cc; border-color:#3399ff; }
    .body-diagram { width:100%; height:260px; background:#11151c; border:1px solid #333; border-radius:4px; }
    input[type=range] { width:100%; }
    label.inline { display:flex; align-items:center; gap:6px; }
  </style>
</head>
<body>
  <div id="left">
    <h2>2D 关键点标注器</h2>
    <div class="hint">打开图像目录或视频。框与关键点为同一人的两个独立属性，可只标其一。</div>
    <div class="card">
      <h3>数据</h3>
      <button id="open-dir" class="primary">打开图像目录</button>
      <button id="open-video">打开视频</button>
      <input id="file-input" type="file" accept="image/*" multiple hidden>
    </div>
    <div class="card">
      <h3>帧</h3>
      <div class="row"><button id="prev">◀ 上一帧</button><button id="next">下一帧 ▶</button></div>
      <input id="frame-slider" type="range" min="0" max="0" value="0">
      <div id="frame-label" class="status">— / —</div>
    </div>
    <div class="card">
      <h3>导出 YOLO-pose</h3>
      <label class="inline">val 比例 <input id="val-ratio" type="number" min="0" max="0.9" step="0.1" value="0" style="width:60px"></label>
      <button id="export">导出数据集</button>
      <button id="save-json">保存中间 JSON</button>
    </div>
    <div class="card"><div class="hint">快捷键：N 新建人 · Del 删人 · Tab 切人 · 1/2 框/点 · F 聚焦 · R 重置 · Z 撤销</div></div>
  </div>

  <div id="stage">
    <canvas id="canvas"></canvas>
    <div id="status">未加载</div>
  </div>

  <div id="right">
    <div class="card">
      <h3>人物</h3>
      <div class="row"><button id="add-person" class="primary">+ 新建(N)</button><button id="del-person">删除(Del)</button></div>
      <div id="person-list"></div>
    </div>
    <div class="card">
      <h3>编辑模式</h3>
      <div id="tabs">
        <button class="tab on" data-mode="pose">关键点(2)</button>
        <button class="tab" data-mode="bbox">框(1)</button>
      </div>
    </div>
    <div class="card" id="diagram-card">
      <h3>选关节打点</h3>
      <div class="hint">点下方关节 → 在图上单击放置。右键点切 可见/遮挡/清除。</div>
      <div id="diagram-host"></div>
    </div>
  </div>

  <script type="module" src="./src/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 提交**

```bash
git add kpt_label/index.html
git commit -m "feat(kpt): 标注器三栏布局骨架"
```

---

### Task 11: app.js 装配（IO + 视口 + 渲染 + 事件 + 面板）

**Files:**
- Create: `kpt_label/src/app.js`

把所有模块装起来。视口用 `view_zoom`（令 `cx=W/2,cy=H/2`）。canvas 尺寸贴合舞台并保持图像宽高比。事件：滚轮缩放、拖拽平移、点图打点/选人、拖点微调、画框、快捷键。这是 DOM/canvas 耦合层，浏览器内验证。

- [ ] **Step 1: 实现 app.js（第 1 段：导入 + 状态 + 视口）**

```javascript
// kpt_label/src/app.js
// 2D 关键点标注器装配层（DOM/canvas 耦合，浏览器内验证）。
import { computeWindow, zoomAtSolve, canvasNormToImage, clampPan, ZOOM_MIN } from '../../label/src/scene/view_zoom.js';
import { classifyEntries } from '../../label/src/io/dataset_paths.js';
import { orderedImageNames } from '../../label/src/io/image_order.js';
import { isPortrait } from '../../label/src/io/source_loader.js';
import { DirSource, fsAccessSupported, pickDirectory, videoOpenSupported, pickVideoFile } from '../../label/src/io/dir_source.js';
import { getSkeleton } from './skeleton.js';
import { KptStore } from './kpt_store.js';
import { resizeBboxByCorner, normRect } from './bbox_geom.js';
import { hitKeypoint, hitBboxCorner, hitPerson } from './hit_test.js';
import { drawImage, drawPersons } from './render.js';
import { BodyDiagram } from './body_diagram.js';
import { VideoFrames } from './video_frames.js';
import { buildExport } from './yolo_export.js';

const $ = (id) => document.getElementById(id);
const skel = getSkeleton('coco17');

const state = {
  store: null, dirSource: null, video: null, images: null /* Map<idx,File> */,
  imgW: 1920, imgH: 1080, bitmap: null,
  zoom: 1, panX: 0, panY: 0,
  mode: 'pose', armed: -1,           // armed: SVG 选中待放置关节索引
  diagram: null,
};

const canvas = $('canvas');
const ctx = canvas.getContext('2d');

function win() {
  return computeWindow({ imageW: state.imgW, imageH: state.imgH, cx: state.imgW / 2, cy: state.imgH / 2,
    zoom: state.zoom, panX: state.panX, panY: state.panY });
}
// 鼠标事件 → 图像像素坐标。
function eventToImage(ev) {
  const r = canvas.getBoundingClientRect();
  const u = (ev.clientX - r.left) / r.width;
  const v = (ev.clientY - r.top) / r.height;
  return canvasNormToImage(u, v, win());
}
// 当前缩放下，把屏幕命中半径（px）换算成图像像素半径。
function hitRadius(px = 8) {
  const w = win();
  return px * (w.winW / canvas.width);
}
```

- [ ] **Step 2: 实现 app.js（第 2 段：渲染 + 画布尺寸）**

```javascript
// 画布尺寸贴合舞台，保持图像宽高比（letterbox）。
function fitCanvas() {
  const stage = $('stage');
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const ar = state.imgW / state.imgH;
  let cw = sw, ch = sw / ar;
  if (ch > sh) { ch = sh; cw = sh * ar; }
  canvas.width = Math.round(cw); canvas.height = Math.round(ch);
}

function render() {
  if (!state.bitmap) return;
  const w = win();
  drawImage(ctx, state.bitmap, w, canvas.width, canvas.height);
  if (state.store) drawPersons(ctx, state.store.persons(), state.store.selectedId(), skel, w, canvas.width, canvas.height);
}

function syncUI() {
  // 帧标签
  if (state.store) {
    $('frame-label').textContent = `${state.store.currentFrame() + 1} / ${state.store.frameCount()}`;
    $('frame-slider').value = String(state.store.currentFrame());
  }
  // Tab 高亮
  for (const t of document.querySelectorAll('#tabs .tab')) t.classList.toggle('on', t.dataset.mode === state.mode);
  // 人物列表
  const list = $('person-list'); list.innerHTML = '';
  if (state.store) for (const p of state.store.persons()) {
    const el = document.createElement('div');
    el.className = 'item' + (p.id === state.store.selectedId() ? ' on' : '');
    const nk = p.keypoints.filter((k) => k[2] > 0).length;
    el.innerHTML = `<span>Person ${p.id}</span><span>${p.bbox ? '▢' : '·'} ${nk}/${skel.names.length}</span>`;
    el.addEventListener('click', () => { state.store.select(p.id); refresh(); });
    list.appendChild(el);
  }
  // SVG 人体图
  const sel = state.store?.selected();
  state.diagram?.update(sel ? sel.keypoints : null, state.armed);
}

function refresh() { render(); syncUI(); }
```

- [ ] **Step 3: 实现 app.js（第 3 段：数据加载）**

```javascript
async function loadFrame(idx) {
  state.store.setFrame(idx);
  // 取图像位图
  let bmp = null;
  if (state.video) { await state.video.seek(idx); bmp = state.video.videoEl; }
  else if (state.images) {
    const f = state.images.get(idx);
    if (f) bmp = await createImageBitmap(f);
  }
  state.bitmap = bmp;
  state.armed = -1;
  fitCanvas();
  refresh();
}

async function mountImages(dirSource, cls) {
  const names = orderedImageNames({ cocoImages: null, availableNames: cls.imagePaths });
  const images = new Map();
  // 依名取 File，构造 images[] 元数据（首帧解码取尺寸）。
  const metas = [];
  for (let i = 0; i < names.length; i++) {
    const f = await dirSource.imageFileByName(names[i]);
    if (!f) continue;
    images.set(metas.length, f);
    metas.push({ file_name: names[i], width: 0, height: 0 });
  }
  if (!metas.length) throw new Error('目录无可用图像');
  const first = await createImageBitmap(images.get(0));
  state.imgW = first.width; state.imgH = first.height;
  if (isPortrait({ width: state.imgW, height: state.imgH })) $('status').textContent = '竖拍图像：仍可标注（YOLO 归一化与方向无关）';
  for (const m of metas) { m.width = state.imgW; m.height = state.imgH; }  // 同源序列同尺寸；逐帧解码时再不强校验
  state.images = images;
  state.store = new KptStore({ images: metas, skeleton: 'coco17', nkpt: skel.names.length });
  $('frame-slider').max = String(metas.length - 1);
  await loadFrame(0);
}

async function openDirectory() {
  if (!fsAccessSupported()) { $('status').textContent = '浏览器不支持目录访问，请用 Chrome/Edge'; return; }
  const handle = await pickDirectory();
  const src = new DirSource(handle);
  const cls = await src.scan();
  if (cls.hasManifest) { $('status').textContent = '该目录是点云序列，请用 pcd 标注器'; return; }
  state.dirSource = src; state.video = null;
  await mountImages(src, cls);
  $('status').textContent = '已加载图像目录';
}

async function openVideo() {
  if (!videoOpenSupported()) { $('status').textContent = '浏览器不支持视频选择'; return; }
  const file = await pickVideoFile();
  const vf = await new VideoFrames(file).ready();
  state.video = vf; state.images = null; state.dirSource = null;
  state.imgW = vf.width; state.imgH = vf.height;
  const n = vf.frameCount();
  const metas = Array.from({ length: n }, (_, i) => ({ file_name: `frame_${String(i).padStart(6, '0')}.jpg`, width: vf.width, height: vf.height }));
  state.store = new KptStore({ images: metas, skeleton: 'coco17', nkpt: skel.names.length });
  $('frame-slider').max = String(n - 1);
  await loadFrame(0);
  $('status').textContent = `已加载视频（${n} 帧）`;
}
```

- [ ] **Step 4: 实现 app.js（第 4 段：交互事件）**

```javascript
// 滚轮按光标缩放。
$('stage').addEventListener('wheel', (ev) => {
  if (!state.bitmap) return;
  ev.preventDefault();
  const r = canvas.getBoundingClientRect();
  const u = (ev.clientX - r.left) / r.width, v = (ev.clientY - r.top) / r.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return;
  const factor = Math.exp(-ev.deltaY * 0.0015);
  const next = zoomAtSolve({ imageW: state.imgW, imageH: state.imgH, cx: state.imgW / 2, cy: state.imgH / 2,
    zoom: state.zoom, panX: state.panX, panY: state.panY, u, v, factor });
  Object.assign(state, { zoom: next.zoom, panX: next.panX, panY: next.panY });
  const c = clampPan({ imageW: state.imgW, imageH: state.imgH, cx: state.imgW / 2, cy: state.imgH / 2,
    zoom: state.zoom, panX: state.panX, panY: state.panY });
  state.panX = c.panX; state.panY = c.panY;
  render();
}, { passive: false });

// 指针：左键按模式动作；空白拖拽平移。
let drag = null;  // { kind:'pan'|'kpt'|'bbox'|'corner', ... }
canvas.addEventListener('pointerdown', (ev) => {
  if (!state.store) return;
  const [ix, iy] = eventToImage(ev);
  const r = hitRadius();

  // 中键/空格拖拽平移（这里用右键空白也行；简单起见：shift+左键平移）
  if (ev.shiftKey) { drag = { kind: 'pan', x: ev.clientX, y: ev.clientY, panX: state.panX, panY: state.panY }; canvas.setPointerCapture(ev.pointerId); return; }

  const sel = state.store.selected();
  // 选中人优先：拖已有关节 / 拖框角
  if (sel) {
    const ki = hitKeypoint(sel, [ix, iy], r);
    if (ki >= 0 && state.mode === 'pose') { state.store.beginEdit(); drag = { kind: 'kpt', idx: ki }; canvas.setPointerCapture(ev.pointerId); return; }
    const corner = hitBboxCorner(sel, [ix, iy], r);
    if (corner && state.mode === 'bbox') { state.store.beginEdit(); drag = { kind: 'corner', corner }; canvas.setPointerCapture(ev.pointerId); return; }
  }
  // pose + 待放置关节 → 放点
  if (state.mode === 'pose' && state.armed >= 0 && sel) {
    state.store.setKeypoint(state.armed, ix, iy, 2);
    state.armed = nextUnset(sel, state.armed);
    refresh(); return;
  }
  // bbox 模式空白 → 画新框
  if (state.mode === 'bbox' && sel) { state.store.beginEdit(); drag = { kind: 'bbox', x0: ix, y0: iy }; canvas.setPointerCapture(ev.pointerId); return; }
  // 否则点选人
  const hid = hitPerson(state.store.persons(), [ix, iy], r);
  if (hid != null) { state.store.select(hid); refresh(); }
});

canvas.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  if (drag.kind === 'pan') {
    const w = win();
    const dx = (ev.clientX - drag.x) / canvas.width * w.winW;
    const dy = (ev.clientY - drag.y) / canvas.height * w.winH;
    const c = clampPan({ imageW: state.imgW, imageH: state.imgH, cx: state.imgW / 2, cy: state.imgH / 2,
      zoom: state.zoom, panX: drag.panX - dx, panY: drag.panY - dy });
    state.panX = c.panX; state.panY = c.panY; render(); return;
  }
  const [ix, iy] = eventToImage(ev);
  if (drag.kind === 'kpt') { state.store.applyKeypoint(drag.idx, ix, iy, state.store.selected().keypoints[drag.idx][2] || 2); render(); }
  else if (drag.kind === 'corner') { state.store.applyBbox(resizeBboxByCorner(state.store.selected().bbox, drag.corner, [ix, iy])); render(); }
  else if (drag.kind === 'bbox') { state.store.applyBbox(normRect(drag.x0, drag.y0, ix, iy)); render(); }
});

canvas.addEventListener('pointerup', (ev) => {
  if (drag && drag.kind !== 'pan') state.store.commitEdit();
  if (drag) { try { canvas.releasePointerCapture(ev.pointerId); } catch {} }
  drag = null; refresh();
});

// 右键切关键点可见性 2→1→0（0 即清除）。
canvas.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const sel = state.store?.selected();
  if (!sel || state.mode !== 'pose') return;
  const [ix, iy] = eventToImage(ev);
  const ki = hitKeypoint(sel, [ix, iy], hitRadius());
  if (ki < 0) return;
  const cur = sel.keypoints[ki][2];
  const nv = cur === 2 ? 1 : cur === 1 ? 0 : 2;
  if (nv === 0) state.store.setKeypoint(ki, 0, 0, 0);
  else state.store.setKeypoint(ki, sel.keypoints[ki][0], sel.keypoints[ki][1], nv);
  refresh();
});

function nextUnset(person, from) {
  for (let i = 1; i <= skel.names.length; i++) {
    const j = (from + i) % skel.names.length;
    if (person.keypoints[j][2] === 0) return j;
  }
  return -1;
}
```

- [ ] **Step 5: 实现 app.js（第 5 段：按钮 + 快捷键 + 导出 + 启动）**

```javascript
$('open-dir').addEventListener('click', () => openDirectory().catch((e) => $('status').textContent = String(e.message || e)));
$('open-video').addEventListener('click', () => openVideo().catch((e) => $('status').textContent = String(e.message || e)));
$('prev').addEventListener('click', () => state.store && loadFrame(Math.max(0, state.store.currentFrame() - 1)));
$('next').addEventListener('click', () => state.store && loadFrame(Math.min(state.store.frameCount() - 1, state.store.currentFrame() + 1)));
$('frame-slider').addEventListener('input', (e) => state.store && loadFrame(Number(e.target.value)));
$('add-person').addEventListener('click', () => { if (!state.store) return; state.store.addPerson(); state.armed = 0; refresh(); });
$('del-person').addEventListener('click', () => { state.store?.deletePerson(); refresh(); });
for (const t of document.querySelectorAll('#tabs .tab')) t.addEventListener('click', () => { state.mode = t.dataset.mode; state.armed = -1; refresh(); });
$('save-json').addEventListener('click', () => downloadJson());
$('export').addEventListener('click', () => exportYolo().catch((e) => $('status').textContent = String(e.message || e)));

window.addEventListener('keydown', (ev) => {
  if (!state.store || ev.target.tagName === 'INPUT') return;
  if (ev.key === 'n' || ev.key === 'N') { state.store.addPerson(); state.armed = 0; refresh(); }
  else if (ev.key === 'Delete') { state.store.deletePerson(); refresh(); }
  else if (ev.key === 'Tab') { ev.preventDefault(); cycleSelect(); }
  else if (ev.key === '1') { state.mode = 'bbox'; state.armed = -1; refresh(); }
  else if (ev.key === '2') { state.mode = 'pose'; refresh(); }
  else if (ev.key === 'f' || ev.key === 'F') focusSelected();
  else if (ev.key === 'r' || ev.key === 'R') { state.zoom = ZOOM_MIN; state.panX = 0; state.panY = 0; render(); }
  else if (ev.key === 'z' || ev.key === 'Z') { state.store.undo(); refresh(); }
});

function cycleSelect() {
  const ps = state.store.persons(); if (!ps.length) return;
  const i = ps.findIndex((p) => p.id === state.store.selectedId());
  state.store.select(ps[(i + 1) % ps.length].id); refresh();
}

// F 聚焦：把选中人的框（或关键点包围盒）放到视口中央并放大。
function focusSelected() {
  const sel = state.store?.selected(); if (!sel) return;
  let box = sel.bbox;
  if (!box) {
    const pts = sel.keypoints.filter((k) => k[2] > 0);
    if (!pts.length) return;
    const xs = pts.map((k) => k[0]), ys = pts.map((k) => k[1]);
    box = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  }
  const [bx, by, bw, bh] = box;
  const z = Math.min(8, Math.max(2, 0.6 * Math.min(state.imgW / Math.max(1, bw), state.imgH / Math.max(1, bh))));
  // base 左上为 0（cx=W/2）。窗口中心图像x = panX + winW/2 → 令其 = 框中心。
  const cxImg = bx + bw / 2, cyImg = by + bh / 2;
  state.zoom = z;
  const winW = state.imgW / z, winH = state.imgH / z;
  state.panX = cxImg - winW / 2;
  state.panY = cyImg - winH / 2;
  const c = clampPan({ imageW: state.imgW, imageH: state.imgH, cx: state.imgW / 2, cy: state.imgH / 2,
    zoom: state.zoom, panX: state.panX, panY: state.panY });
  state.panX = c.panX; state.panY = c.panY; render();
}

function downloadJson() {
  if (!state.store) return;
  const blob = new Blob([JSON.stringify(state.store.serialize(), null, 2)], { type: 'application/json' });
  triggerDownload(blob, 'kpt_label.json');
}

async function exportYolo() {
  if (!state.store) return;
  const valRatio = Number($('val-ratio').value) || 0;
  const doc = state.store.serialize();
  const out = buildExport(doc, skel, { valRatio });
  // 优先写入目录（File System Access），否则打包下载。
  if (state.dirSource) {
    for (const lf of out.labelFiles) await state.dirSource.writeFile(lf.path, new Blob([lf.text]));
    await state.dirSource.writeFile('dataset.yaml', new Blob([out.yaml]));
    // 复制图像到 images/<split>/（软链不可行）。
    out.images.forEach(async (im, idx) => {
      const f = state.images?.get(idx);
      if (f) await state.dirSource.writeFile(`images/${im.split}/${im.file_name}`, f);
    });
    $('status').textContent = '已导出 YOLO-pose 到目录（labels/ images/ dataset.yaml）';
  } else {
    // 无目录权限：仅下载 labels + yaml（图像请用户自备）。
    const parts = [out.yaml, ...out.labelFiles.map((f) => `# ${f.path}\n${f.text}`)].join('\n\n');
    triggerDownload(new Blob([parts]), 'yolo_pose_labels.txt');
    $('status').textContent = '已下载 labels + yaml（图像请自行放入 images/）';
  }
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 启动
state.diagram = new BodyDiagram($('diagram-host'), skel, (idx) => {
  if (!state.store?.selected()) { $('status').textContent = '请先新建/选中一个人'; return; }
  state.mode = 'pose'; state.armed = idx; refresh();
});
window.addEventListener('resize', () => { if (state.bitmap) { fitCanvas(); render(); } });
syncUI();
```

> 说明：`mountImages` 假设同序列图像同尺寸（人体标注的常规）；逐帧若尺寸不同，YOLO 归一化仍按各帧 `images[].width/height` 进行（导出从 store.serialize 取每图尺寸）。v1 取首帧尺寸写入所有 meta；后续若需逐帧精确尺寸，在 loadFrame 解码后回填 `metas[idx]`。这一简化不影响同尺寸序列的正确性。

- [ ] **Step 6: 提交**

```bash
git add kpt_label/src/app.js
git commit -m "feat(kpt): app 装配 — IO/视口/渲染/交互/导出"
```

---

### Task 12: 集成（package.json 脚本 + 测试 glob + 根入口）+ 冒烟

**Files:**
- Modify: `package.json`
- Modify: `index.html`（根落地页加入口卡片）

- [ ] **Step 1: package.json 加 serve:kpt 与测试 glob**

`scripts.serve:kpt`：
```json
"serve:kpt": "node smpl_web_viewer/tools/static_server.mjs --root . --port 5177"
```

`scripts.test:web` 末尾追加 ` kpt_label/tests/*.test.js`（在 `pcd_label/tests/*.test.js` 之后、`tests/smpl_viewer_local_data.test.js` 之前或之后均可）。

`scripts.test:tools` 改为同时发现 kpt_label/tools 下的测试：
```json
"test:tools": "PYTHONPATH=smpl_web_viewer python3 -m unittest discover -s smpl_web_viewer/tests -p 'test_*.py' && python3 -m unittest discover -s kpt_label/tools -p 'test_*.py'"
```

- [ ] **Step 2: 根 index.html 加入口卡片**

定位根 `index.html` 中现有三个 app 的卡片区块，仿照其结构新增一张指向 `kpt_label/index.html` 的卡片，标题「2D 关键点标注器」，描述「多人框 + COCO-17 关键点，导出 YOLO-pose」。

Run（先看现有结构）: `node --test` 不涉及；用 Read 打开根 `index.html` 找到卡片容器再插入。

- [ ] **Step 3: 跑全套单测**

Run: `node --test kpt_label/tests/*.test.js`
Expected: PASS（skeleton 6 + kpt_store 10 + bbox_geom 7 + yolo_export 10 + hit_test 5 + render_color 1）

Run: `cd kpt_label/tools && python3 -m unittest discover -p 'test_*.py' -v`
Expected: PASS（5）

Run（确保未破坏既有）: `npm run test:web`
Expected: PASS（含新增 kpt 测试）

- [ ] **Step 4: 真·导出 + 校验冒烟（小规模）**

写一个临时 Node 脚本 `kpt_label/tools/_smoke.mjs`，构造 2 人含缺框/缺点的 store，`buildExport` 写到临时目录，再跑 `validate_yolo_pose.py`：

```javascript
// kpt_label/tools/_smoke.mjs  （临时；冒烟后删除）
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildExport } from '../src/yolo_export.js';
import { COCO17 } from '../src/skeleton.js';

const K = (ov) => { const a = Array.from({ length: 17 }, () => [0, 0, 0]); Object.assign(a, ov); return a; };
const doc = {
  schema: 'kpt-label/v1', skeleton: 'coco17',
  images: [{ file_name: 'a.jpg', width: 640, height: 480 }],
  annotations: [{ image_idx: 0, persons: [
    { bbox: [10, 10, 100, 200], keypoints: K({ 0: [50, 30, 2], 5: [40, 80, 1] }) },
    { bbox: null, keypoints: K({ 11: [200, 200, 2], 12: [240, 200, 2], 15: [210, 400, 2] }) },
  ] }],
};
const out = buildExport(doc, COCO17, { valRatio: 0 });
const root = mkdtempSync(join(tmpdir(), 'kpt-'));
for (const lf of out.labelFiles) { const p = join(root, lf.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, lf.text); }
writeFileSync(join(root, 'dataset.yaml'), out.yaml);
mkdirSync(join(root, 'images/train'), { recursive: true });
writeFileSync(join(root, 'images/train/a.jpg'), '');
console.log('export dir:', root);
console.log(execFileSync('python3', [join(dirname(new URL(import.meta.url).pathname), 'validate_yolo_pose.py'), root]).toString());
```

Run: `node kpt_label/tools/_smoke.mjs`
Expected: 打印 `OK: dataset is valid YOLO-pose`

若环境装了 ultralytics，额外手动验证可真训练（可选）：
```bash
# 在上面打印的 export dir 内补几张真实 jpg 后：
yolo pose train data=dataset.yaml model=yolo11n-pose.pt epochs=1 imgsz=320
```

- [ ] **Step 5: 清理临时文件 + 提交**

```bash
rm -f kpt_label/tools/_smoke.mjs
git add package.json index.html
git commit -m "chore(kpt): 集成 serve:kpt + 测试 glob + 根入口；导出校验冒烟通过"
```

- [ ] **Step 6: 浏览器内手动验证（清单）**

`npm run serve:kpt` → 打开 `http://localhost:5177/kpt_label/`：
1. 打开一个含 30+ 人的高清图像目录，滚轮缩放/Shift 拖拽平移流畅。
2. N 新建人 → SVG 点 nose → 图上单击放点 → 自动跳下一关节。
3. 切「框(1)」→ 拖出框；切回「点(2)」拖动微调点；右键切可见性。
4. 列表点选 / 画面点选双向切换当前人；Del 删人。
5. F 聚焦选中人、R 重置、Z 撤销。
6. 设 val 比例 0，导出 → 目录出现 `labels/train/*.txt`、`images/train/*`、`dataset.yaml`。
7. 对导出目录跑 `python3 kpt_label/tools/validate_yolo_pose.py <dir>` → OK。

---

## 自检（spec 覆盖）

| Spec 需求 | 对应 Task |
|---|---|
| 独立纯 2D app `kpt_label/` | Task 10,11 |
| 复用 view_zoom 视口（缩放/平移/F/R） | Task 11 |
| COCO-17 配置驱动骨架 | Task 1 |
| 多人模型（增删/选人/改框改点/撤销） | Task 2 |
| 框⊥点（同一人独立属性） | Task 2,11 |
| 三态可见性 v=0/1/2 | Task 2,11（右键切） |
| 选关节→点图打点 + 自动跳下一关节 | Task 8,11 |
| 列表+画面双向选人 | Task 11（syncUI + hitPerson） |
| SVG 人体图图例 | Task 8 |
| 图像 + 视频输入 | Task 9,11 |
| 缺框→点包围盒自动补齐 | Task 3,4 |
| YOLO-pose 导出（行/yaml/train-val） | Task 4 |
| 「能直接导入训练」验证 | Task 6（离线校验）+ Task 12（冒烟/可选真训练） |
| 目录内存 + 一键导出落盘 | Task 11（DirSource.writeFile） |
| 根入口 + serve 脚本 + 测试集成 | Task 12 |





