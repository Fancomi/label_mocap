# Label 接入云端 GVHMR 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `label/` 标注器中加入云端 GVHMR 推理入口(单帧),并引入「bbox 独立于 SMPL」的数据模型与画布画框交互。

**Architecture:** 内核层 (`smpl_edit/`) 把 bbox 与 SMPL 解耦——靠位姿键是否存在表达「有无 SMPL」,不再自动填零位姿。新增纯逻辑 `gvhmr_client.js` 负责 payload 构造/响应解析/fetch。`label/` 装配两个云端按钮、画框手势、进度浮层,把云端 `annotations[0]` 覆盖进唯一数据源 `AnnotationStore`,并采用云端 cam_K 对齐投影。

**Tech Stack:** 浏览器原生 ES modules、`node --test`(纯逻辑单测)、three.js(浏览器验证)、Fetch + AbortController。

---

## 文件结构

| 文件 | 操作 | 职责 |
| --- | --- | --- |
| `smpl_edit/coco_document.js` | 改 | `defaultAnnotation` 拆分(不自动填位姿);`hasSmpl/hasBbox`;`serialize` 省略缺失键 |
| `smpl_edit/annotation_store.js` | 改 | `setBbox` / `applyCloudResult` / `hasSmpl` / `hasBbox` |
| `smpl_edit/tests/coco_document.test.js` | 改 | 覆盖 bbox⊥SMPL 的存储/序列化 |
| `smpl_edit/tests/annotation_store.test.js` | 改 | 覆盖 setBbox / applyCloudResult / undo |
| `label/src/io/gvhmr_client.js` | 新 | payload 构造 / 响应解析 / fetch I/O / 错误归类 |
| `label/tests/gvhmr_client.test.js` | 新 | gvhmr_client 纯逻辑单测 |
| `label/src/edit/bbox_overlay.js` | 改 | 空画布拖拽新建框手势 |
| `label/src/io/image_bytes.js` | 新 | 当前帧 File/视频帧 → base64(纯逻辑部分可测) |
| `label/index.html` | 改 | bbox tab 内云端控件 + 进度浮层 DOM |
| `label/src/app.js` | 改 | 装配按钮/浮层/base64 提取/cam_K 落地/画框接线 |

> **测试命令约定:** 内核测试 `node --test smpl_edit/tests/<f>.test.js`;label 测试 `node --test label/tests/<f>.test.js`。全量 `npm run test:web`。

---

## Task 1: CocoDocument — 拆分 defaultAnnotation,bbox⊥SMPL

**Files:**
- Modify: `smpl_edit/coco_document.js`
- Test: `smpl_edit/tests/coco_document.test.js`

- [ ] **Step 1: 写失败测试** — 追加到 `smpl_edit/tests/coco_document.test.js` 末尾:

```javascript
test('setAnnotation with only bbox does NOT add SMPL pose keys', () => {
  const doc = new CocoDocument(sampleDoc());
  doc.setAnnotation(1, { bbox: [5, 6, 7, 8] });
  const a = doc.serialize().annotations.find((x) => x.image_id === 1);
  assert.deepEqual(a.bbox, [5, 6, 7, 8]);
  assert.equal('body_pose' in a, false);
  assert.equal('root_pos' in a, false);
  assert.equal('betas' in a, false);
});

test('setAnnotation with only SMPL does NOT add a bbox key', () => {
  const doc = new CocoDocument(sampleDoc());
  doc.setAnnotation(1, { root_pos: [0, 0, -4], root_rota: [0, 0, 0],
    body_pose: Array(63).fill(0), betas: Array(10).fill(0) });
  const a = doc.serialize().annotations.find((x) => x.image_id === 1);
  assert.equal(a.body_pose.length, 63);
  assert.equal('bbox' in a, false);
});

test('hasSmpl / hasBbox reflect independent presence', () => {
  const doc = new CocoDocument(sampleDoc());
  doc.setAnnotation(1, { bbox: [5, 6, 7, 8] });
  assert.equal(doc.hasBbox(1), true);
  assert.equal(doc.hasSmpl(1), false);
  doc.setAnnotation(1, { body_pose: Array(63).fill(0) });
  assert.equal(doc.hasSmpl(1), true);
  assert.equal(doc.hasBbox(1), true);     // bbox still there
});

test('hasBbox is false for the [0,0,0,0] sentinel and for missing key', () => {
  const doc = new CocoDocument(sampleDoc());
  assert.equal(doc.hasBbox(1), false);              // no annotation
  doc.setAnnotation(1, { bbox: [0, 0, 0, 0] });
  assert.equal(doc.hasBbox(1), false);              // sentinel = no box
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test smpl_edit/tests/coco_document.test.js`
Expected: FAIL —— `doc.hasBbox is not a function` 以及 `'body_pose' in a` 为 true(旧 defaultAnnotation 全填)。

- [ ] **Step 3: 改实现** — 替换 `smpl_edit/coco_document.js` 顶部与相关方法:

```javascript
// smpl_edit/coco_document.js
const EDITABLE = ['bbox', 'root_pos', 'root_rota', 'body_pose', 'betas', 'keypoints', 'occlution_joint'];
const SMPL_KEYS = ['root_pos', 'root_rota', 'body_pose', 'betas'];

// 空骨架:只含恒有的元字段。bbox / SMPL 位姿都不预填 —— 由 setAnnotation 按
// 实际传入的 fields 决定,从而让「仅 bbox」「仅 SMPL」成为可表达的合法状态。
function skeletonAnnotation(imageId, nextId) {
  return {
    id: nextId, image_id: imageId,
    iscrowd: 0, area: 0, category_id: 1, segmentation: [],
  };
}
```

`setAnnotation` 改为用 `skeletonAnnotation`:

```javascript
  setAnnotation(imageId, fields) {
    let a = this._byImageId.get(imageId);
    if (!a) { a = skeletonAnnotation(imageId, this._nextId()); this._byImageId.set(imageId, a); }
    for (const key of EDITABLE) {
      if (fields[key] !== undefined) a[key] = structuredClone(fields[key]);
    }
  }
```

在 `getAnnotation` 之后新增:

```javascript
  hasSmpl(imageId) {
    const a = this._byImageId.get(imageId);
    return !!a && 'body_pose' in a;
  }

  hasBbox(imageId) {
    const a = this._byImageId.get(imageId);
    if (!a || !Array.isArray(a.bbox)) return false;
    return a.bbox.some((v) => v !== 0);   // [0,0,0,0] sentinel = no box
  }
```

`serialize()` 不变(已是「只输出存在键」语义:它 structuredClone 当前 annotation 对象,缺失键自然不出现)。

- [ ] **Step 4: 运行验证通过**

Run: `node --test smpl_edit/tests/coco_document.test.js`
Expected: PASS(全部 test,含原有的)。
注意:原测试 `setAnnotation on an empty frame creates an entry with defaults` 断言 `a.keypoints.length===156` 和 `a.body_pose.length===63` —— 它只传了 `{root_pos}`,旧默认会补全所有键。**需更新该旧测试**以匹配新语义:

```javascript
test('setAnnotation on an empty frame creates an entry with only passed fields', () => {
  const doc = new CocoDocument(sampleDoc());
  doc.setAnnotation(1, { root_pos: [0, 0, -4] });
  const a = doc.serialize().annotations.find((x) => x.image_id === 1);
  assert.ok(a);
  assert.equal(a.image_id, 1);
  assert.deepEqual(a.root_pos, [0, 0, -4]);
  assert.equal('body_pose' in a, false);    // not auto-filled anymore
  assert.equal('keypoints' in a, false);
});
```

- [ ] **Step 5: 提交**

```bash
git add smpl_edit/coco_document.js smpl_edit/tests/coco_document.test.js
git commit -m "feat(smpl_edit): decouple bbox from SMPL in CocoDocument

skeletonAnnotation no longer auto-fills zero pose; hasSmpl/hasBbox
report independent presence. bbox-only and smpl-only frames are now
representable and serialize without the absent keys.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: AnnotationStore — setBbox / applyCloudResult / 状态查询

**Files:**
- Modify: `smpl_edit/annotation_store.js`
- Test: `smpl_edit/tests/annotation_store.test.js`

- [ ] **Step 1: 写失败测试** — 追加到 `smpl_edit/tests/annotation_store.test.js` 末尾:

```javascript
test('setBbox on an empty frame creates a bbox-only annotation (no SMPL)', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(1);
  s.setBbox([5, 6, 7, 8]);
  assert.equal(s.hasBbox(), true);
  assert.equal(s.hasSmpl(), false);
  assert.deepEqual(s.current().bbox, [5, 6, 7, 8]);
});

test('setBbox is one undo unit and does not touch SMPL on an existing frame', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(0);                       // has full SMPL + bbox [1,1,1,1]
  s.setBbox([5, 6, 7, 8]);
  assert.deepEqual(s.current().bbox, [5, 6, 7, 8]);
  assert.equal(s.current().body_pose.length, 63);   // SMPL untouched
  s.undo();
  assert.deepEqual(s.current().bbox, [1, 1, 1, 1]);
});

test('applyCloudResult overwrites bbox+SMPL as a single undo unit', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(1);
  s.applyCloudResult({ bbox: [2, 2, 2, 2], root_pos: [1, 1, 1],
    root_rota: [0, 0, 0], body_pose: Array(63).fill(0.1), betas: Array(10).fill(0.2) });
  assert.equal(s.hasSmpl(), true);
  assert.equal(s.current().body_pose[0], 0.1);
  s.undo();
  assert.equal(s.hasData(), false);    // back to empty frame
});

test('hasData is true when only a bbox exists', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(1);
  s.setBbox([5, 6, 7, 8]);
  assert.equal(s.hasData(), true);
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test smpl_edit/tests/annotation_store.test.js`
Expected: FAIL —— `s.setBbox is not a function`。

- [ ] **Step 3: 改实现** — 在 `smpl_edit/annotation_store.js` 中:

`hasData` 改为(bbox 或 SMPL 任一存在):

```javascript
  hasData() {
    const id = this.currentImageId();
    return this._doc.hasBbox(id) || this._doc.hasSmpl(id);
  }
  hasSmpl() { return this._doc.hasSmpl(this.currentImageId()); }
  hasBbox() { return this._doc.hasBbox(this.currentImageId()); }
```

在 `deleteCurrent()` 之后新增:

```javascript
  // 仅写 bbox(不碰 SMPL),一个 undo 单元。画框 / 云端给框用。
  setBbox(bbox) { this._txn((id) => this._doc.setAnnotation(id, { bbox })); }

  // 覆盖云端返回的 bbox + SMPL,一个 undo 单元。当前帧已有标注时直接覆盖。
  applyCloudResult({ bbox, root_pos, root_rota, body_pose, betas }) {
    this._txn((id) => this._doc.setAnnotation(id, { bbox, root_pos, root_rota, body_pose, betas }));
  }
```

注意 `current()` 返回 `getAnnotation()`,对仅 bbox 帧返回的对象**没有** `root_pos` 等键 —— 调用方(app.js)需先判 `hasSmpl()` 再读位姿(见 Task 7)。

- [ ] **Step 4: 运行验证通过**

Run: `node --test smpl_edit/tests/annotation_store.test.js`
Expected: PASS。注意原测试 `addTpose creates a default-centered annotation` 仍应通过(addTpose 显式写 `root_pos`)。

- [ ] **Step 5: 提交**

```bash
git add smpl_edit/annotation_store.js smpl_edit/tests/annotation_store.test.js
git commit -m "feat(smpl_edit): AnnotationStore setBbox + applyCloudResult

setBbox writes a bbox-only annotation without SMPL; applyCloudResult
overwrites bbox+pose as one undo unit. hasData/hasBbox/hasSmpl track
the two parts independently.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---
## Task 3: gvhmr_client — payload 构造 / 响应解析 / 字段映射(纯逻辑)

**Files:**
- Create: `label/src/io/gvhmr_client.js`
- Test: `label/tests/gvhmr_client.test.js`

- [ ] **Step 1: 写失败测试** — 新建 `label/tests/gvhmr_client.test.js`:

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPayload, parseInferResponse, cloudResultToFields } from '../src/io/gvhmr_client.js';

test('buildPayload link1 (no bbox) carries only image_b64 + file_name', () => {
  const p = buildPayload({ imageB64: 'AAA', fileName: '0001.jpg' });
  assert.deepEqual(p, { image_b64: 'AAA', file_name: '0001.jpg' });
});

test('buildPayload link2 includes bbox [x,y,w,h]', () => {
  const p = buildPayload({ imageB64: 'AAA', fileName: '0001.jpg', bbox: [1, 2, 3, 4] });
  assert.deepEqual(p.bbox, [1, 2, 3, 4]);
  assert.equal(p.image_b64, 'AAA');
});

function okDoc() {
  return {
    images: [{ id: 0, cam_K: [900, 0, 320, 0, 900, 240, 0, 0, 1] }],
    annotations: [{
      bbox: [10, 20, 30, 40], root_pos: [0, 0, -4], root_rota: [0, 0, 0],
      body_pose: Array(63).fill(0), betas: Array(10).fill(0), keypoints: Array(156).fill(0),
    }],
  };
}

test('parseInferResponse extracts ann + camK from a valid doc', () => {
  const { ann, camK } = parseInferResponse(okDoc());
  assert.deepEqual(ann.bbox, [10, 20, 30, 40]);
  assert.equal(ann.body_pose.length, 63);
  assert.deepEqual(camK, [900, 0, 320, 0, 900, 240, 0, 0, 1]);
});

test('parseInferResponse throws on missing annotations', () => {
  assert.throws(() => parseInferResponse({ images: [{ id: 0 }], annotations: [] }),
    /no annotations/i);
});

test('parseInferResponse throws on wrong body_pose length', () => {
  const d = okDoc(); d.annotations[0].body_pose = Array(10).fill(0);
  assert.throws(() => parseInferResponse(d), /body_pose/i);
});

test('cloudResultToFields maps the five editable fields', () => {
  const { ann } = parseInferResponse(okDoc());
  const f = cloudResultToFields(ann);
  assert.deepEqual(Object.keys(f).sort(),
    ['betas', 'bbox', 'body_pose', 'root_pos', 'root_rota']);
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test label/tests/gvhmr_client.test.js`
Expected: FAIL —— 无法解析模块 / 函数未定义。

- [ ] **Step 3: 写实现** — 新建 `label/src/io/gvhmr_client.js`:

```javascript
// label/src/io/gvhmr_client.js
// 云端 GVHMR 推理客户端。纯逻辑(payload/解析/映射)与 fetch I/O 分离:
// 纯逻辑可 node --test 覆盖;inferGvhmr 走真实网络,浏览器验证。

export const DEFAULT_ENDPOINT = 'http://10.52.104.78:8666/gvhmr/infer';

// 链路1: 仅 image_b64(+file_name);链路2: 追加 bbox=[x,y,w,h]。
export function buildPayload({ imageB64, fileName, bbox }) {
  const p = { image_b64: imageB64 };
  if (fileName) p.file_name = fileName;
  if (Array.isArray(bbox) && bbox.length === 4) p.bbox = bbox.slice();
  return p;
}

// 校验并抽取 {ann, camK}。维度不符 / 缺 annotations 抛带说明的错误。
export function parseInferResponse(doc) {
  const anns = doc && doc.annotations;
  if (!Array.isArray(anns) || anns.length === 0) {
    throw new Error('云端返回无 annotations');
  }
  const ann = anns[0];
  if (!Array.isArray(ann.body_pose) || ann.body_pose.length !== 63) {
    throw new Error(`body_pose 维度异常: ${ann.body_pose && ann.body_pose.length}`);
  }
  if (!Array.isArray(ann.betas) || ann.betas.length !== 10) {
    throw new Error(`betas 维度异常: ${ann.betas && ann.betas.length}`);
  }
  const camK = doc.images && doc.images[0] ? doc.images[0].cam_K : null;
  return { ann, camK };
}

// 映射成 AnnotationStore.applyCloudResult 的字段对象(只取五个可编辑字段)。
export function cloudResultToFields(ann) {
  return {
    bbox: ann.bbox, root_pos: ann.root_pos, root_rota: ann.root_rota,
    body_pose: ann.body_pose, betas: ann.betas,
  };
}

// 网络 I/O(浏览器验证):POST JSON,AbortController 控超时/取消,错误归类为中文。
export async function inferGvhmr({ endpoint, imageB64, fileName, bbox, signal, timeoutMs = 60000 }) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload({ imageB64, fileName, bbox })),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      if (resp.status === 503) throw new Error('云端服务繁忙(503),请稍后重试');
      if (resp.status === 400) throw new Error('请求无效(400):图像或 bbox 不合法');
      throw new Error(`云端返回 HTTP ${resp.status}`);
    }
    return parseInferResponse(await resp.json());
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('已取消 / 云端超时');
    if (e instanceof TypeError) throw new Error('无法连接云端,请检查地址与网络');
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test label/tests/gvhmr_client.test.js`
Expected: PASS(6 个 test)。`inferGvhmr` 不在单测覆盖(走网络),浏览器验证。

- [ ] **Step 5: 提交**

```bash
git add label/src/io/gvhmr_client.js label/tests/gvhmr_client.test.js
git commit -m "feat(label): gvhmr_client — payload/parse/map + fetch I/O

Pure buildPayload/parseInferResponse/cloudResultToFields unit-tested;
inferGvhmr wraps fetch with AbortController and Chinese error classes.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---
## Task 4: image_bytes — 字节 → base64(纯逻辑可测部分)

**Files:**
- Create: `label/src/io/image_bytes.js`
- Test: `label/tests/image_bytes.test.js`

- [ ] **Step 1: 写失败测试** — 新建 `label/tests/image_bytes.test.js`:

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bytesToBase64 } from '../src/io/image_bytes.js';

test('bytesToBase64 encodes a known byte sequence', () => {
  // "Man" => "TWFu"  (classic base64 test vector)
  const bytes = new Uint8Array([0x4d, 0x61, 0x6e]);
  assert.equal(bytesToBase64(bytes), 'TWFu');
});

test('bytesToBase64 handles empty input', () => {
  assert.equal(bytesToBase64(new Uint8Array([])), '');
});

test('bytesToBase64 pads correctly for non-3-multiple length', () => {
  // "M" => "TQ=="
  assert.equal(bytesToBase64(new Uint8Array([0x4d])), 'TQ==');
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test label/tests/image_bytes.test.js`
Expected: FAIL —— `bytesToBase64 is not a function`。

- [ ] **Step 3: 写实现** — 新建 `label/src/io/image_bytes.js`:

```javascript
// label/src/io/image_bytes.js
// 当前帧图像 → base64(喂给 gvhmr_client)。bytesToBase64 是纯逻辑(可单测);
// fileToBase64 / videoFrameToBase64 走浏览器 API(浏览器验证)。

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Uint8Array → base64 字符串。不依赖 btoa(Node 测试环境也能跑),手写 3→4 编码。
export function bytesToBase64(bytes) {
  let out = '';
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < n ? bytes[i + 1] : 0;
    const b2 = i + 2 < n ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < n ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < n ? B64[b2 & 63] : '=';
  }
  return out;
}

// 图像 File → base64(去掉 data: 前缀,只要裸 b64)。
export async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}

// 视频当前帧 → base64(jpeg)。把 VideoTexture 背后的 <video> 当前帧画到离屏 canvas。
// videoEl: HTMLVideoElement(VideoSource 内部的 ._video,见下);复用单例 canvas。
let _frameCanvas = null;
export async function videoFrameToBase64(videoEl) {
  const w = videoEl.videoWidth, h = videoEl.videoHeight;
  if (!_frameCanvas) _frameCanvas = document.createElement('canvas');
  _frameCanvas.width = w; _frameCanvas.height = h;
  _frameCanvas.getContext('2d').drawImage(videoEl, 0, 0, w, h);
  const blob = await new Promise((res) => _frameCanvas.toBlob(res, 'image/jpeg', 0.92));
  return fileToBase64(blob);
}
```

注:`videoFrameToBase64` 需要 `VideoSource` 暴露其内部 `<video>` 元素。在 Task 7 接线时,给
`label/src/io/video_source.js` 加一个 getter `get videoEl() { return this._video; }`(一行,
随 Task 7 提交)。

- [ ] **Step 4: 运行验证通过**

Run: `node --test label/tests/image_bytes.test.js`
Expected: PASS(3 个 test)。

- [ ] **Step 5: 提交**

```bash
git add label/src/io/image_bytes.js label/tests/image_bytes.test.js
git commit -m "feat(label): image_bytes — frame bytes to base64

bytesToBase64 pure + unit-tested; fileToBase64/videoFrameToBase64
wrap browser APIs for the cloud call.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: BboxOverlay — 空画布拖拽新建框

**Files:**
- Modify: `label/src/edit/bbox_overlay.js`
- 说明:本任务为 three/DOM 交互,**浏览器验证**(无新单测)。`resizeBboxByCorner` 已在
  `label/tests/bbox_edit.test.js` 覆盖;新建框复用同一规范化逻辑。

- [ ] **Step 1: 改实现** — 在 `BboxOverlay` 构造参数加 `getCanDraw`,并新增空画布画框手势。

构造函数签名改为:

```javascript
  constructor({ stageEl, canvasEl, getCam, getStore, getBboxVisible, getCanDraw, onEdit }) {
    this._stage = stageEl;
    this._canvas = canvasEl;
    this._getCam = getCam;
    this._getStore = getStore;
    this._getBboxVisible = getBboxVisible || (() => true);
    this._getCanDraw = getCanDraw || (() => false);   // 仅 Bbox tab + 无框 + 非只读时为 true
    this._onEdit = onEdit || (() => {});
    this._bbox = null;
    this._editing = false;
    // ...(以下 box / handles 构造保持不变)
```

在构造函数末尾(`this._onUp = ...` 之后)新增画布按下监听 + 拖拽状态:

```javascript
    // 空画布画框:仅当 getCanDraw() 为真(Bbox tab + 当前帧无框 + 非只读)时拦截
    // 画布 pointerdown,拖出一个新框。位移 < 4px 视作点击,不建框。
    this._draw = null;  // { x0, y0, id } 像素起点
    this._canvas.addEventListener('pointerdown', (e) => this._onDrawDown(e));
```

新增三个方法(放在 `_onPointerUp` 之后):

```javascript
  _eventToImg(e) {
    const cam = this._getCam();
    const rect = this._canvas.getBoundingClientRect();
    const stageRect = this._stage.getBoundingClientRect();
    const sx = e.clientX - stageRect.left;
    const sy = e.clientY - stageRect.top;
    return this._screenToImg(sx, sy, cam, rect, stageRect);
  }

  _onDrawDown(e) {
    if (!this._getCanDraw()) return;
    const cam = this._getCam();
    if (!cam || cam.mode !== '2d') return;
    const [ix, iy] = this._eventToImg(e);
    this._draw = { x0: ix, y0: iy, sx: e.clientX, sy: e.clientY, id: e.pointerId, moved: false };
    this._canvas.setPointerCapture(e.pointerId);
    this._drawMove = (ev) => this._onDrawMove(ev);
    this._drawUp = (ev) => this._onDrawUp(ev);
    window.addEventListener('pointermove', this._drawMove);
    window.addEventListener('pointerup', this._drawUp);
    e.preventDefault();
    e.stopPropagation();
  }

  _onDrawMove(e) {
    if (!this._draw) return;
    if (!this._draw.moved && Math.hypot(e.clientX - this._draw.sx, e.clientY - this._draw.sy) > 4) {
      this._draw.moved = true;
    }
    if (!this._draw.moved) return;
    const [ix, iy] = this._eventToImg(e);
    const x = Math.min(this._draw.x0, ix), y = Math.min(this._draw.y0, iy);
    const w = Math.abs(ix - this._draw.x0), h = Math.abs(iy - this._draw.y0);
    this.render([x, y, w, h]);          // live preview (not yet committed)
  }

  _onDrawUp(e) {
    window.removeEventListener('pointermove', this._drawMove);
    window.removeEventListener('pointerup', this._drawUp);
    try { this._canvas.releasePointerCapture(this._draw?.id); } catch (_) {}
    const draw = this._draw; this._draw = null;
    if (!draw || !draw.moved) return;    // pure click → no box
    const [ix, iy] = this._eventToImg(e);
    const x = Math.min(draw.x0, ix), y = Math.min(draw.y0, iy);
    const w = Math.abs(ix - draw.x0), h = Math.abs(iy - draw.y0);
    if (w < 1 || h < 1) return;
    const store = this._getStore();
    if (store) { store.setBbox([x, y, w, h]); this._onEdit(); }
    this.render([x, y, w, h]);
  }

  // 画框手势是否正在进行(供 engageGuards 聚合,使画布平移/拾取让位)。
  isEngaged() { return this._draw !== null && this._draw.moved; }
  isDragging() { return this.isEngaged(); }
```

- [ ] **Step 2: 浏览器验证(手动)**

Run: `npm run serve:label` → 打开 http://127.0.0.1:5175/label/
打开一个**无 json** 的图像目录 → 切到「框」tab → 在画布空白处拖拽 → 应画出黄框并落为「仅 bbox」标注;
松开后四角可继续拖动调整;已有框时空白拖拽不再新建。
Expected: 画框成功,`anno-state` 显示已有框,SMPL 网格**不出现**(无 SMPL)。

- [ ] **Step 3: 提交**

```bash
git add label/src/edit/bbox_overlay.js
git commit -m "feat(label): draw a new bbox on empty canvas in Bbox tab

When the frame has no box (getCanDraw), drag on the canvas to create
one via store.setBbox; <4px is a click. Existing boxes keep corner-drag.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---
## Task 6: index.html — 云端控件 + 进度浮层 DOM

**Files:**
- Modify: `label/index.html`
- 说明:纯标记改动,**浏览器验证**。

- [ ] **Step 1: 改 bbox tabpanel** — 把 `label/index.html:172-176` 的 bbox section 替换为:

```html
    <section class="tabpanel" data-mode="bbox" hidden>
      <p class="hint">在 2D 对齐视角下:画布空白处拖拽可新建框;已有框拖四角调整;或从人体投影。</p>
      <button id="btn-bbox-auto">⌖ 从人体投影生成框</button>
      <div id="bbox-ro" class="status">—</div>
      <div class="card">
        <h3>云端 GVHMR 推理</h3>
        <label style="font-size:11px;color:#9ab">云端地址</label>
        <input type="text" id="gvhmr-endpoint" style="width:100%;box-sizing:border-box"
               value="http://10.52.104.78:8666/gvhmr/infer">
        <div class="row" style="margin-top:6px">
          <button id="btn-gvhmr-plain">☁ 纯图推理</button>
          <button id="btn-gvhmr-bbox">☁ 带框推理</button>
        </div>
        <p class="hint">纯图:服务端自动检测人体。带框:用当前框(无框时禁用)。</p>
      </div>
    </section>
```

- [ ] **Step 2: 加进度浮层** — 在 `<aside id="right" ...>` 之前(紧跟 `#stage` 关闭后)插入模态浮层:

```html
  <div id="gvhmr-overlay" hidden style="position:fixed;inset:0;z-index:100;
       background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center">
    <div style="background:#1b1f27;border:1px solid #3a4150;border-radius:8px;padding:22px 28px;
         display:flex;flex-direction:column;gap:14px;align-items:center;min-width:220px">
      <div id="gvhmr-msg" style="color:#9ecbff">云端推理中…</div>
      <div class="spinner" style="width:26px;height:26px;border:3px solid #3a4150;
           border-top-color:#3399ff;border-radius:50%;animation:spin 0.9s linear infinite"></div>
      <button id="gvhmr-cancel">取消</button>
    </div>
  </div>
```

并在 `<style>` 中加一条动画(任意位置):

```css
    @keyframes spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 3: 浏览器验证(手动)**

Run: `npm run serve:label` → 打开 http://127.0.0.1:5175/label/ → 切到「框」tab。
Expected: 看到「云端地址」输入框(默认值已填)+ 两个按钮;`#gvhmr-overlay` 默认隐藏。

- [ ] **Step 4: 提交**

```bash
git add label/index.html
git commit -m "feat(label): cloud GVHMR controls + progress overlay markup

Endpoint input (default URL), plain/bbox infer buttons in Bbox tab,
and a modal spinner overlay with a cancel button.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: app.js — 装配按钮 / base64 / cam_K 落地 / 画框接线

**Files:**
- Modify: `label/src/app.js`
- Modify: `label/src/io/video_source.js`(加 `videoEl` getter)
- 说明:装配层,**浏览器验证**。所有被调用的纯函数已在 Task 1–4 单测覆盖。

- [ ] **Step 1: video_source 暴露 videoEl** — 在 `label/src/io/video_source.js` 的 `get texture()` 之后加:

```javascript
  get videoEl() { return this._video; }
```

- [ ] **Step 2: app.js 引入新模块** — 在 `label/src/app.js` 顶部 import 区追加:

```javascript
import { DEFAULT_ENDPOINT, inferGvhmr, cloudResultToFields } from './io/gvhmr_client.js';
import { fileToBase64, videoFrameToBase64 } from './io/image_bytes.js';
```

- [ ] **Step 3: BboxOverlay 接入 getCanDraw + 并入 guards** — 改 `bboxOverlay` 构造(`label/src/app.js:450-457`):

```javascript
  bboxOverlay = new BboxOverlay({
    stageEl: $('stage'),
    canvasEl: $('c'),
    getCam: () => cam,
    getStore: () => store,
    getBboxVisible: () => ui?.mode === 'bbox',
    getCanDraw: () => !!store && ui?.mode === 'bbox' && cam?.mode === '2d'
      && !ui?.readOnly && !store.hasBbox(),
    onEdit: applyAnnotation,
  });
```

并把 bboxOverlay 并入守卫聚合(`label/src/app.js:460-461` 之后):

```javascript
  dragGuards.push(bboxOverlay);
  engageGuards.push(bboxOverlay);
```

- [ ] **Step 4: 当前帧 base64 提取辅助** — 在 `applyAnnotation` 之后新增:

```javascript
  // 取当前显示帧的图像 base64(唯一来源:images / videoSource,不另存副本)。
  async function currentFrameBase64() {
    if (videoSource) return videoFrameToBase64(videoSource.videoEl);
    const file = images.get(store.currentFrame());
    if (!file) throw new Error('当前帧没有可用图像');
    return fileToBase64(file);
  }

  function currentFileName() {
    const file = videoSource ? null : images.get(store.currentFrame());
    return file ? file.name : `frame_${store.currentFrame()}.jpg`;
  }
```

- [ ] **Step 5: cam_K 落地辅助** — 在上面之后新增(把云端 9 元素 cam_K 行主序映射为 fx/fy/cx/cy):

```javascript
  // 云端 cam_K = [fx,0,cx, 0,fy,cy, 0,0,1](行主序)。采用为当前相机内参,
  // 并写入当前帧 images[].cam_K(cam_K 真相在数据,cam.K 为运行时镜像)。
  function adoptCamK(camK) {
    if (!Array.isArray(camK) || camK.length < 9) return;
    const fx = camK[0], fy = camK[4], cx = camK[2], cy = camK[5];
    cam.setIntrinsics({ fx, fy, cx, cy });
    const info = store.document().imageInfo(store.currentImageId());
    if (info) info.cam_K = camK.slice();
  }
```

- [ ] **Step 6: 云端调用驱动** — 在上面之后新增进度浮层 + 调用编排:

```javascript
  let gvhmrAbort = null;
  function showGvhmrOverlay(on, msg) {
    const ov = $('gvhmr-overlay'); if (!ov) return;
    if (msg) $('gvhmr-msg').textContent = msg;
    ov.hidden = !on;
  }

  // withBbox=false → 链路1(纯图);true → 链路2(带当前帧 bbox)。
  async function runGvhmr(withBbox) {
    if (!store || ui?.readOnly) return;
    const frameAtStart = store.currentFrame();      // 落地前校验仍在原帧
    const bbox = withBbox ? store.current()?.bbox : undefined;
    if (withBbox && !store.hasBbox()) { setStatus('当前帧无框,无法带框推理'); return; }
    setPlaying(false);
    gvhmrAbort = new AbortController();
    showGvhmrOverlay(true, '云端推理中…');
    try {
      const imageB64 = await currentFrameBase64();
      const { ann, camK } = await inferGvhmr({
        endpoint: $('gvhmr-endpoint')?.value || DEFAULT_ENDPOINT,
        imageB64, fileName: currentFileName(), bbox, signal: gvhmrAbort.signal,
      });
      if (store.currentFrame() !== frameAtStart) { setStatus('已切帧,放弃本次结果'); return; }
      store.applyCloudResult(cloudResultToFields(ann));   // 一个 undo 单元,直接覆盖
      adoptCamK(camK);
      await showFrame(frameAtStart);
      setStatus('云端推理完成');
    } catch (e) {
      setStatus(String(e.message || e));
    } finally {
      showGvhmrOverlay(false);
      gvhmrAbort = null;
    }
  }
```

- [ ] **Step 7: 绑定按钮** — 在 `boot()` 内 `$('btn-bbox-auto')` 监听之后绑定三个控件:

```javascript
  $('btn-gvhmr-plain').addEventListener('click', () => runGvhmr(false));
  $('btn-gvhmr-bbox').addEventListener('click', () => runGvhmr(true));
  $('gvhmr-cancel').addEventListener('click', () => { if (gvhmrAbort) gvhmrAbort.abort(); });
```

- [ ] **Step 8: 带框按钮可用性 + 状态文案** — 在 `syncUI` 末尾(`renderAnnoActions()` 调用前)追加:

```javascript
    const bboxBtn = $('btn-gvhmr-bbox');
    if (bboxBtn) bboxBtn.disabled = !(store && store.hasBbox() && !ui.readOnly);
```

并改 `renderAnnoActions()` 的状态文案以反映 bbox⊥SMPL(替换 `$('anno-state').textContent = ...` 一行):

```javascript
  const hasB = store && store.hasBbox();
  const hasS = store && store.hasSmpl();
  $('anno-state').textContent = !store ? '—'
    : (hasB && hasS) ? '✅ 框 + SMPL'
    : hasS ? '🧍 已有 SMPL'
    : hasB ? '📦 仅框选(可云端推理)'
    : '— 本帧无标注';
```

注意 `renderAnnoActions()` 里 `const has = store && store.hasData();` 控制「删除/新建」按钮 —— 保持不变(hasData 现含「有框或有 SMPL」)。但 buildFrame/applyAnnotation 仅在有 SMPL 时渲染:确认 `showFrame` 中 `const a = store.current(); if (a) {...}` 改为按 `hasSmpl()` 渲染网格(见 Step 9)。

- [ ] **Step 9: 仅 bbox 帧不渲染网格** — 改 `showFrame`(`label/src/app.js:252-265`)的判断,从「有 annotation」改为「有 SMPL」:

```javascript
  const a = store.current();
  if (a && store.hasSmpl()) {
    rotation = RotationState.fromAxisAngle({ root_rota: a.root_rota, body_pose: a.body_pose });
    applyAnnotation();
    scene.setPersonVisible(true);
  } else {
    rotation = null;
    lastVertices = null; lastJoints = null; lastWorldRot = null;
    scene.setPersonVisible(false);
    if (panels) panels.syncFromState();
    if (bboxOverlay) bboxOverlay.render(a && store.hasBbox() ? a.bbox : null);
  }
```

这样仅 bbox 帧:不渲染 SMPL 网格,但若在 Bbox tab 仍能显示/编辑那个框。

- [ ] **Step 10: 浏览器验证(手动,需云端可达)**

Run: `npm run serve:label` → http://127.0.0.1:5175/label/
1. 打开一个无 json 的图像目录,切「框」tab → 点「☁ 纯图推理」→ 浮层出现 → 云端返回后人体出现、投影对齐。
2. 在无框帧画一个框 → 「带框推理」可点 → 返回后人体出现,bbox 被云端框覆盖。
3. 推理中点「取消」→ 浮层关闭,数据不变。
4. 对已有标注帧推理 → 覆盖;Ctrl+Z 一次性还原。
Expected: 以上均成立;无框时「带框推理」按钮置灰。

- [ ] **Step 11: 全量测试 + 提交**

Run: `npm run test:web`
Expected: PASS(含 Task 1–4 的新测试)。

```bash
git add label/src/app.js label/src/io/video_source.js
git commit -m "feat(label): wire cloud GVHMR call, base64 capture, cam_K adopt

Two infer buttons (plain/bbox) drive inferGvhmr behind a progress
overlay; result overwrites the current frame as one undo unit and
adopts the cloud cam_K. bbox-only frames render the box but no mesh.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review 结果

**Spec 覆盖:**
- §2 数据模型 (bbox⊥SMPL, hasSmpl/hasBbox, serialize 省略) → Task 1 ✅
- §2.2 setBbox / applyCloudResult → Task 2 ✅
- §3 画框交互 → Task 5 ✅
- §4.1 gvhmr_client → Task 3 ✅；§4.2 base64 → Task 4 ✅；§4.3 cam_K → Task 7 Step 5 ✅
- §5 端到端数据流 → Task 7 ✅
- §6 内存(局部变量/AbortController/单例 canvas) → Task 3/4/7 ✅
- §7 进度与错误 UI → Task 6 + Task 7 Step 6 ✅
- §8 面板按钮 + 状态文案 → Task 6 + Task 7 Step 8 ✅
- §10 测试 → Task 1–4 单测,Task 5/6/7 浏览器验证 ✅

**占位符扫描:** 无 TBD/TODO;每个改代码的步骤都有完整代码。

**类型/命名一致性:** `setBbox`/`applyCloudResult`/`hasSmpl`/`hasBbox`/`cloudResultToFields`/
`parseInferResponse`/`buildPayload`/`inferGvhmr`/`bytesToBase64`/`getCanDraw`/`adoptCamK`/
`runGvhmr` 在各任务间用法一致。`applyCloudResult` 字段对象与 `cloudResultToFields` 输出键一致
(bbox/root_pos/root_rota/body_pose/betas)。

**已知边界:** cam_K 的「位移统一内参」转换为后续迭代(spec §11 非目标);本期只保证当前帧对齐。
