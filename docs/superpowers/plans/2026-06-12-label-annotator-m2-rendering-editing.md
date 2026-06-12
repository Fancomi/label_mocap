# SMPL Annotator — M2 Rendering Parity + Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the `label/` app to full viewer-rendering parity (mesh shading, joints, bones, frustum, ground grid, axes, near/far background planes, display toggles, angle/intrinsics/root readout panels) AND add the editing layer (add/delete annotation, root pos/rot handles, per-joint rotation gizmo + euler numeric/sliders, 2D bbox edit + project-from-mesh, beta sliders, Ctrl+Z undo).

**Architecture:** Rendering is centralized in `LabelScene` (extended) driven by an `applyAnnotation` path in `app.js` that reads `AnnotationStore` + `RotationState`. Editing tools are independent modules under `label/src/edit/` that mutate `RotationState`/`AnnotationStore` through their existing interfaces and never touch three.js geometry directly — the scene re-renders from store state on every change. A central `EditController` wires pointer events to whichever tool is active.

**Tech Stack:** Vanilla ES modules, three.js (vendored, with TransformControls addon), `node --test` for pure logic.

**Reference spec:** `docs/superpowers/specs/2026-06-12-label-mocap-annotator-design.md`
**Builds on:** `docs/superpowers/plans/2026-06-12-label-annotator-m1-foundation.md` (M1 complete)

---

## Conventions

- Run JS tests from repo root: `node --test label/tests/<file>.test.js`
- Serve for manual checks: `npm run serve:label` → `http://127.0.0.1:5175/label/`
- Sample data dir: `/Users/penghaotian/Downloads/20260609/test_data`
- Three.js geometry code (imports `three`) is browser-only → verified manually; pure math/state goes in tested modules.
- Commit after each task with the message shown in its final step. Do NOT amend.

## Existing interfaces M2 builds on (do not change without noting)

- `AnnotationStore`: `setFrame(i)`, `currentFrame()`, `frameCount()`, `currentImageId()`, `current()`, `hasData()`, `onChange(fn)`, `addTpose()`, `addFromPrevious()`, `deleteCurrent()`, `beginEdit()`, `applyFields(fields)`, `commitEdit()`, `undo()`, `document()`.
- `RotationState`: `fromAxisAngle({root_rota, body_pose})`, `getRootQuat()/setRootQuat(q)`, `getJointQuat(j)/setJointQuat(j,q)`, `getRootEuler()/setRootEuler(e)`, `getJointEuler(j)/setJointEuler(j,e)`, `toAxisAngle()`, `onChange(fn)`, `jointCount` (21).
- `rotations.js`: `axisAngleToQuat`, `quatToAxisAngle`, `eulerXYZToQuat`, `quatToEulerXYZ`, `quatToMat3`, `quatMultiply`, `quatNormalize`.
- `CameraModes`: `switchTo(mode)`, `snapTo(mode)`, `update()`, `set3DFollowTarget(vec3)`, `bgPlaneParams()`, `effectiveAspect()`, `mode`, `camera`, `controls`, `K`, `imageW`, `imageH`, `setIntrinsics({fx,fy,cx,cy})`, `resetIntrinsics()`.
- `LabelScene`: `setTopology(faces)`, `setCamera(cm)`, `updateMesh(verts, joints)`, `setBackgroundTexture(tex)`, `resize()`, `render()`.
- `forwardSmpl(model, {root_pos, root_rota, body_pose, betas})` → `{vertices, joints}`. SMPL 24 joints; body_pose is 21×3 axis-angle.

## File Structure (M2)

- Modify: `label/src/scene/scene.js` — add frustum, grid, axes, near/far bg planes, material shading, visibility flags, joint/bbox overlays
- Create: `label/src/scene/projection.js` — pure 3D→2D image projection + bbox-from-points (tested)
- Create: `label/src/edit/edit_controller.js` — active-tool state, pointer routing, selection
- Create: `label/src/edit/root_handle.js` — three TransformControls wrapper for root pos; rot via gizmo
- Create: `label/src/edit/pose_gizmo.js` — per-joint rotation gizmo (TransformControls rotate)
- Create: `label/src/edit/bbox_edit.js` — 2D bbox 4-corner drag + projectBboxFromMesh (logic tested)
- Create: `label/src/ui/panels.js` — euler numeric/sliders, beta sliders, intrinsics, root/angle readout wiring
- Modify: `label/index.html` — full sidebar markup + display toggles
- Modify: `label/src/app.js` — central applyAnnotation render path, wire panels + EditController
- Tests: `label/tests/projection.test.js`, `label/tests/bbox_edit.test.js`, `label/tests/edit_controller.test.js`

---

## Task 1: Projection module (3D→2D + bbox-from-points)

Pure math, no three.js — testable. Source coords: Y+ up, −Z depth; `u = fx·X/(−Z) + cx`, `v = fy·(−Y)/(−Z) + cy`. Mirrors `smpl_viewer/projection.py` and `smpl_web_viewer/src/viewer/camera_modes.js:projectSrc`.

**Files:**
- Create: `label/src/scene/projection.js`
- Test: `label/tests/projection.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectPoint, bboxFromPoints } from '../src/scene/projection.js';

const K = { fx: 1850, fy: 1850, cx: 960, cy: 540 };

test('projectPoint maps a point in front of the camera to pixels', () => {
  const [u, v] = projectPoint([0, 0, -4], K);
  assert.ok(Math.abs(u - 960) < 1e-6);
  assert.ok(Math.abs(v - 540) < 1e-6);
});

test('projectPoint flips Y (up) to image-down', () => {
  const [, v] = projectPoint([0, 1, -4], K); // +Y up → smaller v (higher in image)
  assert.ok(v < 540);
});

test('projectPoint throws for points at or behind the camera', () => {
  assert.throws(() => projectPoint([0, 0, 0], K), /behind camera/);
  assert.throws(() => projectPoint([0, 0, 1], K), /behind camera/);
});

test('bboxFromPoints returns [x, y, w, h] enclosing all projected verts', () => {
  // a flat array of two 3D points
  const verts = new Float32Array([-0.5, 0.5, -4, 0.5, -0.5, -4]);
  const bbox = bboxFromPoints(verts, K);
  const [x, y, w, h] = bbox;
  assert.ok(w > 0 && h > 0);
  // symmetric points around principal axis → box centered on cx,cy
  assert.ok(Math.abs((x + w / 2) - 960) < 1e-3);
  assert.ok(Math.abs((y + h / 2) - 540) < 1e-3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test label/tests/projection.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```javascript
// label/src/scene/projection.js
// Source coords: Y+ up, -Z depth. u = fx*X/(-Z)+cx, v = fy*(-Y)/(-Z)+cy.

export function projectPoint([x, y, z], { fx, fy, cx, cy }) {
  if (z >= 0) throw new Error('point behind camera (Z>=0) cannot be projected');
  return [fx * x / (-z) + cx, fy * (-y) / (-z) + cy];
}

// verts: flat Float32Array [x0,y0,z0, x1,y1,z1, ...]. Returns [x, y, w, h].
export function bboxFromPoints(verts, K) {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (let i = 0; i + 2 < verts.length; i += 3) {
    const z = verts[i + 2];
    if (z >= 0) continue; // skip points behind camera
    const [u, v] = projectPoint([verts[i], verts[i + 1], z], K);
    if (u < minU) minU = u;
    if (v < minV) minV = v;
    if (u > maxU) maxU = u;
    if (v > maxV) maxV = v;
  }
  if (!Number.isFinite(minU)) throw new Error('no projectable points');
  return [minU, minV, maxU - minU, maxV - minV];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test label/tests/projection.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add label/src/scene/projection.js label/tests/projection.test.js
git commit -m "feat(label): projection + bbox-from-points math"
```

---

## Task 2: Vendor TransformControls addon

The pose/root gizmos use three.js `TransformControls`. It is not yet vendored.

**Files:**
- Create: `smpl_web_viewer/public/vendor/TransformControls.js`
- Modify: `label/index.html` (importmap entry)

- [ ] **Step 1: Vendor the addon matching the installed three version**

Determine the three.js version of the vendored module:

```bash
grep -m1 "REVISION" smpl_web_viewer/public/vendor/three.module.js
```

Download the matching `TransformControls.js` addon (same revision `rNNN`) from the three.js distribution into `smpl_web_viewer/public/vendor/TransformControls.js`. It must import from the bare specifier `'three'` (the importmap resolves it). If your environment cannot fetch, copy it from a local `node_modules/three/examples/jsm/controls/TransformControls.js` of the same revision. Verify the file's top imports resolve to `'three'` only:

```bash
grep -n "from 'three'" smpl_web_viewer/public/vendor/TransformControls.js | head
node --check smpl_web_viewer/public/vendor/TransformControls.js
```

- [ ] **Step 2: Add the importmap entry**

In `label/index.html` importmap `imports`, add (keep existing entries, valid JSON):

```json
"three/addons/controls/TransformControls.js": "../smpl_web_viewer/public/vendor/TransformControls.js"
```

- [ ] **Step 3: Smoke-check it serves and parses in the browser context**

```bash
npm run serve:label >/tmp/s.log 2>&1 &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5175/smpl_web_viewer/public/vendor/TransformControls.js
pkill -f static_server.mjs
```
Expected: `200`.

- [ ] **Step 4: Commit**

```bash
git add smpl_web_viewer/public/vendor/TransformControls.js label/index.html
git commit -m "chore(vendor): add TransformControls addon for gizmo editing"
```

---

## Task 3: Scene rendering parity (frustum, grid, axes, near/far bg, shading, visibility)

Extend `LabelScene` to render everything the old `smpl_viewer` showed. Port the helpers from `smpl_viewer/viewer.js` but adapt to the LabelScene structure (no data-rotation; LabelScene owns the helpers, CameraModes owns the camera). Browser-only — verified manually in Task 9.

**Files:**
- Modify: `label/src/scene/scene.js`

Reference source in `smpl_viewer/viewer.js`: `makeFrustum` (lines 119-144), `buildGrid` (92-108), `ensureGridAxes` (110-117), `applyVisibility` (79-90), bg near/far planes (266-277), `layoutBg` (475-490). The old code applied a `dataRotCw` rotation to planes — OMIT all of that (labeler forbids rotation).

- [ ] **Step 1: Add helper geometry to `LabelScene`**

Add to the constructor (after the existing lights), initialize fields:
```javascript
    this._frustum = null;
    this._grid = null;
    this._axes = null;
    this._bgNear = null;   // 3D-mode near plane
    this._bgFar = null;    // far plane, visible in both modes
    this._bgTex = null;
    this._gridSize = 20;
    this._gridStep = 0.5;
    this._flags = { mesh: true, points: true, bones: true, grid: true, axes: false, bg: true };
```

Change the mesh material in `setTopology` to match the viewer (lit Lambert, white, double-sided — already close; keep `wireframe:false`). Keep joint spheres and bones as-is.

- [ ] **Step 2: Add the helper-build methods**

Add these methods to `LabelScene` (THREE is already imported):

```javascript
  // Camera frustum wireframe (3D mode only). meta: {K:{fx,fy}, image_w, image_h}
  buildFrustum(meta) {
    if (this._frustum) {
      this._scene.remove(this._frustum);
      this._frustum.geometry.dispose();
      this._frustum.material.dispose();
    }
    const fovY = 2 * Math.atan(meta.image_h / (2 * meta.K.fy));
    const aspect = meta.image_w / meta.image_h;
    const d = 2.0;
    const h = 2 * Math.tan(fovY / 2) * d;
    const w = h * aspect;
    const c = [
      new THREE.Vector3(w / 2, h / 2, -d), new THREE.Vector3(-w / 2, h / 2, -d),
      new THREE.Vector3(-w / 2, -h / 2, -d), new THREE.Vector3(w / 2, -h / 2, -d),
    ];
    const O = new THREE.Vector3();
    const segs = [O, c[0], O, c[1], O, c[2], O, c[3], c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]];
    const geom = new THREE.BufferGeometry().setFromPoints(segs);
    this._frustum = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: 0x66aaff }));
    this._frustum.frustumCulled = false;
    this._scene.add(this._frustum);
  }

  buildGrid() {
    if (this._grid) {
      this._scene.remove(this._grid);
      this._grid.geometry.dispose();
      this._grid.material.dispose();
    }
    const divisions = Math.max(2, Math.round(this._gridSize / this._gridStep));
    this._grid = new THREE.GridHelper(this._gridSize, divisions, 0x6695c8, 0x4a6080);
    this._grid.position.y = -1.0;
    this._grid.material.opacity = 0.85;
    this._grid.material.transparent = true;
    this._grid.material.depthWrite = false;
    this._scene.add(this._grid);
    if (!this._axes) {
      this._axes = new THREE.AxesHelper(0.5);
      this._scene.add(this._axes);
    }
  }

  setGrid(size, step) {
    if (Number.isFinite(size) && size > 0) this._gridSize = size;
    if (Number.isFinite(step) && step > 0) this._gridStep = step;
    this.buildGrid();
    this._applyVisibility();
  }

  setFlag(key, value) { this._flags[key] = value; this._applyVisibility(); }

  _applyVisibility() {
    const is3d = this._cam && this._cam.mode === '3d';
    if (this._mesh) this._mesh.visible = this._flags.mesh;
    if (this._jointsGroup) this._jointsGroup.visible = this._flags.points;
    if (this._bonesGroup) this._bonesGroup.visible = this._flags.bones;
    if (this._grid) this._grid.visible = this._flags.grid && is3d;
    if (this._axes) this._axes.visible = this._flags.axes && is3d;
    if (this._bgFar) this._bgFar.visible = this._flags.bg;
    if (this._bgNear) this._bgNear.visible = this._flags.bg && is3d;
    if (this._frustum) this._frustum.visible = is3d;
  }
```

- [ ] **Step 3: Replace single bg plane with near+far planes**

Replace the existing `_applyBgTexture` so it creates BOTH a near plane (z = −bgPlaneZ3D, 3D-only) and a far plane (z = −bgPlaneZ2D, both modes), each sized from `this._cam.bgPlaneParams()` (which returns `{near:{z,w,h}, far:{z,w,h}}`). Bind the texture to both. Set `_bgFar.renderOrder = -1`, `_bgNear.renderOrder = 0`:

```javascript
  _applyBgTexture(texture) {
    const p = this._cam.bgPlaneParams();
    if (!this._bgFar) {
      const mk = () => new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, side: THREE.DoubleSide }));
      this._bgFar = mk(); this._bgFar.renderOrder = -1; this._scene.add(this._bgFar);
      this._bgNear = mk(); this._bgNear.renderOrder = 0; this._scene.add(this._bgNear);
    }
    this._bgFar.geometry.dispose();
    this._bgFar.geometry = new THREE.PlaneGeometry(p.far.w, p.far.h);
    this._bgFar.position.set(0, 0, p.far.z);
    this._bgNear.geometry.dispose();
    this._bgNear.geometry = new THREE.PlaneGeometry(p.near.w, p.near.h);
    this._bgNear.position.set(0, 0, p.near.z);
    for (const plane of [this._bgFar, this._bgNear]) {
      plane.material.map = texture;
      plane.material.needsUpdate = true;
    }
    this._bgTex = texture;
    this._applyVisibility();
  }
```

- [ ] **Step 4: Re-layout bg + apply visibility on each render; call buildGrid/frustum on setTopology**

In `setTopology`, after building mesh/joints/bones, call `this.buildGrid();`. Add a public `prepareForSequence(meta)` method that calls `this.buildFrustum(meta)` and `this._applyVisibility()` — `app.js` calls it once per loaded sequence. In `render()`, after applying any pending texture, call `this._applyVisibility()` so mode changes (2D↔3D) immediately hide/show grid/axes/frustum/near-plane.

- [ ] **Step 5: Syntax check + manual smoke**

Run: `node --check label/src/scene/scene.js`
Expected: clean.

(Full visual verification happens in Task 9. Do not add a browser-dependent unit test.)

- [ ] **Step 6: Commit**

```bash
git add label/src/scene/scene.js
git commit -m "feat(label): scene rendering parity — frustum, grid, axes, near/far bg, visibility flags"
```

---

## Task 4: EditController (selection + active-tool state)

A small state machine: tracks the active tool (`none | root | pose | bbox`) and the selected joint index. Pure logic, no three.js — testable. The browser gizmo modules read its state; `app.js` drives it from UI buttons and 3D picking.

**Files:**
- Create: `label/src/edit/edit_controller.js`
- Test: `label/tests/edit_controller.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditController } from '../src/edit/edit_controller.js';

test('starts in none tool with no selection', () => {
  const c = new EditController();
  assert.equal(c.tool, 'none');
  assert.equal(c.selectedJoint, null);
});

test('setTool changes tool and notifies', () => {
  const c = new EditController();
  let fired = 0; c.onChange(() => { fired++; });
  c.setTool('pose');
  assert.equal(c.tool, 'pose');
  assert.ok(fired >= 1);
});

test('selectJoint records index and implies pose tool', () => {
  const c = new EditController();
  c.selectJoint(5);
  assert.equal(c.selectedJoint, 5);
  assert.equal(c.tool, 'pose');
});

test('selecting root clears joint selection', () => {
  const c = new EditController();
  c.selectJoint(3);
  c.setTool('root');
  assert.equal(c.selectedJoint, null);
});

test('readOnly mode blocks tool changes', () => {
  const c = new EditController({ readOnly: true });
  c.setTool('pose');
  assert.equal(c.tool, 'none');
  c.selectJoint(2);
  assert.equal(c.selectedJoint, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test label/tests/edit_controller.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```javascript
// label/src/edit/edit_controller.js
export class EditController {
  constructor({ readOnly = false } = {}) {
    this._tool = 'none';
    this._joint = null;
    this._readOnly = readOnly;
    this._listeners = new Set();
  }

  get tool() { return this._tool; }
  get selectedJoint() { return this._joint; }
  get readOnly() { return this._readOnly; }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _notify() { for (const fn of this._listeners) fn(); }

  setReadOnly(v) { this._readOnly = v; if (v) { this._tool = 'none'; this._joint = null; } this._notify(); }

  setTool(tool) {
    if (this._readOnly) return;
    this._tool = tool;
    if (tool !== 'pose') this._joint = null;
    this._notify();
  }

  selectJoint(index) {
    if (this._readOnly) return;
    this._joint = index;
    this._tool = 'pose';
    this._notify();
  }

  clearSelection() { this._joint = null; this._notify(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test label/tests/edit_controller.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add label/src/edit/edit_controller.js label/tests/edit_controller.test.js
git commit -m "feat(label): EditController selection + active-tool state"
```

---

## Task 5: bbox edit logic (corner drag + project-from-mesh)

Pure logic for converting drags into bbox `[x,y,w,h]` and computing a bbox from mesh verts via projection. The pointer-to-image-pixel mapping lives in `app.js` (browser); this module is the math.

**Files:**
- Create: `label/src/edit/bbox_edit.js`
- Test: `label/tests/bbox_edit.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resizeBboxByCorner, projectBboxFromMesh } from '../src/edit/bbox_edit.js';

test('dragging the top-left corner updates x,y,w,h keeping opposite corner fixed', () => {
  const bbox = [100, 100, 200, 200]; // corners: TL(100,100) BR(300,300)
  const out = resizeBboxByCorner(bbox, 'tl', [120, 130]);
  assert.deepEqual(out, [120, 130, 180, 170]); // BR stays at 300,300
});

test('dragging bottom-right corner updates only w,h', () => {
  const bbox = [100, 100, 200, 200];
  const out = resizeBboxByCorner(bbox, 'br', [350, 360]);
  assert.deepEqual(out, [100, 100, 250, 260]);
});

test('resize normalizes so width/height stay non-negative', () => {
  const bbox = [100, 100, 200, 200];
  const out = resizeBboxByCorner(bbox, 'br', [50, 50]); // dragged past TL
  const [x, y, w, h] = out;
  assert.ok(w >= 0 && h >= 0);
  assert.equal(x, 50); assert.equal(y, 50);
});

test('projectBboxFromMesh returns a bbox enclosing projected verts', () => {
  const K = { fx: 1850, fy: 1850, cx: 960, cy: 540 };
  const verts = new Float32Array([-0.5, 0.5, -4, 0.5, -0.5, -4]);
  const bbox = projectBboxFromMesh(verts, K);
  assert.equal(bbox.length, 4);
  assert.ok(bbox[2] > 0 && bbox[3] > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test label/tests/bbox_edit.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```javascript
// label/src/edit/bbox_edit.js
import { bboxFromPoints } from '../scene/projection.js';

// corner: 'tl' | 'tr' | 'bl' | 'br'. point: [px, py] in image pixels.
// Returns a normalized [x, y, w, h] with the opposite corner held fixed.
export function resizeBboxByCorner([x, y, w, h], corner, [px, py]) {
  let x0 = x;
  let y0 = y;
  let x1 = x + w;
  let y1 = y + h;
  if (corner === 'tl') { x0 = px; y0 = py; }
  else if (corner === 'tr') { x1 = px; y0 = py; }
  else if (corner === 'bl') { x0 = px; y1 = py; }
  else if (corner === 'br') { x1 = px; y1 = py; }
  const nx = Math.min(x0, x1);
  const ny = Math.min(y0, y1);
  return [nx, ny, Math.abs(x1 - x0), Math.abs(y1 - y0)];
}

// verts: flat Float32Array of posed mesh vertices in source coords.
export function projectBboxFromMesh(verts, K) {
  return bboxFromPoints(verts, K);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test label/tests/bbox_edit.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add label/src/edit/bbox_edit.js label/tests/bbox_edit.test.js
git commit -m "feat(label): bbox corner-resize + project-from-mesh logic"
```

---

## Task 6: Full sidebar markup + display toggles + edit panels (index.html)

Replace the minimal M1 sidebar with the full annotator UI. No JS logic here — just markup with stable ids that Task 7/8 wire up. Mirror the structure/styling of `smpl_viewer/viewer.html` (sidebar groups, `.g`, `.row`, `.kgrid`, `button.on`, number inputs, `.ro` readouts).

**Files:**
- Modify: `label/index.html`

- [ ] **Step 1: Replace the sidebar `<aside id="side">` content**

Keep the existing `#stage`/canvas/status, importmap (with the TransformControls entry from Task 2), and styles; ADD these style rules used by the panels (append inside `<style>`):

```css
    .g { display:flex; flex-direction:column; gap:4px; border-top:1px solid #2a2a2a; padding-top:8px; }
    .g > label { font-size:10px; color:#888; }
    .kgrid { display:grid; grid-template-columns:auto 1fr; gap:3px 6px; align-items:center; }
    .kgrid > label { font-size:10px; color:#999; text-align:right; }
    input[type=number] { background:#222; border:1px solid #444; color:#eee; padding:2px 4px; border-radius:3px; font:inherit; font-size:11px; width:100%; }
    .ro { background:#222; border:1px solid #333; color:#ffa; padding:2px 5px; border-radius:3px; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    select { padding:4px; background:#2a2a2a; border:1px solid #444; color:#eee; border-radius:3px; font:inherit; }
    #side h3 { font-size:11px; color:#7df; margin:0; }
```

Replace the `<aside id="side">…</aside>` block with:

```html
  <aside id="side">
    <h2 style="font-size:13px;color:#7df">SMPL 标注器</h2>
    <button id="btn-open">选择目录 / 文件</button>
    <input id="dir-input" type="file" webkitdirectory directory multiple hidden>

    <div class="g">
      <label>相机模式</label>
      <div class="row"><button id="btn-2d" class="on">2D 对齐</button><button id="btn-3d">3D 自由</button></div>
    </div>

    <div class="g">
      <label>播放</label>
      <div class="row"><button id="btn-prev">◀</button><button id="btn-play">▶ 播放</button><button id="btn-next">▶|</button></div>
      <input id="slider" type="range" min="0" max="0" value="0">
      <div id="frame-info">— / —</div>
      <div class="row" style="align-items:center"><span style="font-size:11px;color:#888">速度</span><input id="speed" type="range" min="1" max="60" value="24"><span id="speed-val" style="font-size:11px;color:#ffa;min-width:46px;text-align:right">24 fps</span></div>
    </div>

    <div class="g">
      <label>显示</label>
      <div class="row"><button id="t-mesh" class="on">网格</button><button id="t-points" class="on">关键点</button><button id="t-bones" class="on">骨骼</button></div>
      <div class="row"><button id="t-grid" class="on">底网</button><button id="t-axes">轴</button><button id="t-bg" class="on">底图</button><button id="t-bbox" class="on">框</button></div>
      <div class="row" style="align-items:center"><span style="font-size:10px;color:#888;width:30px">范围</span><input type="number" id="grid-size" value="20" step="1" min="1"><span style="font-size:10px;color:#888;width:30px">间隔</span><input type="number" id="grid-step" value="0.5" step="0.1" min="0.1"></div>
    </div>

    <div class="g">
      <label>标注 (本帧)</label>
      <div id="anno-state" class="ro">—</div>
      <div class="row"><button id="btn-add-t">+ T-pose</button><button id="btn-add-prev">+ 续上帧</button><button id="btn-del">删除</button></div>
      <div class="row"><button id="btn-undo">↶ 撤销 (Ctrl+Z)</button></div>
    </div>

    <div class="g">
      <label>编辑工具</label>
      <div class="row"><button id="tool-root">Root</button><button id="tool-pose">Pose</button><button id="tool-bbox">Bbox</button></div>
      <select id="joint-select"><option value="">选择关节…</option></select>
    </div>

    <div class="g">
      <label>旋转 (欧拉 XYZ, 度)</label>
      <div class="kgrid">
        <label>X</label><input type="number" id="eul-x" step="1">
        <label>Y</label><input type="number" id="eul-y" step="1">
        <label>Z</label><input type="number" id="eul-z" step="1">
      </div>
    </div>

    <div class="g">
      <label>Root 平移</label>
      <div class="kgrid">
        <label>x</label><input type="number" id="pos-x" step="0.01">
        <label>y</label><input type="number" id="pos-y" step="0.01">
        <label>z</label><input type="number" id="pos-z" step="0.01">
      </div>
    </div>

    <div class="g">
      <label>Bbox <button id="btn-bbox-auto" style="font-size:10px;padding:2px 5px;flex:0">从Mesh投影</button></label>
      <div id="bbox-ro" class="ro">—</div>
    </div>

    <div class="g">
      <label>Beta (体型)</label>
      <div id="beta-sliders"></div>
      <button id="btn-beta-reset" style="font-size:10px;padding:3px 5px">归零</button>
    </div>

    <div class="g">
      <label>内参 (实时)</label>
      <div class="kgrid">
        <label>fx</label><input type="number" id="k-fx" step="1">
        <label>fy</label><input type="number" id="k-fy" step="1">
        <label>cx</label><input type="number" id="k-cx" step="1">
        <label>cy</label><input type="number" id="k-cy" step="1">
      </div>
      <button id="btn-k-reset" style="font-size:10px;padding:3px 5px">重置内参</button>
    </div>

    <div class="g">
      <label>关节角度</label>
      <div id="angle-list" style="font-size:11px;line-height:1.5"></div>
    </div>

    <div class="g">
      <label>IO</label>
      <div class="row"><button id="btn-save">保存 JSON</button><button id="btn-reset">Reset</button></div>
    </div>
  </aside>
```

- [ ] **Step 2: Verify it serves**

```bash
npm run serve:label >/tmp/s.log 2>&1 &
sleep 2
curl -s http://127.0.0.1:5175/label/ | grep -c "beta-sliders"
pkill -f static_server.mjs
```
Expected: `1`.

- [ ] **Step 3: Commit**

```bash
git add label/index.html
git commit -m "feat(label): full annotator sidebar markup + display toggles"
```

---

## Task 7: Central render path + annotation state wiring (app.js)

Refactor `app.js` so a single `applyAnnotation()` function is the one place that reads store/rotation state and pushes to the scene. This is the backbone every editing tool re-triggers. Browser integration — verified manually (Task 11).

**Files:**
- Modify: `label/src/app.js`

- [ ] **Step 1: Introduce per-frame RotationState + central applyAnnotation**

Add module state: `let rotation = null; let editController = null;` Import `RotationState` from `./edit/rotation_state.js`, `EditController` from `./edit/edit_controller.js`.

Rewrite `showFrame(i)` so it:
1. `store.setFrame(i)`, update slider/frame-info.
2. If `store.hasData()`: build `rotation = RotationState.fromAxisAngle({root_rota, body_pose})` from `store.current()`, then call `applyAnnotation()`. Else `rotation = null` and clear the mesh (hide it via `scene.setFlag('mesh', false)` is wrong — instead skip updateMesh and set a `hasData` UI state). Update `#anno-state` text to `有数据`/`空帧`.
3. Load + bind the background texture (existing logic).

Add:
```javascript
function buildFrame() {
  const a = store.current();
  const { root_rota, body_pose } = rotation.toAxisAngle();
  return { root_pos: a.root_pos, root_rota, body_pose, betas: a.betas };
}

function applyAnnotation() {
  if (!rotation) return;
  const out = forwardSmpl(model, buildFrame());
  scene.updateMesh(out.vertices, out.joints);
  scene.setFollowFromJoints(out.joints); // see Task 8 (root-follow); no-op if absent
  panels.syncFromState();                // Task 8
}
```

3D follow: after `updateMesh`, call `cam.set3DFollowTarget(new THREE.Vector3(joints[0], joints[1], joints[2]))` so the orbit pivots on the pelvis (port from viewer.js:420). Put this in `applyAnnotation`.

- [ ] **Step 2: Call scene.prepareForSequence + buildFrustum on load**

In `openFiles`, after `scene.setTopology(model.faces)` and constructing `cam`, call `scene.prepareForSequence({ K: cam.K, image_w: cam.imageW, image_h: cam.imageH })`. Construct `editController = new EditController({ readOnly })` after the portrait gate.

- [ ] **Step 3: Wire add/delete/undo + display toggles + grid + camera-mode visibility**

```javascript
  $('btn-add-t').addEventListener('click', () => { if (!editController.readOnly) { store.addTpose(); showFrame(store.currentFrame()); } });
  $('btn-add-prev').addEventListener('click', () => { if (!editController.readOnly) { store.addFromPrevious(); showFrame(store.currentFrame()); } });
  $('btn-del').addEventListener('click', () => { if (!editController.readOnly) { store.deleteCurrent(); showFrame(store.currentFrame()); } });
  $('btn-undo').addEventListener('click', () => { store.undo(); showFrame(store.currentFrame()); });
  window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); store.undo(); showFrame(store.currentFrame()); } });

  const toggle = (id, key) => $(id).addEventListener('click', () => {
    const on = !$(id).classList.contains('on');
    $(id).classList.toggle('on', on);
    scene.setFlag(key, on);
  });
  toggle('t-mesh', 'mesh'); toggle('t-points', 'points'); toggle('t-bones', 'bones');
  toggle('t-grid', 'grid'); toggle('t-axes', 'axes'); toggle('t-bg', 'bg');
  $('grid-size').addEventListener('input', () => scene.setGrid(+$('grid-size').value, +$('grid-step').value));
  $('grid-step').addEventListener('input', () => scene.setGrid(+$('grid-size').value, +$('grid-step').value));
```

Make the 2D/3D buttons also call `scene.setFlag` refresh by invoking `scene.render()` naturally (the render loop calls `_applyVisibility`).

- [ ] **Step 4: Syntax check + full logic suite**

Run: `node --check label/src/app.js && node --test label/tests/*.test.js`
Expected: app.js parses; all pure-logic tests pass.

- [ ] **Step 5: Commit**

```bash
git add label/src/app.js
git commit -m "feat(label): central applyAnnotation render path + add/delete/undo/toggles wiring"
```

---

## Task 8: Editing panels + gizmos (panels.js, root_handle.js, pose_gizmo.js)

The browser editing layer: euler numeric/sliders, beta sliders, intrinsics, angle readout (panels.js); root translate + rotate gizmo (root_handle.js); per-joint rotate gizmo (pose_gizmo.js). All mutate `RotationState`/`AnnotationStore` through existing interfaces; the scene re-renders via `applyAnnotation`. Browser integration — verified manually (Task 11). This is the largest task; if it grows unwieldy, report DONE_WITH_CONCERNS and the controller will split it.

**Files:**
- Create: `label/src/ui/panels.js`
- Create: `label/src/edit/root_handle.js`
- Create: `label/src/edit/pose_gizmo.js`
- Modify: `label/src/app.js` (wire them)
- Modify: `label/src/scene/scene.js` (expose `setFollowFromJoints`, gizmo attach points, joint world positions)

- [ ] **Step 1: panels.js — readouts + numeric editors**

Create a `Panels` class constructed with `{ getRotation, getStore, getEditController, onEdit }` callbacks (so it never imports app singletons). Responsibilities:
- `populateJointSelect()` — fill `#joint-select` with the 21 body joints + a `root` entry (use SMPL joint names; a hardcoded name array of length 22 is fine — index 0 = root/pelvis).
- `syncFromState()` — refresh euler XYZ inputs (degrees) from the selected joint/root via `rotation.getJointEuler/ getRootEuler` (convert rad→deg), refresh `#pos-x/y/z` from `store.current().root_pos`, `#bbox-ro` from `store.current().bbox`, `#k-fx..` from cam intrinsics, beta sliders from `store.current().betas`, and the angle list (port `renderAngles` from viewer.js:492-505 using the live joints — accept joints array via callback).
- Euler inputs `input` handler: read XYZ (deg→rad), wrap as one edit transaction: `store.beginEdit(); rotation.setJointEuler(j, e) | setRootEuler(e); onEdit(); store.applyFields(rotation.toAxisAngle()); store.commitEdit();` — actually commit on `change` (blur), apply live on `input`. Simpler: on `input` call `rotation.setJointEuler` + `onEdit()` (re-render), and bracket a transaction with `beginEdit` on focus / `commitEdit` on blur so one editing session = one undo unit.
- Beta sliders: build 10 range inputs (−5..5 step 0.1) into `#beta-sliders`; on input, `store.beginEdit()`/`applyFields({betas})`/`commitEdit()` and `onEdit()`. `#btn-beta-reset` zeros them.
- Intrinsics inputs: on input call `cam.setIntrinsics(...)` (pass cam via callback) then `onEdit()` to re-layout bg; `#btn-k-reset` → `cam.resetIntrinsics()`.
- `#pos-x/y/z`: on input, `store.applyFields({root_pos:[x,y,z]})` within a transaction + `onEdit()`.

- [ ] **Step 2: root_handle.js + pose_gizmo.js — TransformControls wrappers**

Both import `TransformControls` from `'three/addons/controls/TransformControls.js'` and `THREE` from `'three'`. Each wraps a TransformControls attached to the scene/camera/canvas:
- `RootHandle`: a translate gizmo attached to a proxy Object3D placed at the root position. On drag, write the proxy position back via `store.applyFields({root_pos})` (transaction begin on `mouseDown`, commit on `mouseUp`), call `onEdit()`. A separate rotate mode rotates a proxy whose quaternion maps to `rotation.setRootQuat`.
- `PoseGizmo`: a rotate gizmo attached to a proxy Object3D at the selected joint's world position, initialized to the joint's current world orientation. On drag, convert the proxy's local delta quaternion to the joint local frame and `rotation.setJointQuat(j, q)`; transaction begin/commit on down/up; `onEdit()`.
- IMPORTANT: while a TransformControls drag is active, disable `cam.controls` (OrbitControls) — listen to TransformControls `dragging-changed` and set `cam.controls.enabled = !event.value`.
- The gizmo must be hidden/detached when its tool is not active (driven by EditController). Both expose `attach(target)`, `detach()`, `setMode(...)`, `update()`.

Because computing a per-joint local-frame delta from a world gizmo is subtle, implement the simplest correct mapping: store the joint's parent-relative orientation; on gizmo change read the gizmo's world quaternion, convert to the joint local frame using the kinematic chain orientation from the last `forwardSmpl` (the scene can expose per-joint world quaternions). If this proves too involved for one pass, implement euler/numeric joint editing fully (Step 1) and a SIMPLER gizmo that edits the joint quaternion directly in camera/world space as a first approximation, and report DONE_WITH_CONCERNS noting the local-frame fidelity gap for a follow-up.

- [ ] **Step 3: scene.js support for gizmos**

Add to `LabelScene`: `jointWorldPosition(j)` returning the Vector3 of joint j (from the last uploaded joints buffer); `addGizmo(obj)/removeGizmo(obj)` to add TransformControls helper to the scene; `setFollowFromJoints(joints)` storing pelvis for camera follow (or leave the follow in app.js). Keep additions minimal.

- [ ] **Step 4: Wire in app.js**

Instantiate `panels = new Panels({...callbacks})`, `rootHandle`, `poseGizmo` after scene/cam exist. Subscribe: `editController.onChange(() => { /* attach/detach gizmos per tool+joint, refresh panels */ })`. Tool buttons (`#tool-root/#tool-pose/#tool-bbox`) call `editController.setTool(...)`. `#joint-select` change → `editController.selectJoint(idx)`. `applyAnnotation()` calls `panels.syncFromState()` and updates gizmo target positions. Bbox tool + `#btn-bbox-auto`: on click compute `projectBboxFromMesh(lastVertices, cam.K)` and `store.applyFields({bbox})` in a transaction; corner-drag handled by pointer events on the canvas mapping screen→image pixels (use cam intrinsics + the same projection the bg plane uses).

- [ ] **Step 5: Syntax + logic suite green**

Run: `node --check label/src/ui/panels.js label/src/edit/root_handle.js label/src/edit/pose_gizmo.js label/src/app.js && node --test label/tests/*.test.js`
Expected: all parse; pure-logic tests pass.

- [ ] **Step 6: Commit**

```bash
git add label/src/ui/panels.js label/src/edit/root_handle.js label/src/edit/pose_gizmo.js label/src/app.js label/src/scene/scene.js
git commit -m "feat(label): editing panels + root/pose gizmos + beta/intrinsics/angle wiring"
```

---

## Task 9: Derived fields — keypoints reprojection + occlusion

On save (and optionally live), recompute `keypoints` (24 SMPL joints → first 24 slots, rest 0) and `occlution_joint` (joint visibility). Keypoint reprojection is pure math (tested). Occlusion uses a WebGL depth read (browser); provide a pure fallback + the browser path.

**Files:**
- Create: `label/src/edit/derived.js`
- Test: `label/tests/derived.test.js`

- [ ] **Step 1: Write the failing test (keypoints reprojection)**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reprojectKeypoints } from '../src/edit/derived.js';

const K = { fx: 1850, fy: 1850, cx: 960, cy: 540 };

test('reprojectKeypoints writes first 24 joints (x,y,conf=2), rest zero', () => {
  const joints = new Float32Array(24 * 3);
  for (let j = 0; j < 24; j++) { joints[j * 3] = 0; joints[j * 3 + 1] = 0; joints[j * 3 + 2] = -4; }
  const kps = reprojectKeypoints(joints, K, 52);
  assert.equal(kps.length, 52 * 3);
  assert.ok(Math.abs(kps[0] - 960) < 1e-6);
  assert.ok(Math.abs(kps[1] - 540) < 1e-6);
  assert.equal(kps[2], 2);
  assert.equal(kps[24 * 3], 0);
  assert.equal(kps[24 * 3 + 2], 0);
});

test('reprojectKeypoints marks behind-camera joints conf 0', () => {
  const joints = new Float32Array(24 * 3);
  joints[2] = 1; // joint 0 has z=+1 (behind)
  const kps = reprojectKeypoints(joints, K, 52);
  assert.equal(kps[2], 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test label/tests/derived.test.js`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```javascript
// label/src/edit/derived.js
import { projectPoint } from '../scene/projection.js';

// joints: flat Float32Array (24*3) in source coords. Returns Array(slots*3).
// First 24 slots get projected (x, y, conf=2); behind-camera joints conf 0; rest 0.
export function reprojectKeypoints(joints, K, slots = 52) {
  const out = new Array(slots * 3).fill(0);
  const n = Math.min(24, Math.floor(joints.length / 3));
  for (let j = 0; j < n; j++) {
    const z = joints[j * 3 + 2];
    if (z >= 0) { out[j * 3] = 0; out[j * 3 + 1] = 0; out[j * 3 + 2] = 0; continue; }
    const [u, v] = projectPoint([joints[j * 3], joints[j * 3 + 1], z], K);
    out[j * 3] = u; out[j * 3 + 1] = v; out[j * 3 + 2] = 2;
  }
  return out;
}

// Occlusion via depth buffer: sampleDepth(u,v) returns nearest mesh depth at pixel
// (same units, positive in front of camera) or null if no mesh covers that pixel.
// 1 = occluded. eps guards self-surface depth.
export function occlusionFromDepth(joints, K, sampleDepth, slots = 52, eps = 0.02) {
  const out = new Array(slots).fill(0);
  const n = Math.min(24, Math.floor(joints.length / 3));
  for (let j = 0; j < n; j++) {
    const z = joints[j * 3 + 2];
    if (z >= 0) { out[j] = 0; continue; }
    const [u, v] = projectPoint([joints[j * 3], joints[j * 3 + 1], z], K);
    const meshDepth = sampleDepth(u, v);
    const jointDepth = -z;
    out[j] = (meshDepth !== null && meshDepth < jointDepth - eps) ? 1 : 0;
  }
  return out;
}
```

- [ ] **Step 4: Add an occlusion test**

Append to `label/tests/derived.test.js`:

```javascript
import { occlusionFromDepth } from '../src/edit/derived.js';

test('occlusionFromDepth flags a joint behind nearer mesh', () => {
  const joints = new Float32Array(24 * 3);
  for (let j = 0; j < 24; j++) joints[j * 3 + 2] = -4;
  const occ = occlusionFromDepth(joints, K, () => 2.0, 52);
  assert.equal(occ[0], 1);
  const occ2 = occlusionFromDepth(joints, K, () => 6.0, 52);
  assert.equal(occ2[0], 0);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test label/tests/derived.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add label/src/edit/derived.js label/tests/derived.test.js
git commit -m "feat(label): keypoint reprojection + depth-based occlusion logic"
```

---

## Task 10: Save + Reset IO

Save serializes the edited document — recomputing keypoints/occlusion for edited frames — and downloads a new `player_0.json` (never overwrites). Reset reloads from the on-disk file.

**Files:**
- Modify: `label/src/app.js` (reuses `CocoDocument.serialize()`, `derived.js`)

- [ ] **Step 1: Save handler**

In `app.js`, `#btn-save` click:
1. For each annotation in `store.document()`, compute posed joints via `forwardSmpl`, then `reprojectKeypoints(joints, cam.K)`; write with `store.document().setAnnotation(imageId, { keypoints })`. Occlusion in-browser: render mesh depth offscreen and sample per joint with `occlusionFromDepth`; if a full depth pipeline is too large for one pass, leave `occlution_joint` unchanged and report DONE_WITH_CONCERNS (keypoints are the must-have).
2. `const json = JSON.stringify(store.document().serialize(), null, 2);`
3. Download:
```javascript
const blob = new Blob([json], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url; a.download = 'player_0.json'; a.click();
URL.revokeObjectURL(url);
```

- [ ] **Step 2: Reset handler**

Keep a module ref `let loadedJsonFile = null;` set in `openFiles`. `#btn-reset` click: re-read that File, rebuild `CocoDocument` + `AnnotationStore`, clear undo, `showFrame(store.currentFrame())`. If no json was loaded, Reset just re-shows the current frame. Keep the image File map.

- [ ] **Step 3: Syntax + logic suite**

Run: `node --check label/src/app.js && node --test label/tests/*.test.js`
Expected: parse OK; all pure tests pass.

- [ ] **Step 4: Commit**

```bash
git add label/src/app.js
git commit -m "feat(label): Save (download json + derived fields) and Reset (reload from disk)"
```

---

## Task 11: Manual verification (rendering parity + editing)

**Files:** none.

- [ ] **Step 1: Serve + load** `npm run serve:label` → `http://127.0.0.1:5175/label/` → load `/Users/penghaotian/Downloads/20260609/test_data`.

- [ ] **Step 2: Rendering parity** — confirm shaded mesh, 24 joints, colored bones, frustum (3D only), grid+axes (3D only), bg plane in 2D and near/far in 3D, and every display toggle (网格/关键点/骨骼/底网/轴/底图/框) works. 2D↔3D shows grid/axes/frustum/near only in 3D.

- [ ] **Step 3: Editing** — joint rotation gizmo + euler inputs; root translate gizmo + pos inputs; beta sliders; bbox 4-corner drag + 从Mesh投影; add T-pose/续上帧/删除; Ctrl+Z reverts one drag to its start; intrinsics edit + reset.

- [ ] **Step 4: IO** — 保存 downloads json; reopening confirms edited bbox/root/pose/betas persisted, keypoints reprojected, untouched fields preserved; Reset reloads disk values.

- [ ] **Step 5: Portrait gate** — portrait sequence disables editing, viewer still works.

- [ ] **Step 6: Record pass/fail; fix regressions before final review.**

---

## Out of scope (future)

- IK drag-to-pose (spec v2).
- Multi-person (load multiple jsons / scene management).
- "Frame bbox then call API to solve pose" workflow.
- Video background beyond HTML5 `<video>` seeking.

## Self-review checklist (run after writing, fix inline)

- Every spec rendering element (mesh/joints/bones/frustum/grid/axes/bg/panels) has a task.
- Every spec edit feature (add/del, root pos+rot, pose gizmo+euler, bbox edit+project, beta, undo, save, reset, derived keypoints/occlusion) has a task.
- Method names match M1 interfaces (currentFrame, applyFields/commitEdit, setFlag, bgPlaneParams, etc.).
- No placeholders; each code step shows real code.





