# PCD 三视口 + F 聚焦 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pcd 三视口（主透视 + 侧/正正交参考视，单 renderer scissor 分区、可拖分隔条/预设布局、参考视可锁可微调），label 与 pcd 每视口 F 键聚焦人体中心、R 键重置朝向并解锁。

**Architecture:** 新增共享内核纯逻辑模块 `framing.js`（人体包围 + 聚焦摆位）、`viewport.js`（单视口封装 camera/controls/scissor/锁/重置）、`viewport_manager.js`（多视口逐区渲染 + 指针路由 + 布局，纯函数 `hitTest`/`computeRects` 可单测）。gizmo/picker 从「构造绑死 camera」重构为「动态读 active 视口相机」。label 保持单视口，仅复用 framing 接 F（3D only）。

**Tech Stack:** Vanilla ES modules, three.js（vendored，importmap），`node --test`。无构建步骤。

---

## 文件结构

- **新建** `smpl_edit/framing.js` — 纯函数：`bodyBounds(joints)`、`focusPlacement(view, center, radius)`。单测。
- **新建** `smpl_edit/tests/framing.test.js`
- **新建** `smpl_edit/viewport_layout.js` — 纯函数：`computeRects(preset, splits)`、`hitTest(nx, ny, rects)`。单测。
- **新建** `smpl_edit/tests/viewport_layout.test.js`
- **新建** `smpl_edit/viewport.js` — `Viewport` 类（browser-only：camera/controls/scissor/lock/reset/focus）。
- **新建** `smpl_edit/viewport_manager.js` — `ViewportManager` 类（browser-only：逐区渲染、指针路由、布局应用）。
- **改** `smpl_edit/joint_picker.js` — 加 `setCamera()`，active 视口切换时更新相机。
- **改** `smpl_edit/pose_gizmo.js`、`smpl_edit/root_handle.js`、`smpl_edit/drag_handle.js` — TransformControls 相机动态切换（`setCamera`）。
- **改** `pcd_label/src/scene/pcd_scene.js` — `render()` 委托 ViewportManager 逐区渲染。
- **改** `pcd_label/src/app.js` — 装配三视口、分隔条/预设 UI、F/R 键、锁。
- **改** `pcd_label/index.html` — stage 内分隔条 + 视口控制条 DOM/CSS。
- **改** `label/src/scene/camera_modes.js` — 加 `focusOn(center, radius)`（3D）。
- **改** `label/src/app.js` — F 键（3D only）。

测试约定：纯逻辑（framing、viewport_layout）单测；three.js/DOM（viewport、manager、gizmo 改造、app 接线）浏览器验。

---

## Task 1: framing.js — 人体包围与聚焦摆位（纯逻辑）

**Files:**
- Create: `smpl_edit/framing.js`
- Test: `smpl_edit/tests/framing.test.js`

- [ ] **Step 1: 写失败测试**

Create `smpl_edit/tests/framing.test.js`:

```javascript
// smpl_edit/tests/framing.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bodyBounds, focusPlacement } from '../framing.js';

const j = (pts) => { const a = new Float32Array(24 * 3); pts.forEach(([i, x, y, z]) => { a[i*3]=x; a[i*3+1]=y; a[i*3+2]=z; }); return a; };

test('bodyBounds returns center + radius over non-zero joints', () => {
  const joints = j([[0, 0, 0, 0], [1, 2, 0, 0]]); // 仅 0 与 1 非零,其余为 0
  const b = bodyBounds(joints);
  assert.ok(b);
  // 含被显式置零的关节在内,min/max 跨度由全 24 点决定;此处所有点都在 [0..2] 区间
  assert.equal(b.center.length, 3);
  assert.ok(b.radius > 0);
});

test('bodyBounds centers on the AABB midpoint', () => {
  const joints = j([[0, -1, -1, -1], [1, 3, 5, 7]]); // 其余关节为 0 → 参与包围
  const b = bodyBounds(joints);
  // AABB: x[-1,3] y[-1,5] z[-1,7] → center (1,2,3)
  assert.deepEqual(b.center.map((v) => Math.round(v)), [1, 2, 3]);
});

test('bodyBounds returns null for null/empty joints', () => {
  assert.equal(bodyBounds(null), null);
  assert.equal(bodyBounds(new Float32Array(0)), null);
});

test('focusPlacement keeps direction, moves target to center, scales distance with radius', () => {
  const view = { position: [0, 0, 10], target: [0, 0, 0] }; // 看向 -Z
  const out = focusPlacement(view, [1, 1, 1], 2);
  assert.deepEqual(out.target, [1, 1, 1]);            // target = center
  // 方向不变:position→target 单位向量仍是 (0,0,-1)
  const dir = [out.target[0]-out.position[0], out.target[1]-out.position[1], out.target[2]-out.position[2]];
  const L = Math.hypot(...dir);
  assert.ok(Math.abs(dir[0]/L - 0) < 1e-9 && Math.abs(dir[1]/L - 0) < 1e-9 && Math.abs(dir[2]/L + 1) < 1e-9);
  // 距离 = radius * DIST_FACTOR(>0)
  assert.ok(L > 2);
});

test('focusPlacement falls back to a default direction when position==target', () => {
  const out = focusPlacement({ position: [5, 5, 5], target: [5, 5, 5] }, [0, 0, 0], 1);
  assert.deepEqual(out.target, [0, 0, 0]);
  assert.ok(Number.isFinite(out.position[0]) && Number.isFinite(out.position[1]) && Number.isFinite(out.position[2]));
  const d = Math.hypot(out.position[0], out.position[1], out.position[2]);
  assert.ok(d > 0); // 不退化为零向量
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test smpl_edit/tests/framing.test.js`
Expected: FAIL — `Cannot find module '../framing.js'`。

- [ ] **Step 3: 实现 framing.js**

Create `smpl_edit/framing.js`:

```javascript
// smpl_edit/framing.js
// 取景纯逻辑:人体关节包围 + 「聚焦」相机摆位。无 DOM / 无 three.js。
// F 键聚焦与视角重置都基于此。joints 为 Float32Array(24*3) 世界坐标。
const DIST_FACTOR = 2.4; // 距离 = radius * DIST_FACTOR,使人体充满又留余白

// 人体 AABB 中心 + 包围半径(到中心的最大距离)。null/空返回 null。
export function bodyBounds(joints) {
  if (!joints || joints.length < 3) return null;
  const n = Math.floor(joints.length / 3);
  let minx = Infinity, miny = Infinity, minz = Infinity;
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = joints[i*3], y = joints[i*3+1], z = joints[i*3+2];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  const center = [(minx+maxx)/2, (miny+maxy)/2, (minz+maxz)/2];
  const radius = Math.max(
    Math.hypot(maxx-center[0], maxy-center[1], maxz-center[2]), 1e-3);
  return { center, radius };
}

// 保持相机朝向(position→target 方向),把 target 移到 center,
// 并沿该方向退开 radius*DIST_FACTOR。position==target 时落一个稳定默认方向。
export function focusPlacement(view, center, radius) {
  let dx = view.target[0]-view.position[0];
  let dy = view.target[1]-view.position[1];
  let dz = view.target[2]-view.position[2];
  let L = Math.hypot(dx, dy, dz);
  if (L < 1e-9) { dx = 0; dy = 0; dz = -1; L = 1; } // 退化:默认看向 -Z
  const ux = dx/L, uy = dy/L, uz = dz/L;            // 视线单位向量(由相机指向目标)
  const dist = Math.max(radius, 1e-3) * DIST_FACTOR;
  return {
    target: center.slice(),
    position: [center[0]-ux*dist, center[1]-uy*dist, center[2]-uz*dist],
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test smpl_edit/tests/framing.test.js`
Expected: 5 PASS。

- [ ] **Step 5: 提交**

```bash
git add smpl_edit/framing.js smpl_edit/tests/framing.test.js
git commit -m "feat(viewport): framing.js — body bounds + focus placement (pure)"
```

---

## Task 2: viewport_layout.js — 布局矩形与命中测试（纯逻辑）

**Files:**
- Create: `smpl_edit/viewport_layout.js`
- Test: `smpl_edit/tests/viewport_layout.test.js`

矩形用归一化坐标 `{ x, y, w, h }`，原点左上、范围 [0,1]（与 DOM 像素一致；渲染时再翻 Y 转成 GL 坐标）。

- [ ] **Step 1: 写失败测试**

Create `smpl_edit/tests/viewport_layout.test.js`:

```javascript
// smpl_edit/tests/viewport_layout.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeRects, hitTest } from '../viewport_layout.js';

test('single preset → one full-frame rect named main', () => {
  const rects = computeRects('single', { v: 0.7, h: 0.5 });
  assert.equal(rects.length, 1);
  assert.deepEqual(rects[0], { name: 'main', x: 0, y: 0, w: 1, h: 1 });
});

test('tri preset → main left, side top-right, front bottom-right; widths/heights sum to full', () => {
  const rects = computeRects('tri', { v: 0.7, h: 0.5 });
  const main = rects.find((r) => r.name === 'main');
  const side = rects.find((r) => r.name === 'side');
  const front = rects.find((r) => r.name === 'front');
  assert.deepEqual(main, { name: 'main', x: 0, y: 0, w: 0.7, h: 1 });
  // 右栏从 x=0.7 起,宽 0.3;上下按 h=0.5 切
  assert.equal(side.x, 0.7); assert.equal(side.w, 0.3 + 0 * 1); // 宽度 = 1 - v
  assert.ok(Math.abs(side.w - 0.3) < 1e-9);
  assert.equal(side.y, 0); assert.ok(Math.abs(side.h - 0.5) < 1e-9);
  assert.ok(Math.abs(front.y - 0.5) < 1e-9); assert.ok(Math.abs(front.h - 0.5) < 1e-9);
});

test('main-big preset → references occupy a thin right strip', () => {
  const rects = computeRects('main-big', { v: 0.7, h: 0.5 });
  const main = rects.find((r) => r.name === 'main');
  assert.ok(main.w >= 0.8); // 主视更宽
  assert.equal(rects.length, 3);
});

test('hitTest returns the rect name under a normalized point', () => {
  const rects = computeRects('tri', { v: 0.7, h: 0.5 });
  assert.equal(hitTest(0.3, 0.5, rects), 'main');   // 左侧
  assert.equal(hitTest(0.85, 0.2, rects), 'side');  // 右上
  assert.equal(hitTest(0.85, 0.8, rects), 'front'); // 右下
});

test('hitTest returns null outside all rects', () => {
  const rects = [{ name: 'main', x: 0, y: 0, w: 0.5, h: 0.5 }];
  assert.equal(hitTest(0.9, 0.9, rects), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test smpl_edit/tests/viewport_layout.test.js`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 viewport_layout.js**

Create `smpl_edit/viewport_layout.js`:

```javascript
// smpl_edit/viewport_layout.js
// 视口布局纯逻辑:预设 + 分隔条比例 → 归一化矩形列表;点命中测试。
// 矩形 { name, x, y, w, h },归一化 [0,1],原点左上(与 DOM 像素一致)。
// splits.v = 主视/参考栏的竖向分界(主视宽度占比);splits.h = 参考栏内上下分界。

// 三视:主视占左 v 宽,右栏(1-v)上下按 h 切为 side/front。
function triRects(v, h) {
  const rx = v, rw = 1 - v;
  return [
    { name: 'main', x: 0, y: 0, w: v, h: 1 },
    { name: 'side', x: rx, y: 0, w: rw, h },
    { name: 'front', x: rx, y: h, w: rw, h: 1 - h },
  ];
}

export function computeRects(preset, splits) {
  const v = splits?.v ?? 0.7, h = splits?.h ?? 0.5;
  if (preset === 'single') return [{ name: 'main', x: 0, y: 0, w: 1, h: 1 }];
  if (preset === 'main-big') return triRects(Math.max(v, 0.82), h); // 参考视压成窄条
  return triRects(v, h); // 'tri' 默认
}

// 命中:返回归一化点 (nx,ny) 落在的矩形 name,无则 null。
export function hitTest(nx, ny, rects) {
  for (const r of rects) {
    if (nx >= r.x && nx < r.x + r.w && ny >= r.y && ny < r.y + r.h) return r.name;
  }
  return null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test smpl_edit/tests/viewport_layout.test.js`
Expected: 5 PASS。

- [ ] **Step 5: 提交**

```bash
git add smpl_edit/viewport_layout.js smpl_edit/tests/viewport_layout.test.js
git commit -m "feat(viewport): viewport_layout.js — rects + hitTest (pure)"
```

## Task 3: 重构 gizmo/picker — setCamera 统一推送 active 相机

四个交互组件构造时绑死 `camera`。统一改为「推模式」：每个组件加 `setCamera(cam)`，app 在 active 视口变化时经 consumer 数组把新相机推给所有组件（JointPicker 不再用 getCamera 拉模式，与 gizmo 一致）。vendored TransformControls 用可写 `this.camera`，原生支持 OrthographicCamera。Browser-only，浏览器验 + 全量测试确认无回归。

**Files:** Modify `smpl_edit/joint_picker.js`、`smpl_edit/pose_gizmo.js`、`smpl_edit/root_handle.js`、`smpl_edit/drag_handle.js`

- [ ] **Step 1: JointPicker 加 setCamera**

`smpl_edit/joint_picker.js` 保留构造参数 `camera`（存 `this._camera`，已有），加方法：

```javascript
  setCamera(camera) { if (camera) this._camera = camera; }
```

`this._ray.setFromCamera(ndc, this._camera)` 不变——`this._camera` 现在可被 setCamera 更新。

- [ ] **Step 2: 三个 TC 组件加 setCamera**

在 `pose_gizmo.js`、`root_handle.js`、`drag_handle.js` 各加一个方法（放在 `update()` 旁）：

```javascript
  setCamera(camera) { if (camera && this._tc) this._tc.camera = camera; }
```

构造函数保持现有 `new TransformControls(camera, canvas)` 不变（初始相机）。

- [ ] **Step 3: 语法检查**

Run: `for f in joint_picker pose_gizmo root_handle drag_handle; do node --input-type=module -e "import('./smpl_edit/$f.js').then(()=>console.log('$f ok')).catch(e=>{const s=String(e); if(s.includes('three'))console.log('$f ok (three)'); else {console.error(s);process.exit(1);}})"; done`
Expected: 四个 ok。

- [ ] **Step 4: 全量测试无回归**

Run: `npm run test:web`
Expected: 0 失败（这些文件不单测，确认其它没坏）。

- [ ] **Step 5: 提交**

```bash
git add smpl_edit/joint_picker.js smpl_edit/pose_gizmo.js smpl_edit/root_handle.js smpl_edit/drag_handle.js
git commit -m "refactor(viewport): unified setCamera push on all gizmos/picker"
```

## Task 4: Viewport 类 — 单视口封装（browser-only）

一个 `Viewport` 持有：name、camera（透视或正交）、controls（OrbitControls）、locked 标志、标准朝向参数（用于 R 重置）。提供 `focus(center, radius)`（调 framing）、`resetOrientation(center, radius)`（回标准朝向 + 解锁）、`setLocked(bool)`、`applyScissor(renderer, W, H, rect)`、`resize(aspect)`。

**Files:** Create `smpl_edit/viewport.js`

- [ ] **Step 1: 实现 viewport.js**

Create `smpl_edit/viewport.js`:

```javascript
// smpl_edit/viewport.js
// 单视口封装:一个相机 + 一套 OrbitControls + scissor 矩形 + 锁定/重置。
// 不持有 renderer/scene(由 ViewportManager 统一渲染)。browser-only。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { focusPlacement } from './framing.js';
import { cameraPlacement } from './view_frame.js';

// kind: 'perspective' | 'ortho'。dirAxis/upAxis: 标准朝向(R 重置用),'X'|'Y'|'Z'。
export class Viewport {
  constructor({ name, kind, canvas, dirAxis, upAxis }) {
    this.name = name;
    this.kind = kind;
    this._dirAxis = dirAxis;   // 相机沿 +dirAxis 退开看向 target(标准朝向)
    this._upAxis = upAxis;
    this.locked = false;
    if (kind === 'ortho') {
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 4000);
    } else {
      this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 4000);
    }
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this._lastRadius = 1;
  }

  setLocked(v) { this.locked = !!v; this.controls.enabled = !v; }

  // 回标准朝向(沿 dirAxis 看向 center),并强制解锁。center/radius 缺省用上次值。
  resetOrientation(center, radius) {
    const c = center ?? this.controls.target.toArray();
    const r = (radius && radius > 0) ? radius : this._lastRadius;
    this._lastRadius = r;
    const place = cameraPlacement(this._upAxis, this._dirAxis, c, r);
    this.camera.up.set(place.up[0], place.up[1], place.up[2]);
    this.camera.position.set(place.position[0], place.position[1], place.position[2]);
    this.controls.target.set(c[0], c[1], c[2]);
    if (this.kind === 'ortho') this._fitOrtho(r);
    this.camera.lookAt(this.controls.target);
    this.setLocked(false);     // 重置后无锁可微调
    this.controls.update();
  }

  // F 聚焦:保持朝向,target→center,距离随 radius。
  focus(center, radius) {
    if (!center) return;
    this._lastRadius = (radius && radius > 0) ? radius : this._lastRadius;
    const view = { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
    const out = focusPlacement(view, center, this._lastRadius);
    this.camera.position.set(out.position[0], out.position[1], out.position[2]);
    this.controls.target.set(out.target[0], out.target[1], out.target[2]);
    if (this.kind === 'ortho') this._fitOrtho(this._lastRadius);
    this.controls.update();
  }

  // 正交相机:按半径与当前像素宽高比设 frustum,使人体充满不变形。
  _fitOrtho(radius) {
    const m = radius * 1.2;
    const a = this._aspect || 1;
    this.camera.left = -m * a; this.camera.right = m * a;
    this.camera.top = m; this.camera.bottom = -m;
    this.camera.updateProjectionMatrix();
  }

  resize(aspect) {
    this._aspect = aspect;
    if (this.kind === 'ortho') this._fitOrtho(this._lastRadius);
    else { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
  }

  // 在 renderer 上设 viewport+scissor 到像素矩形 {x,y,w,h}(GL 坐标,左下原点)。
  applyScissor(renderer, px) {
    renderer.setViewport(px.x, px.y, px.w, px.h);
    renderer.setScissor(px.x, px.y, px.w, px.h);
    renderer.setScissorTest(true);
  }

  update() { this.controls.update(); }
}
```

- [ ] **Step 2: 语法检查**

Run: `node --input-type=module -e "import('./smpl_edit/viewport.js').then(()=>console.log('ok')).catch(e=>{const s=String(e); if(s.includes('three'))console.log('ok (three)'); else {console.error(s);process.exit(1);}})"`
Expected: ok。

- [ ] **Step 3: 提交**

```bash
git add smpl_edit/viewport.js
git commit -m "feat(viewport): Viewport class — camera/controls/lock/focus/reset"
```

## Task 5: ViewportManager — 逐区渲染 + 指针路由 + 布局（browser-only）

持有多个 Viewport + 当前 preset/splits。用 `viewport_layout.computeRects` 算各视口归一矩形,逐区 `setViewport/setScissor` 渲染同一 scene;pointerdown 时用 `hitTest` 路由出 active 视口,暴露 `activeViewport()`/`activeCamera()`,并对 gizmo/picker 推送相机切换。

**Files:** Create `smpl_edit/viewport_manager.js`

- [ ] **Step 1: 实现 viewport_manager.js**

Create `smpl_edit/viewport_manager.js`:

```javascript
// smpl_edit/viewport_manager.js
// 多视口管理:单 renderer 逐区 scissor 渲染 + 指针路由 active 视口 + 布局。
// scene 由外部传入(所有视口共享同一 scene)。browser-only。
import { computeRects, hitTest } from './viewport_layout.js';

export class ViewportManager {
  // viewports: Viewport[](至少含 name==='main');canvas: 渲染 canvas;
  // onActiveChange(name): active 视口变化回调(用于推相机给 gizmo/picker)。
  constructor({ viewports, canvas, onActiveChange }) {
    this._vps = new Map(viewports.map((v) => [v.name, v]));
    this._canvas = canvas;
    this._onActiveChange = onActiveChange || (() => {});
    this._preset = 'tri';
    this._splits = { v: 0.7, h: 0.5 };
    this._active = 'main';
    this._rects = computeRects(this._preset, this._splits);
    canvas.addEventListener('pointerdown', (e) => this._routePointer(e), true);
  }

  setLayout(preset) { this._preset = preset; this._recompute(); }
  setSplits(splits) { this._splits = { ...this._splits, ...splits }; this._recompute(); }
  _recompute() { this._rects = computeRects(this._preset, this._splits); this.resize(); }

  activeViewport() { return this._vps.get(this._active); }
  activeCamera() { return this.activeViewport()?.camera; }
  viewport(name) { return this._vps.get(name); }
  visibleRects() { return this._rects; }

  _routePointer(e) {
    const r = this._canvas.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    const name = hitTest(nx, ny, this._rects);
    if (name && name !== this._active && this._vps.has(name)) {
      this._active = name;
      this._onActiveChange(name);
    }
  }

  // 像素矩形(GL 左下原点):由归一矩形(左上原点)翻 Y 得到。
  _pxRect(rect, W, H) {
    return { x: Math.round(rect.x * W), y: Math.round((1 - rect.y - rect.h) * H),
      w: Math.round(rect.w * W), h: Math.round(rect.h * H) };
  }

  resize() {
    const W = this._canvas.width, H = this._canvas.height;
    if (!W || !H) return;
    for (const rect of this._rects) {
      const vp = this._vps.get(rect.name); if (!vp) continue;
      const px = this._pxRect(rect, W, H);
      vp.resize(px.w / Math.max(px.h, 1));
    }
  }

  // 逐区渲染:每个可见矩形设 viewport+scissor 后渲染共享 scene。
  render(renderer, scene) {
    const W = this._canvas.width, H = this._canvas.height;
    if (!W || !H) return;
    for (const rect of this._rects) {
      const vp = this._vps.get(rect.name); if (!vp) continue;
      vp.update();
      vp.applyScissor(renderer, this._pxRect(rect, W, H));
      renderer.render(scene, vp.camera);
    }
    renderer.setScissorTest(false);
  }

  // 把当前 active 视口的 controls 启停交给守卫(gizmo engaged 时锁 active controls)。
  setActiveControlsEnabled(enabled) {
    const vp = this.activeViewport();
    if (vp && !vp.locked) vp.controls.enabled = enabled;
  }
}
```

- [ ] **Step 2: 语法检查**

Run: `node --input-type=module -e "import('./smpl_edit/viewport_manager.js').then(()=>console.log('ok')).catch(e=>{const s=String(e); if(s.includes('three'))console.log('ok (three)'); else {console.error(s);process.exit(1);}})"`
Expected: ok。

- [ ] **Step 3: 提交**

```bash
git add smpl_edit/viewport_manager.js
git commit -m "feat(viewport): ViewportManager — scissor render + pointer routing + layout"
```

## Task 6: pcd_scene 渲染委托 ViewportManager

`PcdScene.render()` 现在 `this._renderer.render(scene, this._cam.camera)`。改为：若设了 manager 则委托 `manager.render(renderer, scene)`,否则回退原单相机路径（向后兼容冒烟）。`resize()` 也通知 manager。

**Files:** Modify `pcd_label/src/scene/pcd_scene.js`

- [ ] **Step 1: 加 setManager + 改 render/resize**

在 `PcdScene` 构造末尾加 `this._manager = null;`。加方法：

```javascript
  setManager(mgr) { this._manager = mgr; }
```

把 `render()` 改为：

```javascript
  render() {
    this._applyVisibility();
    if (this._manager) { this._manager.render(this._renderer, this._scene); return; }
    if (!this._cam) return;
    this._cam.update();
    this._renderer.render(this._scene, this._cam.camera);
  }
```

在 `resize()` 末尾(`this._cam.resize(w,h)` 之后)追加：

```javascript
    if (this._manager) this._manager.resize();
```

注意 `resize()` 开头的 `if (w<=0||h<=0||!this._cam) return;` 保留——manager 模式下 `_cam` 仍是主视相机(见 Task 7 装配),不为 null。

- [ ] **Step 2: 语法检查**

Run: `node --input-type=module -e "import('./pcd_label/src/scene/pcd_scene.js').then(()=>console.log('ok')).catch(e=>{const s=String(e); if(s.includes('three'))console.log('ok (three)'); else {console.error(s);process.exit(1);}})"`
Expected: ok。

- [ ] **Step 3: 提交**

```bash
git add pcd_label/src/scene/pcd_scene.js
git commit -m "feat(pcd): PcdScene delegates render/resize to ViewportManager when set"
```

## Task 7: pcd_label 装配三视口 + 分隔条/预设 + F/R 键 + 锁

把 pcd 从单 OrbitCam 切到三视口。主视沿用现有自由透视 OrbitCam 语义（仍由 `applyAxisFrame` 驱动 up/front）；侧视、正视为正交,标准朝向由当前 axisUp/axisFront 派生。gizmo/picker 在 active 视口变化时 `setCamera`。新增 stage 内分隔条 + 视口工具条 DOM。F/R 键作用于 active 视口。

**Files:** Modify `pcd_label/src/app.js`、`pcd_label/index.html`

设计要点（实现时遵循）：
- 主视 Viewport `{ name:'main', kind:'perspective', dirAxis: axisFront, upAxis: axisUp }`；侧视 `{ name:'side', kind:'ortho', dirAxis: rightAxis, upAxis: axisUp }`；正视 `{ name:'front', kind:'ortho', dirAxis: axisFront, upAxis: axisUp }`。`rightAxis` = up×front 的轴名,用 `view_frame.viewFrame(up,front).right` 推出对应轴字母（{1,0,0}→'X' 等;实现一个小 helper `axisName(vec)`）。
- `applyAxisFrame` 改为:除主视 `cam.setFrame` 外,也更新 side/front 两个 Viewport 的 dirAxis/upAxis 并 `resetOrientation(b.center,b.radius)`。
- active 切换回调里：app 用一个 `camConsumers` 数组统一推相机给所有交互组件（poseGizmo/rootHandle 直接 `setCamera`，IK 两柄经 ctx 的 `registerCameraConsumer` 注册自己的 setCamera，jointPicker 也 setCamera）。详见 Step3 consumer 机制。
- 渲染循环 `loop` 里的 `cam.controls.enabled = !gizmoBusy` 改为 `mgr.setActiveControlsEnabled(!gizmoBusy)`。
- 主视 `cam`(OrbitCam) 仍作为 main Viewport 的 controls 来源——为最小改动,main Viewport 直接包住现有 OrbitCam 的 camera+controls（Viewport 支持注入既有 camera/controls,见下 Step 1 适配）。

- [ ] **Step 1: Viewport 支持注入既有 camera/controls（适配主视复用 OrbitCam）**

在 `smpl_edit/viewport.js` 构造函数开头,允许传入既有 `camera`/`controls` 跳过自建:

```javascript
  constructor({ name, kind, canvas, dirAxis, upAxis, camera = null, controls = null }) {
    this.name = name;
    this.kind = kind;
    this._dirAxis = dirAxis;
    this._upAxis = upAxis;
    this.locked = false;
    if (camera) {
      this.camera = camera;
    } else if (kind === 'ortho') {
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 4000);
    } else {
      this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 4000);
    }
    if (controls) {
      this.controls = controls;
    } else {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
    }
    this._lastRadius = 1;
  }
```

提交此适配:

```bash
git add smpl_edit/viewport.js
git commit -m "feat(viewport): Viewport accepts injected camera/controls (reuse OrbitCam)"
```

- [ ] **Step 2: index.html 加视口工具条 + 分隔条 DOM/CSS**

在 `pcd_label/index.html` 的 `#stage` 内、`<canvas id="c">` 之后加:

```html
    <div id="vp-bar">
      <button id="vp-single" title="单视口">▢</button>
      <button id="vp-tri" class="on" title="三视口">▥</button>
      <button id="vp-mainbig" title="主大参考小">◰</button>
      <button id="vp-lock-side" title="锁侧视">🔓侧</button>
      <button id="vp-lock-front" title="锁正视">🔓正</button>
      <span class="vp-hint">F聚焦 R重置朝向</span>
    </div>
    <div id="vp-split-v" class="vp-split"></div>
    <div id="vp-split-h" class="vp-split"></div>
```

CSS（加到 `<style>`）:

```css
    #vp-bar { position:absolute; top:6px; left:6px; z-index:5; display:flex; gap:4px; align-items:center; }
    #vp-bar button { background:#16202c; color:#cfe; border:1px solid #2a3340; border-radius:4px; padding:2px 6px; cursor:pointer; font-size:12px; }
    #vp-bar button.on { background:#2563a8; }
    #vp-bar .vp-hint { color:#8ab; font-size:10px; margin-left:6px; }
    .vp-split { position:absolute; z-index:4; background:transparent; }
    #vp-split-v { top:0; bottom:0; width:6px; cursor:col-resize; }
    #vp-split-h { right:0; height:6px; cursor:row-resize; }
```

分隔条位置由 JS 按 splits 定位（Step 3）。

- [ ] **Step 3: app.js 装配三视口**

在 imports 加:

```javascript
import { Viewport } from '../../smpl_edit/viewport.js';
import { ViewportManager } from '../../smpl_edit/viewport_manager.js';
import { viewFrame } from '../../smpl_edit/view_frame.js';
```

加一个轴名 helper（放在 `AXIS_TO_IDX` 附近）:

```javascript
// 单位向量 → 轴字母('X'|'Y'|'Z')。view_frame.right 是 up×front 的单位轴。
function axisName(v) {
  const ax = [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])];
  const i = ax[0] >= ax[1] && ax[0] >= ax[2] ? 0 : (ax[1] >= ax[2] ? 1 : 2);
  return ['X', 'Y', 'Z'][i];
}
```

在 `boot()` 里，建 OrbitCam 后建 manager（替换原先只设单 cam 的逻辑）。主视复用 OrbitCam 的 camera+controls；侧/正新建正交 Viewport。**统一用 `camConsumers` 数组分发相机**：

```javascript
  scene = new PcdScene($('c'));
  cam = new OrbitCam({ canvas: $('c') });        // 主视:沿用自由透视
  const rightAxis = axisName(viewFrame(axisUp, axisFront).right);
  const vpMain = new Viewport({ name: 'main', kind: 'perspective', dirAxis: axisFront, upAxis: axisUp, camera: cam.camera, controls: cam.controls });
  const vpSide = new Viewport({ name: 'side', kind: 'ortho', canvas: $('c'), dirAxis: rightAxis, upAxis: axisUp });
  const vpFront = new Viewport({ name: 'front', kind: 'ortho', canvas: $('c'), dirAxis: axisFront, upAxis: axisUp });
  mgr = new ViewportManager({
    viewports: [vpMain, vpSide, vpFront], canvas: $('c'),
    // active 视口变化 → 把新相机推给所有交互组件(见 camConsumers)。
    onActiveChange: () => { const c = mgr.activeCamera(); camConsumers.forEach((fn) => fn(c)); },
  });
  scene.setManager(mgr);
  scene.setCamera(cam);                          // 保留:resize 防 null + 回退路径
  scene.resize();
```

**Consumer 机制**：app 顶部声明 `const camConsumers = [];`（与 `dragGuards`/`engageGuards` 并列）。各交互组件创建后注册一个「接收相机」回调，active 视口变化时统一分发：

- `boot3()` 建好 poseGizmo/rootHandle/jointPicker 后：
  ```javascript
  camConsumers.push((c) => poseGizmo.setCamera(c));
  camConsumers.push((c) => rootHandle.setCamera(c));
  camConsumers.push((c) => jointPicker.setCamera(c));
  ```
- IK 两柄藏在 `installIK` 内，app 拿不到引用 → 给 `installIK` 的 ctx 加 `registerCameraConsumer: (fn) => camConsumers.push(fn)`；插件内部注册 `ctx.registerCameraConsumer?.((c) => { endHandle.setCamera(c); poleHandle.setCamera(c); })`。（`drag_handle.js` 已在 Task 3 加 `setCamera`；`ik_plugin.js` 内两柄各调一次。）

这样 app 只维护一个 `camConsumers` 数组 + 一行 `forEach` 分发；新增交互组件只需 push，无需改分发逻辑。`registerCameraConsumer` 在 ctx 里是可选的（其它 app 不传也不报错）。

- [ ] **Step 4: applyAxisFrame 同步三视口朝向**

```javascript
function applyAxisFrame(recenter) {
  scene.orientGroundTo(axisUp);
  scene.pointCloud.setHeightAxis(AXIS_TO_IDX[axisUp]);
  const b = scene.pointCloud.bounds();
  const center = recenter && b ? b.center : null;
  const radius = b ? b.radius : null;
  cam.setFrame(axisUp, axisFront, center, radius); // 主视
  const rightAxis = axisName(viewFrame(axisUp, axisFront).right);
  const side = mgr.viewport('side'), front = mgr.viewport('front');
  if (side) { side._dirAxis = rightAxis; side._upAxis = axisUp; side.resetOrientation(center ?? undefined, radius ?? undefined); }
  if (front) { front._dirAxis = axisFront; front._upAxis = axisUp; front.resetOrientation(center ?? undefined, radius ?? undefined); }
}
```

（`_dirAxis`/`_upAxis` 是 Viewport 内部字段;app 直接写可接受,因两者同属本特性、同一作者维护。若偏好封装,可在 Viewport 加 `setOrientationAxes(dir,up)` setter——实现时二选一,推荐加 setter 更干净。）

- [ ] **Step 5: 渲染循环 + 守卫**

`loop` 里把 `if (cam) cam.controls.enabled = !gizmoBusy;` 改为 `mgr.setActiveControlsEnabled(!gizmoBusy);`。

- [ ] **Step 6: 分隔条拖动 + 预设按钮 + 锁按钮**

在 `boot2()`（事件装配处）加:

```javascript
  const placeSplits = () => {
    const stage = $('stage'); const W = stage.clientWidth, H = stage.clientHeight;
    const sv = $('vp-split-v'), sh = $('vp-split-h');
    const s = mgr._splits; // v:左右, h:右栏上下
    sv.style.left = `${W * s.v - 3}px`; sv.style.display = mgr._preset === 'single' ? 'none' : 'block';
    sh.style.top = `${H * s.h - 3}px`; sh.style.left = `${W * s.v}px`; sh.style.right = '0';
    sh.style.display = mgr._preset === 'single' ? 'none' : 'block';
  };
  const setPreset = (p, btn) => {
    mgr.setLayout(p);
    ['vp-single','vp-tri','vp-mainbig'].forEach((id) => $(id).classList.toggle('on', id === btn));
    placeSplits();
  };
  $('vp-single').addEventListener('click', () => setPreset('single', 'vp-single'));
  $('vp-tri').addEventListener('click', () => setPreset('tri', 'vp-tri'));
  $('vp-mainbig').addEventListener('click', () => setPreset('main-big', 'vp-mainbig'));

  const dragSplit = (el, axis) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); const stage = $('stage');
      const move = (ev) => {
        const r = stage.getBoundingClientRect();
        if (axis === 'v') mgr.setSplits({ v: Math.min(0.92, Math.max(0.4, (ev.clientX - r.left) / r.width)) });
        else mgr.setSplits({ h: Math.min(0.85, Math.max(0.15, (ev.clientY - r.top) / r.height)) });
        placeSplits();
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
  };
  dragSplit($('vp-split-v'), 'v'); dragSplit($('vp-split-h'), 'h');

  const lockBtn = (id, name, label) => $(id).addEventListener('click', () => {
    const vp = mgr.viewport(name); if (!vp) return;
    vp.setLocked(!vp.locked);
    $(id).textContent = (vp.locked ? '🔒' : '🔓') + label;
    $(id).classList.toggle('on', vp.locked);
  });
  lockBtn('vp-lock-side', 'side', '侧'); lockBtn('vp-lock-front', 'front', '正');
  window.addEventListener('resize', placeSplits);
  placeSplits();
```

- [ ] **Step 7: F/R 键**

在 `boot2()` 加键盘监听:

```javascript
  window.addEventListener('keydown', (e) => {
    if (!store || e.target.matches('input,select,textarea')) return;
    if (dragGuards.some((g) => g.isDragging()) || playing) return;
    const vp = mgr.activeViewport(); if (!vp) return;
    const b = bodyBounds(lastJoints);
    if (e.key === 'f' || e.key === 'F') {
      if (!b) { setStatus('无人体可聚焦'); return; }
      vp.focus(b.center, b.radius);
    } else if (e.key === 'r' || e.key === 'R') {
      vp.resetOrientation(b ? b.center : undefined, b ? b.radius : undefined);
      // 同步锁按钮 UI(R 强制解锁)
      if (vp.name === 'side') { $('vp-lock-side').textContent = '🔓侧'; $('vp-lock-side').classList.remove('on'); }
      if (vp.name === 'front') { $('vp-lock-front').textContent = '🔓正'; $('vp-lock-front').classList.remove('on'); }
    }
  });
```

并在 imports 加 `import { bodyBounds } from '../../smpl_edit/framing.js';`。

- [ ] **Step 8: 冒烟 + 全量测试**

Run: `npm run test:web`
Expected: 0 失败。

浏览器冒烟(`node smpl_web_viewer/tools/static_server.mjs --root . --port 5187` → `/pcd_label/`):三视口渲染、分隔条拖动、预设切换、锁、F/R、任一视口点选+拖 gizmo、上轴/前轴切换三视同步。

- [ ] **Step 9: 提交**

```bash
git add pcd_label/src/app.js pcd_label/index.html smpl_edit/viewport.js
git commit -m "feat(pcd): tri-viewport assembly — splitters, presets, locks, F/R keys"
```

## Task 8: label 接 F 聚焦（3D only）

label 保持单视口。给 `CameraModes` 加 `focusOn(center, radius)`：仅 3D 模式调 `framing.focusPlacement` 改 position + controls.target；2D 不响应。app 加 F 键监听。

**Files:** Modify `label/src/scene/camera_modes.js`、`label/src/app.js`

- [ ] **Step 1: CameraModes.focusOn**

在 `label/src/scene/camera_modes.js` 顶部 imports 后加:

```javascript
import { focusPlacement } from '../../../smpl_edit/framing.js';
```

加方法（放在 `set3DFollowTarget` 附近）:

```javascript
  /** F 聚焦:仅 3D 模式生效。保持朝向,把 controls.target 移到 center 并按 radius 拉开。
   *  2D 模式(锁内参看图)不响应——视口已足够小。返回是否执行。 */
  focusOn(center, radius) {
    if (this.mode !== '3d' || this.isAnimating()) return false;
    const view = { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
    const out = focusPlacement(view, center, radius);
    this.camera.position.set(out.position[0], out.position[1], out.position[2]);
    this.controls.target.set(out.target[0], out.target[1], out.target[2]);
    // 同步保存的 3D pose,使后续 2D↔3D 切换不丢聚焦
    this._pose3D.position.copy(this.camera.position);
    this._pose3D.target.copy(this.controls.target);
    this._pose3D.quaternion.copy(this._quatLookingAt(this.camera.position, this.controls.target));
    this.controls.update();
    return true;
  }
```

- [ ] **Step 2: app.js F 键**

在 `label/src/app.js` imports 加:

```javascript
import { bodyBounds } from '../../smpl_edit/framing.js';
```

在现有 keydown 装配处（`window.addEventListener('keydown', ... 'z' ...)` 附近）加:

```javascript
  window.addEventListener('keydown', (e) => {
    if (!store || isBusy() || e.target.matches('input,select,textarea')) return;
    if (e.key !== 'f' && e.key !== 'F') return;
    const b = bodyBounds(lastJoints);
    if (!b) { setStatus('无人体可聚焦'); return; }
    if (!cam.focusOn(b.center, b.radius)) setStatus('2D 模式不聚焦,切到 3D 后按 F');
  });
```

- [ ] **Step 3: 语法检查 + 全量测试**

Run: `node --input-type=module -e "import('./label/src/scene/camera_modes.js').then(()=>console.log('ok')).catch(e=>{const s=String(e); if(s.includes('three'))console.log('ok (three)'); else {console.error(s);process.exit(1);}})"`
Expected: ok。

Run: `npm run test:web`
Expected: 0 失败。

浏览器冒烟(`--port 5188` → `/label/`):3D 模式 F 聚焦到人体、2D 模式 F 提示不聚焦、无标注时 F 提示无人体。

- [ ] **Step 4: 提交**

```bash
git add label/src/scene/camera_modes.js label/src/app.js
git commit -m "feat(label): F-key focuses 3D camera on body center (2D no-op)"
```

---

## Task 9: 人体 mesh 半透明（label + pcd）

两 app 的人体 mesh 现为不透明 `MeshLambertMaterial`。加一个透明度滑块，让 mesh 可半透明以透出点云/底图。scene 提供 `setMeshOpacity(v)`：v<1 时 `transparent=true, opacity=v, depthWrite=false`（避免半透明深度遮挡），v>=1 时回不透明（`transparent=false, opacity=1, depthWrite=true`）。两 app 各加一个滑块（0.1–1）。

**Files:** Modify `label/src/scene/scene.js`、`label/index.html`、`label/src/app.js`、`pcd_label/src/scene/pcd_scene.js`、`pcd_label/index.html`、`pcd_label/src/app.js`

- [ ] **Step 1: label scene.setMeshOpacity**

在 `label/src/scene/scene.js` 加方法（放在 `setFlag` 附近）：

```javascript
  // 人体 mesh 透明度。v<1 → 半透明且关 depthWrite(防自遮挡);v>=1 → 复原不透明。
  setMeshOpacity(v) {
    if (!this._mesh) return;
    const m = this._mesh.material;
    if (v >= 1) { m.transparent = false; m.opacity = 1; m.depthWrite = true; }
    else { m.transparent = true; m.opacity = Math.max(0.05, v); m.depthWrite = false; }
    m.needsUpdate = true;
  }
```

- [ ] **Step 2: label index.html 加滑块**

在 `label/index.html` 的「显示」区（`t-axes`/`t-bg` 那个 `<div class="row wrap">` 之后）加：

```html
      <div class="row" style="align-items:center;gap:6px"><label style="font-size:11px;color:#aaa">网格透明度</label><input id="mesh-opacity" type="range" min="0.1" max="1" step="0.05" value="1" style="flex:1"></div>
```

- [ ] **Step 3: label app.js 接线**

在 `label/src/app.js` 的显示开关装配处（`toggle('t-mesh','mesh')` 那一段附近）加：

```javascript
  $('mesh-opacity').addEventListener('input', (e) => scene.setMeshOpacity(+e.target.value));
```

- [ ] **Step 4: pcd scene.setMeshOpacity**

在 `pcd_label/src/scene/pcd_scene.js` 加同样方法（放在 `setFlag` 附近）：

```javascript
  setMeshOpacity(v) {
    if (!this._mesh) return;
    const m = this._mesh.material;
    if (v >= 1) { m.transparent = false; m.opacity = 1; m.depthWrite = true; }
    else { m.transparent = true; m.opacity = Math.max(0.05, v); m.depthWrite = false; }
    m.needsUpdate = true;
  }
```

- [ ] **Step 5: pcd index.html 加滑块**

在 `pcd_label/index.html` 「点云渲染」card 的 `point-size` 滑块那行之后、`<h3>坐标轴</h3>` 之前的 `kgrid2` 内加：

```html
        <label>网格透明</label><input id="mesh-opacity" type="range" min="0.1" max="1" step="0.05" value="1">
```

- [ ] **Step 6: pcd app.js 接线**

在 `pcd_label/src/app.js` 的 `boot2()` 渲染控件装配处（`point-size` 那行附近）加：

```javascript
  $('mesh-opacity').addEventListener('input', (e) => scene.setMeshOpacity(+e.target.value));
```

- [ ] **Step 7: 语法检查 + 全量测试**

Run: `for f in label/src/scene/scene.js pcd_label/src/scene/pcd_scene.js; do node --input-type=module -e "import('./$f').then(()=>console.log('$f ok')).catch(e=>{const s=String(e); if(s.includes('three'))console.log('$f ok (three)'); else {console.error(s);process.exit(1);}})"; done`
Expected: 两个 ok。

Run: `npm run test:web`
Expected: 0 失败。

- [ ] **Step 8: 提交**

```bash
git add label/src/scene/scene.js label/index.html label/src/app.js pcd_label/src/scene/pcd_scene.js pcd_label/index.html pcd_label/src/app.js
git commit -m "feat(mesh): translucent body mesh opacity slider (label + pcd)"
```

---

## Task 10: 全量套件 + 手验清单

**Files:** none（验证）

- [ ] **Step 1: 全量套件**

Run: `npm test`
Expected: web/tools/server 全 0 失败。

- [ ] **Step 2: 记录浏览器手验清单**

pcd（`node smpl_web_viewer/tools/static_server.mjs --root . --port 5187` → `/pcd_label/`）:
1. 开序列 → 默认三视口:主透视(左大)、侧/正正交(右上下),正交无畸变。
2. 拖中间竖分隔条改左右占比;拖右侧横分隔条改侧/正上下。
3. 预设按钮:单视口/三视口/主大参考小 切换正确。
4. 鼠标移到某视口 → 该视口成 active;在其中点选关节、拖 pose gizmo / root / IK,解算正确。
5. F:聚焦 active 视口到人体;无人体提示。
6. R:重置 active 视口朝向(主→3/4 俯视、侧→正侧、正→正正),且强制解锁(锁按钮复位)。
7. 锁🔓/🔒侧、正:锁上后该视口不可环绕。
8. 上轴/前轴下拉切换 → 三视口朝向同步更新,几何不旋转。

label（`--port 5188` → `/label/`）:
9. 3D 模式 F → 聚焦人体中心;2D 模式 F → 提示不聚焦;无标注 F → 提示无人体;单视口行为零回归(2D/3D 切换、gizmo、IK 正常)。

mesh 透明度（两 app）:
10. 拖「网格透明度」滑块 → 人体 mesh 半透明,可透出点云/底图;滑到 1 → 完全不透明,无深度遮挡异常;半透明时关节/骨骼仍清晰可见。

- [ ] **Step 3: 最终提交（如有笔记）**

```bash
git add -A
git commit -m "test(viewport): tri-view + F-focus — suite green; manual checklist recorded" --allow-empty
```

---

## Self-Review

- **Spec §3 framing.js（bodyBounds/focusPlacement）** → Task 1，单测。✓
- **Spec §3 viewport.js** → Task 4 + Task 7 Step1（注入既有 camera/controls）。✓
- **Spec §3 viewport_manager.js（scissor 渲染 + 指针路由 + 布局）** → Task 5；纯逻辑 hitTest/computeRects → Task 2 单测。✓
- **Spec §3 gizmo/picker 动态取相机** → Task 3（统一 setCamera 推模式 + Task 7 consumer 分发）。✓
- **Spec §4 主透视 + 侧/正正交、初始正对** → Task 7 Step3。✓
- **Spec §4 布局可拖分隔条 + 预设** → Task 7 Step6。✓
- **Spec §4 锁/解锁** → Task 7 Step6 lockBtn + Viewport.setLocked（Task 4）。✓
- **Spec §4 F 聚焦 active 视口、R 重置朝向并解锁** → Task 7 Step7 + Viewport.focus/resetOrientation（Task 4）。✓
- **Spec §4 任一视口可编辑 / 指针路由 / engageGuards 只锁 active** → Task 5 routePointer + setActiveControlsEnabled，Task 7 Step5。✓
- **Spec §4 上轴/前轴三视同步、几何不旋转** → Task 7 Step4。✓
- **Spec §5 label 接 F（3D only，2D 不响应）** → Task 8。✓
- **Spec §5 键盘防冲突（输入框/播放/拖拽）** → Task 7 Step7 + Task 8 Step2 守卫条件。✓
- **Spec §5 测试策略（纯逻辑单测 + 浏览器验）** → Task 1/2 单测 + Task 10 清单。✓
- **Spec §5 冒烟（先 scissor 双区跑通）** → Task 6 回退路径保证单相机仍可渲染,Task 7 Step8 冒烟。✓
- **Spec §6 范围（仅 pcd 三视口、label 单视口接 F、不持久化布局、几何不变、2D 不响应 F）** → 全程遵守。✓
- **追加需求 mesh 半透明（label + pcd）** → Task 9（setMeshOpacity + 两 app 滑块）。✓
- **Placeholder 扫描**：每个代码步给出完整代码。✓
- **命名一致性**：`bodyBounds`/`focusPlacement`/`computeRects`/`hitTest`/`Viewport.focus/resetOrientation/setLocked/setCamera`/`ViewportManager.activeCamera/setSplits/setLayout/setActiveControlsEnabled`/`PcdScene.setManager`/`setMeshOpacity` 跨任务一致。✓

**两处对 spec 的偏离/追加记录**：
1. Task 3 + Task 7 把「动态取相机」具体落为「统一 setCamera 推模式 + app 的 camConsumers 数组分发」：所有交互组件（gizmo/handle/picker）加 `setCamera`，active 视口变化时 app 一次 `forEach` 推送；IK 两柄经 ctx 的可选 `registerCameraConsumer` 注册。功能等价、接线统一清晰（已采纳用户「统一推模式」意见）。
2. Task 9（mesh 半透明）是会话中追加需求，不在原 spec，已并入本计划一起实现。






