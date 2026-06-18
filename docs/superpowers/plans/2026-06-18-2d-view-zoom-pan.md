# 2D 视图缩放/平移 实现计划 (2D View Zoom/Pan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2D 对齐视角下用 `camera.setViewOffset` 做纯视图缩放/平移(看大图小目标),不改内外参/数据;裸滚轮缩放、空白拖拽平移、root 深度让位到 Cmd/Ctrl+滚轮、切 3D 自动复位;bbox 映射随缩放保持一致。

**Architecture:** 缩放数学抽成纯函数 `view_zoom.js`(窗口计算/缩放中心解算/pan 钳制/图像↔画布映射),可单测;`camera_modes.js` 持缩放状态并在 `_applyViewOffset` 里调纯函数重算子窗口,新增 image↔canvas 映射方法;`app.js` 接 2D 滚轮/拖拽并改 root 深度修饰键;`bbox_overlay.js` 的屏幕↔图像映射改走 camera 方法,缩放后不错位。

**Tech Stack:** 原生 ES 模块,`node --test` 测纯逻辑;three.js PerspectiveCamera.setViewOffset。

**Reference spec:** `docs/superpowers/specs/2026-06-18-2d-view-zoom-pan-design.md`

---

## Conventions

- 仓库根跑测试:`node --test label/tests/<file>.test.js`;服务 `npm run serve:label`。
- 浏览器代码(three/DOM)`node --check` + Task 6 人工验证;纯数学单测。
- 每 Task 末提交,信息见末步。分支 `feat-2d-view-zoom`(已创建,基于 main,不碰 pages-static-viewer)。

## 关键现状

- `camera_modes.js`:`_applyViewOffset()` 现为 `setViewOffset(imageW, imageH, imageW/2−cx, imageH/2−cy, imageW, imageH)`;`setIntrinsics`/`resetIntrinsics` 会调它;`snapTo(mode)`/`switchTo(mode)` 切模式;`this.imageW/imageH/K` 已有。
- `app.js:542` 现有 `$('c').wheel` 处理:仅 `ui.mode==='root' && cam.mode==='2d' && root-translate.on` 时调 root_pos.z(裸滚轮)。本计划把它改成需 Cmd/Ctrl。
- `bbox_overlay.js`:`_imgToScreen`/`_screenToImg` 用 `(ix/cam.imageW)*rect.width` 线性式 + canvas/stage 矩形。改为走 camera 的归一化映射。
- 渲染循环每帧 `cam.update()`(经 scene.render 内部),2D 下 OrbitControls 已禁用。

## 文件结构

- 新增 `label/src/scene/view_zoom.js` — 纯函数:窗口/缩放中心/钳制/映射(测)
- 新增 `label/tests/view_zoom.test.js`
- 改 `label/src/scene/camera_modes.js` — 缩放状态 + 方法 + `_applyViewOffset` 重算 + 切 3D resetZoom + image↔canvas 映射
- 改 `label/src/app.js` — 2D 滚轮缩放 / 空白拖拽平移 / root 深度改修饰键 / 切 3D resetZoom
- 改 `label/src/edit/bbox_overlay.js` — 映射改走 camera 方法
- 改 `label/src/scene/scene.js` — 背景纹理 `minFilter/magFilter = LinearFilter`(放大不糊成块)

---

## Task 1: 缩放纯函数 `view_zoom.js`

所有缩放数学,零 three.js。模型:虚拟传感器 `imageW×imageH`;「基准窗口」左上 `(imageW/2−cx, imageH/2−cy)`、尺寸 `imageW×imageH`(z=1 即现有主点偏移)。缩放窗口尺寸 `imageW/z × imageH/z`,左上由 pan(相对基准窗口左上的传感器像素偏移)决定并钳制在基准窗口内。画布归一化坐标 (u,v)∈[0,1]:窗口左上→(0,0)、右下→(1,1)。

**Files:**
- Create: `label/src/scene/view_zoom.js`
- Test: `label/tests/view_zoom.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeWindow, zoomAtSolve, imageToCanvasNorm, canvasNormToImage } from '../src/scene/view_zoom.js';

const K = { imageW: 1920, imageH: 1080, cx: 960, cy: 540 }; // 主点居中 → base 偏移 0
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('z=1 窗口 = 基准窗口(主点居中时左上为 0、全尺寸)', () => {
  const w = computeWindow({ ...K, zoom: 1, panX: 0, panY: 0 });
  close(w.winX, 0); close(w.winY, 0); close(w.winW, 1920); close(w.winH, 1080);
});

test('主点偏移时 z=1 窗口左上 = imageW/2−cx', () => {
  const w = computeWindow({ imageW: 1920, imageH: 1080, cx: 900, cy: 500, zoom: 1, panX: 0, panY: 0 });
  close(w.winX, 60); close(w.winY, 40);  // 960−900, 540−500
});

test('z=2 窗口为半尺寸,pan=0 时居中于基准窗口', () => {
  const w = computeWindow({ ...K, zoom: 2, panX: 0, panY: 0 });
  close(w.winW, 960); close(w.winH, 540);
  // pan=0 表示窗口左上 = 基准左上 → 不居中,而是贴左上(pan 语义是相对基准左上的偏移)
  close(w.winX, 0); close(w.winY, 0);
});

test('pan 钳制:窗口不超出基准窗口右/下边界', () => {
  const w = computeWindow({ ...K, zoom: 2, panX: 5000, panY: 5000 });
  close(w.winX, 960); close(w.winY, 540); // 最多到 base + (imageW − winW) = 0 + 960
});

test('pan 钳制:不超出左/上边界', () => {
  const w = computeWindow({ ...K, zoom: 2, panX: -5000, panY: -5000 });
  close(w.winX, 0); close(w.winY, 0);
});

test('imageToCanvasNorm / canvasNormToImage round-trip', () => {
  const win = computeWindow({ ...K, zoom: 3, panX: 200, panY: 100 });
  const [u, v] = imageToCanvasNorm(1000, 600, win);
  const [ix, iy] = canvasNormToImage(u, v, win);
  close(ix, 1000); close(iy, 600);
});

test('zoomAtSolve:在 (u,v) 处放大,该图像点缩放后仍落在同一 (u,v)', () => {
  const before = computeWindow({ ...K, zoom: 1, panX: 0, panY: 0 });
  const u = 0.3, v = 0.7;
  const [ix, iy] = canvasNormToImage(u, v, before);          // 光标下的图像点
  const { panX, panY } = zoomAtSolve({ ...K, zoom: 1, panX: 0, panY: 0, u, v, factor: 2 });
  const after = computeWindow({ ...K, zoom: 2, panX, panY });
  const [u2, v2] = imageToCanvasNorm(ix, iy, after);          // 同一图像点的新归一化位置
  close(u2, u, 1e-4); close(v2, v, 1e-4);                     // 应保持不动
});

test('zoom 钳制在 [1, 8]', () => {
  const lo = zoomAtSolve({ ...K, zoom: 1, panX: 0, panY: 0, u: 0.5, v: 0.5, factor: 0.5 });
  assert.equal(lo.zoom, 1);
  const hi = zoomAtSolve({ ...K, zoom: 8, panX: 0, panY: 0, u: 0.5, v: 0.5, factor: 2 });
  assert.equal(hi.zoom, 8);
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `node --test label/tests/view_zoom.test.js`

- [ ] **Step 3: 实现**

```javascript
// label/src/scene/view_zoom.js
// 2D 视图缩放/平移的纯几何。零 three.js。
// 虚拟传感器 imageW×imageH;基准窗口左上 (imageW/2−cx, imageH/2−cy)、尺寸 imageW×imageH。
// 缩放窗口尺寸 imageW/zoom × imageH/zoom;pan 是相对基准左上的传感器像素偏移,钳制在基准窗口内。
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// 计算 setViewOffset 用的子窗口。
export function computeWindow({ imageW, imageH, cx, cy, zoom, panX, panY }) {
  const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  const winW = imageW / z;
  const winH = imageH / z;
  const baseX = imageW / 2 - cx;
  const baseY = imageH / 2 - cy;
  const winX = clamp(baseX + panX, baseX, baseX + imageW - winW);
  const winY = clamp(baseY + panY, baseY, baseY + imageH - winH);
  return { winX, winY, winW, winH };
}

// 图像像素 → 画布归一化 (u,v):窗口左上→(0,0)、右下→(1,1)。
export function imageToCanvasNorm(ix, iy, win) {
  return [(ix - win.winX) / win.winW, (iy - win.winY) / win.winH];
}

// 画布归一化 → 图像像素(逆映射)。
export function canvasNormToImage(u, v, win) {
  return [win.winX + u * win.winW, win.winY + v * win.winH];
}

// 在画布点 (u,v) 处按 factor 缩放,解出新的 {zoom,panX,panY},使该点下的图像保持不动。
export function zoomAtSolve({ imageW, imageH, cx, cy, zoom, panX, panY, u, v, factor }) {
  const zNew = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
  const before = computeWindow({ imageW, imageH, cx, cy, zoom, panX, panY });
  const [ix, iy] = canvasNormToImage(u, v, before);   // 缩放前光标下的图像点
  // 新窗口尺寸下,要 winX' + u·winW' = ix → winX' = ix − u·imageW/zNew;再反推 panX。
  const baseX = imageW / 2 - cx;
  const baseY = imageH / 2 - cy;
  const winWNew = imageW / zNew;
  const winHNew = imageH / zNew;
  const panXNew = (ix - u * winWNew) - baseX;
  const panYNew = (iy - v * winHNew) - baseY;
  return { zoom: zNew, panX: panXNew, panY: panYNew };
}
```

- [ ] **Step 4: 跑测试确认 8/8 PASS**

Run: `node --test label/tests/view_zoom.test.js`

- [ ] **Step 5: 提交**

```bash
git add label/src/scene/view_zoom.js label/tests/view_zoom.test.js
git commit -m "feat(zoom): pure 2D view zoom/pan math (window, zoom-at, clamp, mapping)"
```

---

## Task 2: camera_modes 接入缩放状态 + 映射方法

让 `_applyViewOffset` 走 `computeWindow`,新增缩放/平移/复位 API 与 image↔canvas 映射,切 3D 时复位。浏览器代码(import three),`node --check` + 现有测试不回归。

**Files:**
- Modify: `label/src/scene/camera_modes.js`

- [ ] **Step 1: import 纯函数 + 加缩放状态**

顶部 import 区加:
```javascript
import { computeWindow, zoomAtSolve, imageToCanvasNorm, canvasNormToImage } from './view_zoom.js';
```
构造函数里(`this.bgPlaneZ2D = ...` 之后、`_applyViewOffset()` 之前)加:
```javascript
    this._zoom = 1; this._panX = 0; this._panY = 0; // 2D 视图缩放状态(仅 2D 生效)
```

- [ ] **Step 2: `_applyViewOffset` 改走 computeWindow**

把 `_applyViewOffset` 整体替换为:
```javascript
  _applyViewOffset() {
    const win = computeWindow({
      imageW: this.imageW, imageH: this.imageH, cx: this.K.cx, cy: this.K.cy,
      zoom: this._zoom, panX: this._panX, panY: this._panY,
    });
    this._win = win; // 缓存供映射方法用
    this.camera.setViewOffset(this.imageW, this.imageH, win.winX, win.winY, win.winW, win.winH);
  }
```
(z=1、pan=0 时 win = 基准窗口,等价原行为,无回归。)

- [ ] **Step 3: 加缩放/平移/复位/映射方法**

在 `effectiveAspect()` 附近加:
```javascript
  getZoom() { return this._zoom; }

  // 以画布归一化点 (u,v) 为中心按 factor 缩放,保持该点下图像不动。
  zoomAt(u, v, factor) {
    const r = zoomAtSolve({
      imageW: this.imageW, imageH: this.imageH, cx: this.K.cx, cy: this.K.cy,
      zoom: this._zoom, panX: this._panX, panY: this._panY, u, v, factor,
    });
    this._zoom = r.zoom; this._panX = r.panX; this._panY = r.panY;
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // 按画布归一化位移平移(右/下为正);位移量换算成当前窗口的传感器像素。
  panByCanvas(du, dv) {
    if (!this._win) this._applyViewOffset();
    this._panX -= du * this._win.winW;
    this._panY -= dv * this._win.winH;
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
  }

  resetZoom() {
    if (this._zoom === 1 && this._panX === 0 && this._panY === 0) return;
    this._zoom = 1; this._panX = 0; this._panY = 0;
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // 图像像素 ↔ 画布归一化(经当前缩放窗口),供 bbox overlay 与拖拽共用。
  imageToCanvasNorm(ix, iy) {
    if (!this._win) this._applyViewOffset();
    return imageToCanvasNorm(ix, iy, this._win);
  }
  canvasNormToImage(u, v) {
    if (!this._win) this._applyViewOffset();
    return canvasNormToImage(u, v, this._win);
  }
```

- [ ] **Step 4: 切 3D 复位缩放**

`snapTo(mode)` 与 `switchTo(mode)` 里,当目标为 `'3d'` 时调 `this.resetZoom()`。
- `snapTo`:在设 `this.mode = mode` 之前或之后加 `if (mode === '3d') this.resetZoom();`
- `switchTo`:在函数开头(确定要切且 `mode==='3d'`)加 `if (mode === '3d') this.resetZoom();`(2D→3D 立即复位,tween 不受影响,因为缩放只改 viewOffset 不改位姿)。

- [ ] **Step 5: node --check + 现有测试**

```bash
node --check label/src/scene/camera_modes.js
node --test label/tests/*.test.js
```
解析通过;全绿(view_zoom 已测,camera 行为 z=1 时不变)。

- [ ] **Step 6: 提交**

```bash
git add label/src/scene/camera_modes.js
git commit -m "feat(zoom): camera_modes zoom state via setViewOffset + image<->canvas mapping; reset on 3D"
```

---

## Task 3: 背景纹理过滤(放大不糊成块)

放大时背景图应保持线性采样原始像素,不要变成马赛克。

**Files:**
- Modify: `label/src/scene/scene.js`

- [ ] **Step 1: setBackgroundTexture 设过滤**

读 `label/src/scene/scene.js` 的 `setBackgroundTexture(texture)`。在把 texture 赋给材质前加:
```javascript
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
```
(LinearMipmap 在缩小时会用 mip 级别变糊;放大看细节用 LinearFilter + 关 mipmap 直采原图最清晰。)

- [ ] **Step 2: node --check + 现有测试**

```bash
node --check label/src/scene/scene.js
node --test label/tests/*.test.js
```

- [ ] **Step 3: 提交**

```bash
git add label/src/scene/scene.js
git commit -m "feat(zoom): linear, non-mipmapped background filtering for crisp zoom-in"
```

---

## Task 4: app.js 接 2D 缩放滚轮 + root 深度改修饰键

把现有「2D + 整体/移动 裸滚轮调 root 深度」改成 **Cmd/Ctrl+滚轮**;**裸滚轮**在 2D 模式做以光标为中心的缩放。浏览器集成,`node --check` + 现有测试。

**Files:**
- Modify: `label/src/app.js`(改 `$('c').wheel` 处理 + boot 里 3D 按钮已调 syncUI;切 3D 复位在 camera 内已做)

- [ ] **Step 1: 重写 wheel 处理**

把现有 `$('c').addEventListener('wheel', ...)` 整块(app.js 约 542-555)替换为:
```javascript
  // 2D 滚轮:裸滚轮 = 以光标为中心缩放视图(viewOffset,不改内外参/数据);
  // Cmd(Mac)/Ctrl(其他)+ 滚轮 = 调 root 深度(整体/移动模式,低频,让位给缩放)。
  // 3D 模式不拦截滚轮(留给 OrbitControls dolly)。全平台:deltaY + deltaMode 归一化。
  let wheelTimer = null;
  $('c').addEventListener('wheel', (e) => {
    if (!cam || cam.mode !== '2d') return;
    const depthMod = e.metaKey || e.ctrlKey;

    // 归一化滚动量:像素/行/页统一到一个温和系数。
    const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1);
    const dy = e.deltaY * unit;

    if (!depthMod) {
      // 视图缩放:光标归一化坐标 → zoomAt。
      e.preventDefault();
      const rect = $('c').getBoundingClientRect();
      const u = (e.clientX - rect.left) / rect.width;
      const v = (e.clientY - rect.top) / rect.height;
      if (u < 0 || u > 1 || v < 0 || v > 1) return; // 光标不在画布(letterbox 黑边)忽略
      const factor = Math.exp(-dy * 0.0015); // 上滚放大、下滚缩小
      cam.zoomAt(u, v, factor);
      if (bboxOverlay) bboxOverlay.render(store?.current()?.bbox ?? null); // 缩放后重绘框
      return;
    }

    // root 深度(需修饰键 + 整体/移动模式 + 有数据)。
    if (!store || !store.current() || ui?.readOnly) return;
    if (!(ui.mode === 'root' && $('root-translate').classList.contains('on'))) return;
    e.preventDefault();
    const a = store.current();
    const pos = (a.root_pos || [0, 0, 0]).slice();
    pos[2] += (dy > 0 ? 1 : -1) * 0.05;
    if (wheelTimer === null) store.beginEdit();
    store.applyFields({ root_pos: pos });
    applyAnnotation();
    if (rootHandle) rootHandle.attach(pos);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { store.commitEdit(); wheelTimer = null; }, 250);
  }, { passive: false });
```

- [ ] **Step 2: node --check + 现有测试**

```bash
node --check label/src/app.js
node --test label/tests/*.test.js
```
解析通过;全绿。

- [ ] **Step 3: 提交**

```bash
git add label/src/app.js
git commit -m "feat(zoom): bare wheel = cursor-centered 2D zoom; root depth moves to Cmd/Ctrl+wheel"
```

---

## Task 5: app.js 空白拖拽平移 + bbox overlay 映射改走 camera

2D 下在画布空白处(未命中任何手柄)拖拽 = 平移视图;并把 bbox overlay 的屏幕↔图像映射改走 `cam.imageToCanvasNorm/canvasNormToImage`,缩放后框不错位。浏览器集成。

**Files:**
- Modify: `label/src/app.js`(画布空白拖拽平移)
- Modify: `label/src/edit/bbox_overlay.js`(映射改走 camera)

- [ ] **Step 1: bbox_overlay 映射改走 camera**

读 `label/src/edit/bbox_overlay.js`。`_imgToScreen`/`_screenToImg` 现用 `(ix/cam.imageW)*rect.width` 线性式。改为经 camera 的归一化映射(canvas 显示矩形 rect + stage 矩形不变,只把"图像→归一化"换成走 cam):
```javascript
  _imgToScreen(ix, iy, cam, rect, stageRect) {
    const [u, v] = cam.imageToCanvasNorm(ix, iy);
    const sx = rect.left - stageRect.left + u * rect.width;
    const sy = rect.top - stageRect.top + v * rect.height;
    return [sx, sy];
  }
  _screenToImg(sx, sy, cam, rect, stageRect) {
    const u = (sx + stageRect.left - rect.left) / rect.width;
    const v = (sy + stageRect.top - rect.top) / rect.height;
    return cam.canvasNormToImage(u, v);
  }
```
(z=1、pan=0 时 cam 映射退化为 `ix/imageW`,与原式一致,无回归。)

- [ ] **Step 2: app.js 画布空白拖拽平移**

在 boot() 的 wheel 监听附近,加画布指针平移(仅 2D、未命中手柄):
```javascript
  // 2D 空白拖拽 = 平移视图。命中手柄(engageGuards 任一 engaged)则让位给手柄。
  // bbox overlay 的角点 handle 自带 stopPropagation,不会落到这里。
  let panning = null;
  $('c').addEventListener('pointerdown', (e) => {
    if (!cam || cam.mode !== '2d') return;
    if (engageGuards.some((g) => g.isEngaged())) return; // 手柄优先
    panning = { x: e.clientX, y: e.clientY };
    $('c').setPointerCapture(e.pointerId);
  });
  $('c').addEventListener('pointermove', (e) => {
    if (!panning) return;
    const rect = $('c').getBoundingClientRect();
    const du = (e.clientX - panning.x) / rect.width;
    const dv = (e.clientY - panning.y) / rect.height;
    panning.x = e.clientX; panning.y = e.clientY;
    cam.panByCanvas(du, dv);
    if (bboxOverlay) bboxOverlay.render(store?.current()?.bbox ?? null);
  });
  const endPan = (e) => { if (panning) { try { $('c').releasePointerCapture(e.pointerId); } catch (_) {} panning = null; } };
  $('c').addEventListener('pointerup', endPan);
  $('c').addEventListener('pointercancel', endPan);
```
> 注:joint picker 也监听 canvas pointerdown(用于选关节)。平移与选关节都在画布空白触发会冲突——但 picker 只在命中关节球时 `onPick`、空白处 `onMiss`(取消选中)。为不打架:平移应只在「按下并实际移动」时才生效,纯点击空白仍走 picker 的 onMiss 取消选中。改进:`pointerdown` 只记起点不夺捕获;`pointermove` 中累计位移超过阈值(如 4px)才进入 panning 并 setPointerCapture;否则不平移,让 click/onMiss 正常。把上面 pointerdown/move 调整为阈值触发:
```javascript
  let panStart = null, panning = false;
  $('c').addEventListener('pointerdown', (e) => {
    if (!cam || cam.mode !== '2d' || engageGuards.some((g) => g.isEngaged())) { panStart = null; return; }
    panStart = { x: e.clientX, y: e.clientY, id: e.pointerId }; panning = false;
  });
  $('c').addEventListener('pointermove', (e) => {
    if (!panStart) return;
    const rect = $('c').getBoundingClientRect();
    if (!panning && Math.hypot(e.clientX - panStart.x, e.clientY - panStart.y) > 4) {
      panning = true; $('c').setPointerCapture(panStart.id);
    }
    if (!panning) return;
    const du = (e.clientX - panStart.x) / rect.width;
    const dv = (e.clientY - panStart.y) / rect.height;
    panStart.x = e.clientX; panStart.y = e.clientY;
    cam.panByCanvas(du, dv);
    if (bboxOverlay) bboxOverlay.render(store?.current()?.bbox ?? null);
  });
  const endPan = (e) => { if (panning) { try { $('c').releasePointerCapture(e.pointerId); } catch (_) {} } panStart = null; panning = false; };
  $('c').addEventListener('pointerup', endPan);
  $('c').addEventListener('pointercancel', endPan);
```
用后一版(阈值触发),删除前一版。

- [ ] **Step 3: node --check + 现有测试**

```bash
node --check label/src/app.js label/src/edit/bbox_overlay.js
node --test label/tests/*.test.js
```

- [ ] **Step 4: 提交**

```bash
git add label/src/app.js label/src/edit/bbox_overlay.js
git commit -m "feat(zoom): blank-drag pan (threshold, yields to handles/pick) + bbox overlay maps via camera"
```

---

## Task 6: 人工验证

**Files:** 无。

- [ ] **Step 1** 服务 + Chrome/Edge 打开 `test_data`(或一张大图)。
- [ ] **Step 2** 2D 对齐下裸滚轮/双指:以光标为中心放大,放大后图像清晰(接近原生、非马赛克),UI 侧栏不放大。
- [ ] **Step 3** 放大后空白拖拽:平移视图;点空白(不拖)仍取消关节选中(不被平移吞掉)。
- [ ] **Step 4** 放大状态下:选关节出 gizmo 能正常拖、bbox 四角与框贴合不错位、IK 拖手腕正常。
- [ ] **Step 5** 整体/移动模式 Cmd/Ctrl+滚轮:调 root 深度(裸滚轮此时是缩放,互不干扰)。
- [ ] **Step 6** 切到 3D 自由:缩放自动复位、3D 滚轮是 OrbitControls dolly、一切正常;切回 2D 从 1× 开始。
- [ ] **Step 7** 确认保存的数据无变化(缩放不改内外参/SMPL):放大后保存的 json 与未放大保存一致。记录通过情况。

## Out of scope

- 3D 视角缩放(OrbitControls 自带);旋转视图;像素吸附。

## Self-review(已核对)

- spec 每节有对应 Task:viewOffset 机制(T2)、缩放状态/方法(T2)、纯数学+测试(T1)、交互滚轮缩放(T4)、空白拖拽平移(T5)、root 深度改键(T4)、切 3D 复位(T2)、映射统一(T1+T5)、背景过滤(T3)、人工验证(T6)。
- 无占位符;每个写码步骤含完整代码。
- 接口跨 Task 一致:`computeWindow/zoomAtSolve/imageToCanvasNorm/canvasNormToImage`(T1)→ camera `zoomAt/panByCanvas/resetZoom/getZoom/imageToCanvasNorm/canvasNormToImage`(T2)→ app/overlay 调用(T4/T5)。
- 复用:`engageGuards`(已存在,T5 平移让位手柄)、`bboxOverlay.render`、`store` 事务。
- 数据不变性:viewOffset 不进 `this.K`/位姿/forward,保存零影响(T6 验证)。



