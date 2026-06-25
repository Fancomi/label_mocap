# 视口 UX 打磨 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在三视口特性之上收口 7 项打磨：mesh 跟随相机打光+调亮、手柄仅 active 视口可见（连带修跨视口缩放）、点大小三视一致、DOM 视口边框、可最小化快捷键提示面板、预设砍到两个、「锁定为重置视角」+ R 以坐标轴为前提。

**Architecture:** 纯逻辑「相对方位」记忆抽到 `framing.js`（可单测）；`Viewport` 用它实现 captureAsReset/resetOrientation；`ViewportManager` 在逐区渲染时切手柄可见性、暴露 rects 给 DOM 边框；各 scene 加跟随 active 相机的方向光；point_cloud 关 sizeAttenuation；pcd app/html 重做 vp-bar（移除 mainbig、锁→capture-reset 移到各视口、加提示面板）。

**Tech Stack:** Vanilla ES modules, three.js（vendored，importmap），`node --test`。无构建步骤。

---

## 文件结构

- **改** `smpl_edit/framing.js` — 加 `relativeBearing(camPos, target, up)` 与 `placeFromBearing(bearing, center, up)` 纯函数。新增测试。
- **改** `smpl_edit/viewport.js` — 重置基准改为「相对方位」；`captureAsReset()`、`resetOrientation` 重写、`setResetAxes`、去掉 setLocked 语义残留。
- **改** `smpl_edit/viewport_manager.js` — render 逐区切手柄可见；`registerHandleObjects()`；删 main-big 预设无需改（computeRects 已兼容，app 不再调）；`syncControlsEnabled` 保留。
- **改** `pcd_label/src/scene/point_cloud.js` — `sizeAttenuation: false`。
- **改** `label/src/scene/scene.js`、`pcd_label/src/scene/pcd_scene.js` — 加跟随 active 相机方向光 + mesh 调亮 + `setLightFromCamera(cam, center)`。
- **改** `pcd_label/src/app.js`、`pcd_label/index.html` — vp-bar 重做（删 mainbig、锁→「锁定为重置视角」移到各视口角 + DOM 边框 + 手柄注册 + 提示面板 + R 走 captureAsReset 基准）。
- **改** `label/index.html`、`label/src/app.js` — 快捷键提示面板（列 F）。

---

## Task 1: framing.js — 相对方位记忆（纯逻辑）

**Files:**
- Modify: `smpl_edit/framing.js`
- Test: `smpl_edit/tests/framing.test.js`

「相对方位」= 相机相对人体中心的单位方向向量 + 距离，**在以 up 为参照的坐标里表达**。最简稳妥版：bearing 存「世界单位方向 + 距离」，`placeFromBearing` 用它从 center 退开放置相机。坐标轴变化时，标准朝向由 `cameraPlacement` 给（已存在）；用户「锁定」的方位则按世界方向记忆并复用——满足「R 回到记忆角度，且 F/坐标轴不被破坏」。

- [ ] **Step 1: 追加失败测试到 `smpl_edit/tests/framing.test.js`**

```javascript
test('relativeBearing returns unit direction (cam→target reversed) and distance', () => {
  const b = relativeBearing([0, 0, 10], [0, 0, 0]);
  // 相机在 +Z 看向原点 → bearing 方向是 target→cam = +Z
  assert.ok(Math.abs(b.dir[0]) < 1e-9 && Math.abs(b.dir[1]) < 1e-9 && Math.abs(b.dir[2] - 1) < 1e-9);
  assert.ok(Math.abs(b.dist - 10) < 1e-9);
});

test('placeFromBearing reconstructs the camera position from center+bearing', () => {
  const b = relativeBearing([3, 4, 0], [0, 0, 0]); // dist 5, dir (0.6,0.8,0)
  const out = placeFromBearing(b, [1, 1, 1]);
  // center + dir*dist = (1,1,1) + (0.6,0.8,0)*5 = (4,5,1)
  assert.ok(Math.hypot(out.position[0]-4, out.position[1]-5, out.position[2]-1) < 1e-6);
  assert.deepEqual(out.target, [1, 1, 1]);
});

test('relativeBearing degenerate (cam==target) falls back to +Z dir, dist>0', () => {
  const b = relativeBearing([2, 2, 2], [2, 2, 2]);
  assert.equal(b.dir.length, 3);
  assert.ok(b.dist > 0);
  assert.ok(Number.isFinite(b.dir[0]) && Number.isFinite(b.dir[1]) && Number.isFinite(b.dir[2]));
});
```

- [ ] **Step 2: 跑红**

Run: `node --test smpl_edit/tests/framing.test.js`
Expected: FAIL — `relativeBearing is not exported`。

- [ ] **Step 3: 追加实现到 `smpl_edit/framing.js`**

```javascript
// 相机相对人体中心的「方位」:单位方向(target→cam)+ 距离。供「锁定为重置视角」记忆。
export function relativeBearing(camPos, target) {
  let dx = camPos[0]-target[0], dy = camPos[1]-target[1], dz = camPos[2]-target[2];
  let L = Math.hypot(dx, dy, dz);
  if (L < 1e-9) { dx = 0; dy = 0; dz = 1; L = 1; } // 退化:默认 +Z,距离 1
  return { dir: [dx/L, dy/L, dz/L], dist: L };
}

// 由方位 + 人体中心还原相机位置(target 即 center)。
export function placeFromBearing(bearing, center) {
  const { dir, dist } = bearing;
  return {
    position: [center[0]+dir[0]*dist, center[1]+dir[1]*dist, center[2]+dir[2]*dist],
    target: center.slice(),
  };
}
```

- [ ] **Step 4: 跑绿**

Run: `node --test smpl_edit/tests/framing.test.js`
Expected: 全 PASS（含原 5 + 新 3 = 8）。

- [ ] **Step 5: 提交**

```bash
git add smpl_edit/framing.js smpl_edit/tests/framing.test.js
git commit -m "feat(viewport): framing relativeBearing/placeFromBearing for capture-reset"
```

## Task 2: Viewport — 「锁定为重置视角」+ R 走记忆基准

每个视口存一个 `_resetBearing`（null = 未锁定，用标准朝向）。`captureAsReset()` 把当前姿态记成 bearing；`resetOrientation` 优先用 bearing（按当前 center/radius 还原），否则回标准朝向。去掉 `setLocked` 的「锁交互」语义——不再禁 controls，改为纯「记忆基准」。

**Files:** Modify `smpl_edit/viewport.js`

- [ ] **Step 1: 顶部 import 加 relativeBearing/placeFromBearing**

把 `import { focusPlacement } from './framing.js';` 改为：

```javascript
import { focusPlacement, relativeBearing, placeFromBearing } from './framing.js';
```

- [ ] **Step 2: 构造去掉 locked、加 _resetBearing**

把构造里 `this.locked = false;` 改为 `this._resetBearing = null; // null=用标准朝向;非空=用户锁定的相对方位`。

- [ ] **Step 3: 加 captureAsReset，重写 resetOrientation，去掉 setLocked**

删除现有 `setLocked` 方法。把 `resetOrientation` 整段替换，并加 `captureAsReset`：

```javascript
  setResetAxes(dirAxis, upAxis) { this._dirAxis = dirAxis; this._upAxis = upAxis; }

  // 锁定为重置视角:把当前相机相对人体中心的方位记为重置基准。center 缺省用当前 target。
  captureAsReset(center) {
    const c = center ?? this.controls.target.toArray();
    this._resetBearing = relativeBearing(this.camera.position.toArray(), c);
  }

  // R 重置:有记忆基准则按它(以当前 center/radius 还原);否则回标准正交朝向。
  // 始终设 camera.up = 当前上轴 → 坐标轴是重置的前提。
  resetOrientation(center, radius) {
    const c = center ?? this.controls.target.toArray();
    const r = (radius && radius > 0) ? radius : this._lastRadius;
    this._lastRadius = r;
    let pos, up;
    if (this._resetBearing) {
      const p = placeFromBearing(this._resetBearing, c);
      pos = p.position;
      up = axisVec(this._upAxis); // 上轴为前提:记忆方位在当前上轴下解释
    } else {
      const place = cameraPlacement(this._upAxis, this._dirAxis, c, r);
      pos = place.position; up = place.up;
    }
    this.camera.up.set(up[0], up[1], up[2]);
    this.camera.position.set(pos[0], pos[1], pos[2]);
    this.controls.target.set(c[0], c[1], c[2]);
    if (this.kind === 'ortho') this._fitOrtho(r);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }
```

`axisVec` 从 view_frame 导入：把 `import { cameraPlacement } from './view_frame.js';` 改为 `import { cameraPlacement, axisVec } from './view_frame.js';`（确认 view_frame.js 已 export axisVec——它有）。

- [ ] **Step 4: 全局搜残留 setOrientationAxes 改名一致**

原 `setOrientationAxes` 已被 `setResetAxes` 取代（语义同：设标准朝向轴）。全仓搜调用处统一（pcd app.js 的 applyAxisFrame 调过 `setOrientationAxes`）。本步只改 viewport.js 内定义；调用处在 Task 6 改。为避免悬空，**保留一个别名**：在 viewport.js 末尾 class 内加 `setOrientationAxes(d, u) { this.setResetAxes(d, u); }`，使旧调用不炸；Task 6 再清理调用方后此别名可留可删（留着无害）。

- [ ] **Step 5: 语法检查**

Run: `node --input-type=module -e "import('./smpl_edit/viewport.js').then(()=>console.log('ok')).catch(e=>{const s=String(e); if(s.includes('three'))console.log('ok (three)'); else {console.error(s);process.exit(1);}})"`
Expected: ok。

- [ ] **Step 6: 全量测试**

Run: `npm run test:web`
Expected: 0 失败。

- [ ] **Step 7: 提交**

```bash
git add smpl_edit/viewport.js
git commit -m "feat(viewport): capture-as-reset bearing; R resets via axis-relative bearing"
```

## Task 3: ViewportManager — 手柄仅 active 可见 + 去掉 locked 引用

render 逐区时，画**非 active** 视口前把注册的手柄对象 `.visible=false`，画 **active** 时恢复——手柄只在 active 视口出现，size 也只由 active 相机决定（根治跨视口缩放）。同时清掉 `vp.locked` 引用（Task 2 已移除该语义）。

**Files:** Modify `smpl_edit/viewport_manager.js`

- [ ] **Step 1: 构造加手柄对象列表**

构造函数里（`this._active = 'main';` 附近）加：`this._handleObjects = [];`

加方法（放在 render 附近）：

```javascript
  // 注册「仅 active 视口可见」的手柄对象(TransformControls helper + marker 等)。
  registerHandleObjects(objs) { this._handleObjects.push(...objs); }
```

- [ ] **Step 2: render 里逐区切手柄可见**

把 `render` 替换为：

```javascript
  render(renderer, scene) {
    const W = this._canvas.width, H = this._canvas.height;
    if (!W || !H) return;
    for (const rect of this._rects) {
      const vp = this._vps.get(rect.name); if (!vp) continue;
      const isActive = rect.name === this._active;
      // 手柄只在 active 视口那一遍可见(共享 scene,逐对象切 visible)。
      for (const o of this._handleObjects) { o._wasVisible ??= o.visible; o.visible = isActive ? o._wasVisible : false; }
      vp.update();
      vp.applyScissor(renderer, this._pxRect(rect, W, H));
      renderer.render(scene, vp.camera);
    }
    // 渲染结束恢复各对象的「意图可见性」,不影响下帧/单视口逻辑。
    for (const o of this._handleObjects) { if (o._wasVisible !== undefined) { o.visible = o._wasVisible; o._wasVisible = undefined; } }
    renderer.setScissorTest(false);
  }
```

说明：用 `_wasVisible` 缓存每个对象「本帧进入 render 时的意图可见性」（由 app 的 syncUI/handle.attach 决定），逐区切换后还原，确保单视口或 syncUI 的 detach 逻辑不被破坏。

- [ ] **Step 3: 去掉 locked 引用**

`_syncControlsEnabled` 改为（不再读 `vp.locked`）：

```javascript
  _syncControlsEnabled() {
    for (const vp of this._vps.values()) vp.controls.enabled = (vp.name === this._active);
  }
```

`setActiveControlsEnabled` 改为：

```javascript
  setActiveControlsEnabled(enabled) {
    const vp = this.activeViewport();
    if (vp) vp.controls.enabled = enabled;
  }
```

- [ ] **Step 4: 语法检查 + 全量测试**

Run: `node --input-type=module -e "import('./smpl_edit/viewport_manager.js').then(()=>console.log('ok')).catch(e=>{const s=String(e); if(s.includes('three'))console.log('ok (three)'); else {console.error(s);process.exit(1);}})"`
Expected: ok。

Run: `npm run test:web`
Expected: 0 失败。

- [ ] **Step 5: 提交**

```bash
git add smpl_edit/viewport_manager.js
git commit -m "feat(viewport): handles visible only in active viewport; drop locked refs"
```

## Task 4: 各 scene — 跟随 active 相机的方向光 + mesh 调亮

两 scene 加一盏「头灯」方向光，每帧 render 前把它移到 active 相机方向（光从相机打向人体），面向相机的面始终亮。mesh 颜色调更白更亮。

**Files:** Modify `label/src/scene/scene.js`、`pcd_label/src/scene/pcd_scene.js`

- [ ] **Step 1: label scene 加头灯 + 调亮 mesh**

`label/src/scene/scene.js` 构造里，在现有 `key`/Ambient 之后加一盏可寻址的头灯：

```javascript
    this._headLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this._scene.add(this._headLight);
    this._scene.add(this._headLight.target);
```

加方法（放 render 附近）：

```javascript
  // 头灯:光从相机方向打向人体中心,使面向相机的面受光。cam 为当前 active 相机。
  setLightFromCamera(cam, center) {
    if (!this._headLight || !cam) return;
    const c = center || [0, 0, 0];
    this._headLight.target.position.set(c[0], c[1], c[2]);
    this._headLight.position.copy(cam.position);
  }
```

把 mesh 材质 `color: 0xf0f0f0` 调亮为 `color: 0xfafafa`（更白），其余不变（`label/src/scene/scene.js` setTopology 里那行）。

- [ ] **Step 2: label render 里调头灯**

label 单视口，在 `render()` 里 `this._cam.update()` 之前加：

```javascript
    this.setLightFromCamera(this._cam.camera, this._followCenter);
```

`_followCenter` 由 app 在 applyAnnotation 时写入（Step 5）；缺省 null → 用 [0,0,0]。在构造里加 `this._followCenter = null;` 并加 setter `setFollowCenter(c) { this._followCenter = c; }`。

- [ ] **Step 3: pcd scene 加头灯 + 调亮 mesh**

`pcd_label/src/scene/pcd_scene.js` 构造里现有 Ambient 之后加：

```javascript
    this._headLight = new THREE.DirectionalLight(0xffffff, 0.55);
    this._scene.add(this._headLight);
    this._scene.add(this._headLight.target);
    this._followCenter = null;
```

加同样的 `setLightFromCamera(cam, center)` 与 `setFollowCenter(c)` 方法。mesh 材质 `color: 0xf0c0a0` 调亮为 `color: 0xf2ddd0`（更白更亮）。

- [ ] **Step 4: pcd render 里调头灯（多视口用 active 相机）**

`pcd_label/src/scene/pcd_scene.js` 的 `render()` 改为在委托/单相机渲染前更新头灯。manager 模式用 active 相机；单相机用 `_cam.camera`：

```javascript
  render() {
    this._applyVisibility();
    if (this._manager) {
      this.setLightFromCamera(this._manager.activeCamera(), this._followCenter);
      this._manager.render(this._renderer, this._scene);
      return;
    }
    if (!this._cam) return;
    this.setLightFromCamera(this._cam.camera, this._followCenter);
    this._cam.update();
    this._renderer.render(this._scene, this._cam.camera);
  }
```

- [ ] **Step 5: 两 app 写入 followCenter**

pcd `app.js` 的 `applyAnnotation()`（更新 mesh/joints 后）加：`scene.setFollowCenter(lastJoints ? bodyBounds(lastJoints)?.center : null);`（确认 `bodyBounds` 已 import；pcd app 在 TV-7 已 import）。
label `app.js` 的 `applyAnnotation()`（已算 `lastJoints`、调 `cam.set3DFollowTarget`）后加：`scene.setFollowCenter(lastJoints ? [lastJoints[0], lastJoints[1], lastJoints[2]] : null);`（用 pelvis 即可，label 单视口）。label `app.js` 已 import bodyBounds（TV-8）；这里用 pelvis 简单即可，不必算 bounds。

- [ ] **Step 6: 语法检查 + 全量测试**

Run: `for f in label/src/scene/scene.js pcd_label/src/scene/pcd_scene.js; do node --input-type=module -e "import('./$f').then(()=>console.log('$f ok')).catch(e=>{const s=String(e); if(s.includes('three'))console.log('$f ok (three)'); else {console.error(s);process.exit(1);}})"; done`
Expected: 两 ok。

Run: `npm run test:web`
Expected: 0 失败。

- [ ] **Step 7: 提交**

```bash
git add label/src/scene/scene.js pcd_label/src/scene/pcd_scene.js label/src/app.js pcd_label/src/app.js
git commit -m "feat(scene): camera-following head light + brighter mesh (lit side faces camera)"
```

## Task 5: 点大小三视一致 — 关 sizeAttenuation

`PointsMaterial` 的 `sizeAttenuation: true` 在 scissor 子视口下按整块 drawing-buffer 高度算衰减，导致点大小只在主视生效。关掉它，size 变屏幕像素恒定，三视一致。

**Files:** Modify `pcd_label/src/scene/point_cloud.js`

- [ ] **Step 1: 改材质**

把 `point_cloud.js` 的：

```javascript
    this._mat = new THREE.PointsMaterial({ size: 0.03, vertexColors: true, sizeAttenuation: true });
```

改为：

```javascript
    // sizeAttenuation:false → 屏幕像素恒定大小,不随 scissor 子视口高度错算(三视口一致)。
    this._mat = new THREE.PointsMaterial({ size: 3, vertexColors: true, sizeAttenuation: false });
```

（关衰减后 size 单位是像素，原 0.03 世界单位太小看不见，改为 3 像素的合理初值。）

- [ ] **Step 2: 调滑块范围匹配像素单位**

`pcd_label/index.html` 的点大小滑块（`id="point-size"`）从世界单位范围改成像素范围：

把 `<input id="point-size" type="range" min="0.005" max="0.1" step="0.005" value="0.03">`
改为 `<input id="point-size" type="range" min="1" max="10" step="0.5" value="3">`

- [ ] **Step 3: 语法检查 + 全量测试**

Run: `node --input-type=module -e "import('./pcd_label/src/scene/point_cloud.js').then(()=>console.log('ok')).catch(e=>{const s=String(e); if(s.includes('three'))console.log('ok (three)'); else {console.error(s);process.exit(1);}})"`
Expected: ok。

Run: `npm run test:web`
Expected: 0 失败。

- [ ] **Step 4: 提交**

```bash
git add pcd_label/src/scene/point_cloud.js pcd_label/index.html
git commit -m "fix(pcd): point size sizeAttenuation off → consistent across 3 viewports"
```

## Task 6: pcd app/html — vp-bar 重做 + DOM 边框 + 手柄注册 + 提示面板

最重的一项。改 vp-bar：删「主大参考小」预设；锁按钮→「锁定为重置视角」并移到各视口角；加 DOM 视口边框（active 高亮）；注册手柄对象给 manager；加可最小化快捷键提示面板；R 走 captureAsReset 基准。

**Files:** Modify `pcd_label/index.html`、`pcd_label/src/app.js`

- [ ] **Step 1: index.html vp-bar 改造 + 边框 + 视口角按钮 + 提示面板 DOM**

把现有 vp-bar 块（含 vp-mainbig、vp-lock-side、vp-lock-front）替换为：

```html
<div id="vp-bar">
      <button id="vp-single" title="单视口">▢</button>
      <button id="vp-tri" class="on" title="三视口">▥</button>
    </div>
    <div id="vp-split-v" class="vp-split"></div>
    <div id="vp-split-h" class="vp-split"></div>
    <div id="vp-borders"></div>
    <div id="vp-cap-side" class="vp-cap" title="锁定为重置视角(侧)">⊙</div>
    <div id="vp-cap-front" class="vp-cap" title="锁定为重置视角(正)">⊙</div>
    <div id="kbd-hint" class="kbd-hint">
      <div class="kbd-hint-head"><span>快捷键</span><button id="kbd-hint-toggle" title="最小化">▾</button></div>
      <div class="kbd-hint-body">
        <div><b>F</b> 聚焦人体中心</div>
        <div><b>R</b> 重置当前视口朝向</div>
        <div><b>⊙</b> 锁定为重置视角(侧/正)</div>
        <div class="kbd-hint-note">鼠标所在视口为当前视口</div>
      </div>
    </div>
```

CSS 加到 `<style>`（vp-bar 已有样式保留；新增 cap/border/hint）：

```css
    #vp-borders { position:absolute; inset:0; pointer-events:none; z-index:3; }
    .vp-border { position:absolute; border:1px solid #2a3a4a; box-sizing:border-box; }
    .vp-border.active { border-color:#2fd6e0; box-shadow:0 0 0 1px #2fd6e0 inset; }
    .vp-cap { position:absolute; z-index:5; width:20px; height:20px; line-height:18px; text-align:center; background:#16202c; color:#cfe; border:1px solid #2a3340; border-radius:4px; cursor:pointer; font-size:12px; display:none; }
    .vp-cap.on { background:#2563a8; }
    .kbd-hint { position:absolute; right:8px; bottom:8px; z-index:6; background:#111922; border:1px solid #2a3340; border-radius:6px; color:#bcd; font-size:11px; min-width:140px; }
    .kbd-hint-head { display:flex; justify-content:space-between; align-items:center; padding:4px 8px; border-bottom:1px solid #2a3340; }
    .kbd-hint-head button { background:none; border:none; color:#8ab; cursor:pointer; font-size:12px; }
    .kbd-hint-body { padding:6px 8px; display:flex; flex-direction:column; gap:3px; }
    .kbd-hint-body b { color:#2fd6e0; }
    .kbd-hint-note { color:#789; margin-top:2px; }
    .kbd-hint.min .kbd-hint-body { display:none; }
    .kbd-hint.min { min-width:0; }
```

- [ ] **Step 2: app.js — 预设砍到两个**

把 `setPreset`/按钮接线段（现 269-276 行附近）替换为：

```javascript
  const setPreset = (p, btn) => {
    mgr.setLayout(p);
    ['vp-single', 'vp-tri'].forEach((id) => $(id).classList.toggle('on', id === btn));
    placeSplits(); placeBordersAndCaps();
  };
  $('vp-single').addEventListener('click', () => setPreset('single', 'vp-single'));
  $('vp-tri').addEventListener('click', () => setPreset('tri', 'vp-tri'));
```

- [ ] **Step 3: app.js — DOM 边框 + 视口角按钮定位（placeBordersAndCaps）**

加在 `placeSplits` 附近：

```javascript
  // 按 manager 的归一矩形摆放各视口的 DOM 边框 + active 高亮 + 侧/正「锁定为重置」角标。
  const placeBordersAndCaps = () => {
    const stage = $('stage'); const W = stage.clientWidth, H = stage.clientHeight;
    const host = $('vp-borders'); host.innerHTML = '';
    const rects = mgr.visibleRects();
    const active = mgr.activeViewport()?.name;
    for (const r of rects) {
      const d = document.createElement('div');
      d.className = 'vp-border' + (r.name === active ? ' active' : '');
      d.style.left = `${r.x * W}px`; d.style.top = `${r.y * H}px`;
      d.style.width = `${r.w * W}px`; d.style.height = `${r.h * H}px`;
      host.appendChild(d);
    }
    // 角标:放对应视口右上角(仅 side/front 且该视口可见时显示)。
    for (const [capId, vpName] of [['vp-cap-side', 'side'], ['vp-cap-front', 'front']]) {
      const cap = $(capId); const rect = rects.find((x) => x.name === vpName);
      if (!rect) { cap.style.display = 'none'; continue; }
      cap.style.display = 'block';
      cap.style.left = `${(rect.x + rect.w) * W - 24}px`;
      cap.style.top = `${rect.y * H + 4}px`;
    }
  };
```

- [ ] **Step 4: app.js — active 变化时刷新边框高亮**

manager 的 `onActiveChange`（TV-7 在 boot() 里建 mgr 时的回调）里追加 `placeBordersAndCaps();`。读 boot() 找到 `onActiveChange: () => { const c = mgr.activeCamera(); camConsumers.forEach((fn) => fn(c)); }`，改为：

```javascript
    onActiveChange: () => { const c = mgr.activeCamera(); camConsumers.forEach((fn) => fn(c)); placeBordersAndCaps(); },
```

（`placeBordersAndCaps` 在 boot2 定义、boot() 在它之前执行——但 onActiveChange 是运行时回调，触发时 boot2 已跑完，闭包能取到。为安全，用 `if (typeof placeBordersAndCaps === 'function')` 包一层，或把 placeBordersAndCaps 提到模块作用域 let。**采用**：在模块顶部状态区加 `let placeBordersAndCaps = () => {};`，boot2 里改为赋值 `placeBordersAndCaps = () => {...}` 而非 const，规避时序。）

- [ ] **Step 5: app.js — 锁按钮→「锁定为重置视角」角标**

把 `lockBtn`/调用段（现 291-298 行）替换为：

```javascript
  const capBtn = (id, name) => $(id).addEventListener('click', () => {
    const vp = mgr.viewport(name); if (!vp) return;
    const b = bodyBounds(lastJoints);
    vp.captureAsReset(b ? b.center : undefined); // 记当前姿态为该视口重置基准
    $(id).classList.add('on'); setTimeout(() => $(id).classList.remove('on'), 400); // 短暂高亮反馈
    setStatus(`已锁定${name === 'side' ? '侧' : '正'}视为重置视角`);
  });
  capBtn('vp-cap-side', 'side'); capBtn('vp-cap-front', 'front');
  window.addEventListener('resize', () => { placeSplits(); placeBordersAndCaps(); });
  placeSplits(); placeBordersAndCaps();
```

（删掉旧的 `lockBtn`/`setLocked`/`syncControlsEnabled` 文案那段；`syncControlsEnabled` 本身保留在 manager，但锁语义已无。）

- [ ] **Step 6: app.js — 拖分隔条时也刷新边框**

`dragSplit` 的 move 回调里 `placeSplits();` 后加 `placeBordersAndCaps();`。

- [ ] **Step 7: app.js — R 键去掉锁按钮文案同步（锁已改角标）**

把 keydown 里 R 分支（现 310-314 行）替换为：

```javascript
    } else if (e.key === 'r' || e.key === 'R') {
      vp.resetOrientation(b ? b.center : undefined, b ? b.radius : undefined);
    }
```

（删掉对 vp-lock-side/front 文案的同步——那两个按钮已不存在。F 分支不变。）

- [ ] **Step 8: app.js — 提示面板最小化 + 注册手柄对象**

在 boot2 末尾加：

```javascript
  $('kbd-hint-toggle').addEventListener('click', () => {
    const min = $('kbd-hint').classList.toggle('min');
    $('kbd-hint-toggle').textContent = min ? '▸' : '▾';
  });
```

手柄注册——给三个类各加一个 `sceneObjects()` 返回它加进 scene 的对象（proxy + TransformControls helper）。三个类构造里都已有 `this._proxy`，且把 `this._tc.getHelper ? this._tc.getHelper() : this._tc` 加进 scene。

**pose_gizmo.js**：构造里把 `this._scene.add(this._tc.getHelper ? this._tc.getHelper() : this._tc);` 改为先存引用：
```javascript
    this._helper = this._tc.getHelper ? this._tc.getHelper() : this._tc;
    this._scene.add(this._helper);
```
加方法：`sceneObjects() { return [this._proxy, this._helper]; }`

**root_handle.js / drag_handle.js**：它们 attach 时 `this._scene.add(this._tc)`（旧版 TransformControls 自身即 helper，无 getHelper）。各加：`sceneObjects() { return [this._proxy, this._tc]; }`（`this._proxy` 与 `this._tc` 构造里都有）。

app 注册（boot3 建好 poseGizmo/rootHandle 之后）：
```javascript
  mgr.registerHandleObjects([...poseGizmo.sceneObjects(), ...rootHandle.sceneObjects()]);
```
IK 两柄经 ctx：installIK ctx 加 `registerHandleObjects: (objs) => mgr.registerHandleObjects(objs)`；`ik_plugin.js` 在两柄建好后加 `ctx.registerHandleObjects?.([...ikHandle.sceneObjects(), ...poleHandle.sceneObjects()]);`（DragHandle 的 sceneObjects 含 proxy，marker 是 proxy 子节点随之隐藏）。

注意：`registerHandleObjects` 注册的是「仅 active 可见」的对象——它们的 `.visible` 由各自 attach/detach/setActive 决定（意图可见性），manager 只在画非 active 视口时临时压成 false 再还原（Task 3 的 `_wasVisible` 机制）。所以注册后，非 active 视口不再出现手柄，单视口/syncUI 行为不变。

- [ ] **Step 9: 语法检查 + 全量测试**

Run: `for f in pcd_label/src/app.js smpl_edit/pose_gizmo.js smpl_edit/root_handle.js smpl_edit/drag_handle.js smpl_edit/ik_plugin.js; do node --input-type=module -e "import('./$f').then(()=>console.log('$f ok')).catch(e=>{const s=String(e); if(s.includes('three'))console.log('$f ok (three)'); else {console.error(s);process.exit(1);}})"; done`
Expected: 全 ok。

Run: `npm run test:web`
Expected: 0 失败。

- [ ] **Step 10: 提交**

```bash
git add pcd_label/src/app.js pcd_label/index.html smpl_edit/pose_gizmo.js smpl_edit/root_handle.js smpl_edit/drag_handle.js smpl_edit/ik_plugin.js
git commit -m "feat(pcd): vp-bar redo — 2 presets, capture-as-reset caps, DOM borders, hint panel, handle registration"
```

## Task 7: label — 快捷键提示面板（列 F）

label 单视口，只加一个右下角可最小化提示面板（列 F 聚焦）。

**Files:** Modify `label/index.html`、`label/src/app.js`

- [ ] **Step 1: index.html 加面板 DOM + CSS**

`label/index.html` 的 `#stage` 内、`<div id="status">` 之前加：

```html
<div id="kbd-hint" class="kbd-hint">
      <div class="kbd-hint-head"><span>快捷键</span><button id="kbd-hint-toggle" title="最小化">▾</button></div>
      <div class="kbd-hint-body"><div><b>F</b> 聚焦人体中心(3D)</div></div>
    </div>
```

CSS 加到 `<style>`：

```css
    .kbd-hint { position:absolute; right:8px; bottom:8px; z-index:6; background:#111922; border:1px solid #2a3340; border-radius:6px; color:#bcd; font-size:11px; min-width:120px; }
    .kbd-hint-head { display:flex; justify-content:space-between; align-items:center; padding:4px 8px; border-bottom:1px solid #2a3340; }
    .kbd-hint-head button { background:none; border:none; color:#8ab; cursor:pointer; font-size:12px; }
    .kbd-hint-body { padding:6px 8px; }
    .kbd-hint-body b { color:#2fd6e0; }
    .kbd-hint.min .kbd-hint-body { display:none; }
    .kbd-hint.min { min-width:0; }
```

- [ ] **Step 2: app.js 加最小化切换**

在事件装配处（F 键 keydown 附近）加：

```javascript
  $('kbd-hint-toggle').addEventListener('click', () => {
    const min = $('kbd-hint').classList.toggle('min');
    $('kbd-hint-toggle').textContent = min ? '▸' : '▾';
  });
```

- [ ] **Step 3: 语法检查 + 全量测试**

Run: `npm run test:web`
Expected: 0 失败（含 label index/app 加载测试）。

- [ ] **Step 4: 提交**

```bash
git add label/index.html label/src/app.js
git commit -m "feat(label): minimizable shortcut hint panel (F focus)"
```

---

## Task 8: 全量套件 + 手验清单

**Files:** none（验证）

- [ ] **Step 1: 全量套件**

Run: `npm test`
Expected: web/tools/server 全 0 失败。

- [ ] **Step 2: 记录浏览器手验清单**

pcd（`node smpl_web_viewer/tools/static_server.mjs --root . --port 5187` → `/pcd_label/`）：
1. 点大小滑块从左拖到右 → **三视口点云大小同步变化**（修复点）。
2. 选关节出手柄 → **手柄只在鼠标所在(active)视口出现**，切到别的视口拖拽，手柄尺寸不再被别视口缩放影响。
3. 三视口**各有边框**，active 视口边框高亮（青色）。
4. 预设只剩**单视口 / 三视口**两个按钮。
5. mesh **面向相机的面是亮面**，转视口/换 active 时亮面跟着转；mesh 比之前更白更亮；点云不受光。
6. 侧/正视口右上角有 **⊙ 锁定为重置视角**：拖歪视口后点 ⊙ → 按 R 回到记忆角度。
7. R 重置朝向；先改上轴/前轴再按 R → 朝向按新坐标轴正确摆正（坐标轴是前提，不失效）。
8. 右下角**快捷键提示面板**可点 ▾/▸ 最小化/展开。
9. mesh 透明度滑块仍工作（前序特性）。

label（`--port 5188` → `/label/`）：
10. 3D 模式 F 聚焦；2D 提示不聚焦；mesh 更白更亮 + 亮面朝相机；右下角提示面板可最小化；单视口行为零回归。

- [ ] **Step 3: 最终提交（如有笔记）**

```bash
git add -A
git commit -m "test(viewport): UX polish — suite green; manual checklist recorded" --allow-empty
```

---

## Self-Review

- **Spec #1 打光 + mesh 调亮** → Task 4（headLight 跟随 active 相机 + 颜色调亮），点云不受光（PointsMaterial 天然不吃光）。✓
- **Spec #2 手柄仅 active 视口** → Task 3（render 切 visible）+ Task 6 Step8（注册手柄对象）。连带修缩放。✓
- **Spec #3 点大小三视一致** → Task 5（sizeAttenuation off + 滑块改像素范围）。✓
- **Spec #4 视口边框 active 高亮** → Task 6 Step1/3（DOM 边框）。✓
- **Spec #5 可最小化快捷键提示面板** → Task 6（pcd）+ Task 7（label）。✓
- **Spec #6 预设砍到两个** → Task 6 Step1/2（删 vp-mainbig）。✓
- **Spec #7 锁定为重置视角 + R 以坐标轴为前提** → Task 1（relativeBearing/placeFromBearing 纯逻辑 + 单测）+ Task 2（captureAsReset/resetOrientation）+ Task 6 Step5/7（⊙ 角标 + R 接线）。✓
- **Placeholder 扫描**：每步给完整代码。✓
- **命名一致性**：`relativeBearing`/`placeFromBearing`/`captureAsReset`/`resetOrientation`/`setResetAxes`/`registerHandleObjects`/`sceneObjects`/`setLightFromCamera`/`setFollowCenter`/`visibleRects`/`activeViewport` 跨任务一致。✓

**两处实现取舍记录**：
1. Task 2 保留 `setOrientationAxes` 作 `setResetAxes` 别名，避免 TV-7 既有调用悬空；Task 6 不强制清理调用方（别名无害）。
2. Task 3 用 `_wasVisible` 缓存「意图可见性」逐区切换后还原，确保手柄仅 active 可见的同时不破坏 syncUI 的 attach/detach 与单视口行为。







