# SMPL Annotator — M3 UI Overhaul + Pose-Gizmo Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the annotator understandable to a first-time user and fix the pose-gizmo coordinate bug. Three-pane layout (left read-only info │ center 3D viewport │ right edit panel with mutually-exclusive tabs Pose/Root/Bbox/Beta), canvas joint-picking + anatomical joint-button grid (no dropdown), state-driven semantic add/delete, bbox confined to the Bbox tab, and a correct local-frame pose gizmo driven by per-joint world rotation newly exposed from `forwardSmpl`.

**Architecture:** A single `UIController` owns the active edit-mode (one tab at a time) and selection, replacing the scattered tool wiring in `app.js`. Only the active tab's canvas interaction is live; all others are inert. `forwardSmpl` gains an optional per-joint world-rotation output so the pose gizmo can map a world-space drag back into a joint's local quaternion (`q_local = Wparent⁻¹ · q_gizmo_world`). Read-only readouts (frame, mode, joint angles, annotation status) move to a left panel; editing controls live in the right tabbed panel.

**Tech Stack:** Vanilla ES modules, three.js (vendored, TransformControls), `node --test` for pure logic.

**Reference spec:** `docs/superpowers/specs/2026-06-12-label-mocap-annotator-design.md`
**Builds on:** M1 + M2 (complete). **Root-cause memo:** pose gizmo wrote a world quaternion straight into the joint local slot; parent world rotation (e.g. 86° at the left elbow) misaligns the drag axes → "jump". Verified by simulation.

---

## Conventions

- `node --test label/tests/<file>.test.js` from repo root. Serve: `npm run serve:label` → `http://127.0.0.1:5175/label/`. Sample: `/Users/penghaotian/Downloads/20260609/test_data`.
- three.js code is browser-only → `node --check` + manual verify. Pure math/state → unit-tested.
- Commit per task with the shown message. Do NOT amend.

## Existing interfaces (unchanged unless a task says so)

- `forwardSmpl(model, frame)` → `{vertices, joints}`. Task 1 adds an opt-in `{worldRot}`.
- `RotationState`: `getRootQuat/setRootQuat`, `getJointQuat(j)/setJointQuat(j,q)`, `getRootEuler/setRootEuler`, `getJointEuler(j)/setJointEuler(j,e)`, `toAxisAngle`, `jointCount` (21).
- `rotations.js`: `quatMultiply`, `quatNormalize`, `quatToMat3`, `axisAngleToQuat`, `quatToAxisAngle`, plus Task 2 adds `mat3ToQuat`, `quatConjugate`.
- `AnnotationStore`: `current`, `hasData`, `beginEdit/applyFields/commitEdit`, `addTpose`, `addFromPrevious`, `deleteCurrent`, `undo`, `currentFrame`, `frameCount`, `document`.
- `EditController` (M2): will be SUPERSEDED by `UIController` (Task 5). Keep the file but `app.js` switches to UIController.
- `LabelScene`: `updateMesh(verts, joints)`, `jointWorldPosition(j)`, `threeScene()`, `setFlag`, plus Task 6 adds joint-picking support (raycast against joint spheres).
- `CameraModes`: `mode`, `camera`, `controls`.

## File structure (M3)

- Modify: `smpl_core/lbs.js` — optional per-joint world-rotation output
- Modify: `smpl_core/rotations.js` — add `mat3ToQuat`, `quatConjugate`
- Create: `label/src/edit/gizmo_frame.js` — pure world↔local quaternion mapping (tested)
- Create: `label/src/ui/ui_controller.js` — active-tab + selection state machine (tested)
- Create: `label/src/ui/joint_picker.js` — raycast canvas→joint index (thin three wrapper)
- Modify: `label/src/edit/pose_gizmo.js` — use correct local-frame mapping
- Modify: `label/index.html` — three-pane layout, left read-only panel, right tabbed edit panel, joint-button grid
- Modify: `label/src/ui/panels.js` — split read-only readouts (left) vs per-tab editors (right)
- Modify: `label/src/app.js` — wire UIController, tabs, joint picking, single-active-interaction
- Tests: `label/tests/gizmo_frame.test.js`, `label/tests/ui_controller.test.js`, `label/tests/lbs_worldrot.test.js`

---

## Task 1: Expose per-joint world rotation from `forwardSmpl`

The pose gizmo needs each joint's WORLD rotation (3×3) to map a world-space drag into the joint local frame. Add an opt-in output so existing callers are unaffected.

**Files:**
- Modify: `smpl_core/lbs.js`
- Test: `label/tests/lbs_worldrot.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadModelFromFiles } from '../../smpl_core/smpl_model.js';
import { forwardSmpl } from '../../smpl_core/lbs.js';

const model = await loadModelFromFiles(
  new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url),
  async (u) => new Uint8Array(await readFile(u)));

function frame(overrides = {}) {
  return { root_pos: [0, 0, -4], root_rota: [0, 0, 0], body_pose: Array(63).fill(0), betas: Array(10).fill(0), ...overrides };
}

test('forwardSmpl without options omits worldRot (back-compat)', () => {
  const out = forwardSmpl(model, frame());
  assert.equal(out.worldRot, undefined);
  assert.equal(out.joints.length, 24 * 3);
});

test('forwardSmpl with {worldRot:true} returns 24 mat3 (length 24*9)', () => {
  const out = forwardSmpl(model, frame(), { worldRot: true });
  assert.equal(out.worldRot.length, 24 * 9);
  // rest pose (all-zero rotations) → every joint world rotation is identity
  for (let j = 0; j < 24; j++) {
    const m = out.worldRot.slice(j * 9, j * 9 + 9);
    assert.ok(Math.abs(m[0] - 1) < 1e-5 && Math.abs(m[4] - 1) < 1e-5 && Math.abs(m[8] - 1) < 1e-5);
  }
});

test('a single root rotation propagates to all joints world rotation', () => {
  const out = forwardSmpl(model, frame({ root_rota: [0, Math.PI / 2, 0] }), { worldRot: true });
  // root (joint 0) world rot row0 should be ~[0,0,1] for +90° about Y (col-major check via element)
  const m0 = out.worldRot.slice(0, 9);
  assert.ok(Math.abs(m0[0]) < 1e-5); // cos(90)=0 on diagonal
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test label/tests/lbs_worldrot.test.js`
Expected: FAIL — `worldRot` is undefined even with the option.

- [ ] **Step 3: Implement the opt-in output**

In `smpl_core/lbs.js`, change the signature to `export function forwardSmpl(model, frame, options = {})`. The function already computes `transforms[j]` (a mat4 world transform per joint) in the kinematic loop. After the loop, if `options.worldRot`, extract the upper-left 3×3 rotation from each `transforms[j]` (a 4×4 row-major matrix: indices 0,1,2 / 4,5,6 / 8,9,10) into a `Float32Array(jointsN*9)` laid out row-major per joint, and include it as `worldRot` in the returned object. Do not change the existing `vertices`/`joints` outputs.

Concretely, before `return { vertices: outVerts, joints: outJoints };`:
```javascript
  let worldRot;
  if (options.worldRot) {
    worldRot = new Float32Array(jointsN * 9);
    for (let j = 0; j < jointsN; j++) {
      const T = transforms[j];
      const o = j * 9;
      worldRot[o + 0] = T[0]; worldRot[o + 1] = T[1]; worldRot[o + 2] = T[2];
      worldRot[o + 3] = T[4]; worldRot[o + 4] = T[5]; worldRot[o + 5] = T[6];
      worldRot[o + 6] = T[8]; worldRot[o + 7] = T[9]; worldRot[o + 8] = T[10];
    }
  }
  return options.worldRot ? { vertices: outVerts, joints: outJoints, worldRot } : { vertices: outVerts, joints: outJoints };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test label/tests/lbs_worldrot.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Confirm no regression in existing SMPL tests**

Run: `npm test`
Expected: PASS — unchanged counts (existing callers pass no options).

- [ ] **Step 6: Commit**

```bash
git add smpl_core/lbs.js label/tests/lbs_worldrot.test.js
git commit -m "feat(smpl_core): optional per-joint world rotation output from forwardSmpl"
```

---

## Task 2: rotations helpers — `mat3ToQuat`, `quatConjugate`

The gizmo frame mapping needs to convert the parent world rotation matrix to a quaternion and invert a quaternion.

**Files:**
- Modify: `smpl_core/rotations.js`
- Test: `label/tests/rotations.test.js` (append)

- [ ] **Step 1: Append the failing tests**

Add to `label/tests/rotations.test.js`:

```javascript
import { mat3ToQuat, quatConjugate } from '../../smpl_core/rotations.js';

test('mat3ToQuat inverts quatToMat3 round-trip', () => {
  const q = quatNormalize([0.2, -0.5, 0.3, 0.78]);
  const m = quatToMat3(q);
  const q2 = mat3ToQuat(m);
  // quaternion or its negation both valid; compare via dot magnitude ~1
  const dot = Math.abs(q[0]*q2[0] + q[1]*q2[1] + q[2]*q2[2] + q[3]*q2[3]);
  assert.ok(Math.abs(dot - 1) < 1e-5, `dot ${dot}`);
});

test('quatConjugate of a unit quat is its inverse (q * q* = identity)', () => {
  const q = quatNormalize([0.2, -0.5, 0.3, 0.78]);
  const qc = quatConjugate(q);
  const p = quatMultiply(q, qc);
  assert.ok(Math.abs(p[0]) < 1e-6 && Math.abs(p[1]) < 1e-6 && Math.abs(p[2]) < 1e-6);
  assert.ok(Math.abs(p[3] - 1) < 1e-6);
});
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `node --test label/tests/rotations.test.js`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Append to `smpl_core/rotations.js`:

```javascript
// Quaternion conjugate (= inverse for unit quaternions).
export function quatConjugate([x, y, z, w]) {
  return [-x, -y, -z, w];
}

// Rotation matrix (row-major length-9) → quaternion [x,y,z,w].
export function mat3ToQuat(m) {
  const t = m[0] + m[4] + m[8];
  let x; let y; let z; let w;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    w = 0.25 * s; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}
```

- [ ] **Step 4: Run, confirm PASS**

Run: `node --test label/tests/rotations.test.js`
Expected: PASS (7 tests: 5 original + 2 new).

- [ ] **Step 5: Commit**

```bash
git add smpl_core/rotations.js label/tests/rotations.test.js
git commit -m "feat(smpl_core): add mat3ToQuat and quatConjugate"
```

---

## Task 3: Pure gizmo frame mapping (`gizmo_frame.js`)

The math that fixes the jump: given a joint's parent world rotation and the gizmo's world quaternion, compute the joint's new LOCAL quaternion. Pure + tested, so the fix is verified independent of three.js.

**Files:**
- Create: `label/src/edit/gizmo_frame.js`
- Test: `label/tests/gizmo_frame.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localFromWorldGizmo, worldGizmoFromLocal } from '../src/edit/gizmo_frame.js';
import { axisAngleToQuat, quatMultiply, quatToMat3, mat3ToQuat, quatNormalize } from '../../smpl_core/rotations.js';

const close = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const quatClose = (a, b) => { const d = Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]); close(d, 1); };

test('round-trip: worldGizmoFromLocal then localFromWorldGizmo recovers the local quat', () => {
  const qParentWorld = axisAngleToQuat([0.3, -1.0, 0.5]); // arbitrary parent world rot
  const qLocal = axisAngleToQuat([0.2, 0.1, -0.4]);
  const qWorld = worldGizmoFromLocal(qParentWorld, qLocal);
  const back = localFromWorldGizmo(qParentWorld, qWorld);
  quatClose(back, qLocal);
});

test('with identity parent, gizmo world quat equals local quat', () => {
  const qLocal = axisAngleToQuat([0.5, 0, 0]);
  const qWorld = worldGizmoFromLocal([0, 0, 0, 1], qLocal);
  quatClose(qWorld, qLocal);
  quatClose(localFromWorldGizmo([0, 0, 0, 1], qWorld), qLocal);
});

test('a world-space delta about a parent-rotated joint maps to the correct local change', () => {
  // parent rotated 90° about Z; joint currently identity-local.
  const qParent = axisAngleToQuat([0, 0, Math.PI / 2]);
  const qLocal0 = [0, 0, 0, 1];
  const qWorld0 = worldGizmoFromLocal(qParent, qLocal0); // == qParent
  // user applies a world delta of +30° about world X on top of the gizmo's current world orientation
  const dWorld = axisAngleToQuat([Math.PI / 6, 0, 0]);
  const qWorldNew = quatMultiply(dWorld, qWorld0);
  const qLocalNew = localFromWorldGizmo(qParent, qWorldNew);
  // sanity: feeding qLocalNew back through forward composition reproduces qWorldNew
  quatClose(worldGizmoFromLocal(qParent, qLocalNew), qWorldNew);
});
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `node --test label/tests/gizmo_frame.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```javascript
// label/src/edit/gizmo_frame.js
// Map between a joint's LOCAL quaternion and the WORLD quaternion a gizmo shows.
// SMPL: a joint's world rotation = Wparent · Rlocal. So:
//   gizmo world quat  = qParentWorld * qLocal
//   qLocal            = qParentWorld⁻¹ * gizmo world quat
import { quatMultiply, quatConjugate, quatNormalize } from '../../../smpl_core/rotations.js';

export function worldGizmoFromLocal(qParentWorld, qLocal) {
  return quatNormalize(quatMultiply(qParentWorld, qLocal));
}

export function localFromWorldGizmo(qParentWorld, qWorld) {
  return quatNormalize(quatMultiply(quatConjugate(qParentWorld), qWorld));
}
```

- [ ] **Step 4: Run, confirm PASS**

Run: `node --test label/tests/gizmo_frame.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add label/src/edit/gizmo_frame.js label/tests/gizmo_frame.test.js
git commit -m "feat(label): pure world<->local gizmo frame mapping"
```

---

## Task 4: UIController — single-active edit mode + selection (pure, tested)

Replaces the M2 EditController. Exactly one edit mode is active at a time (`pose | root | bbox | beta`), plus a selected joint for pose. Switching modes clears interactions that don't belong. Read-only-aware.

**Files:**
- Create: `label/src/ui/ui_controller.js`
- Test: `label/tests/ui_controller.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UIController } from '../src/ui/ui_controller.js';

test('defaults to pose mode, no joint selected', () => {
  const c = new UIController();
  assert.equal(c.mode, 'pose');
  assert.equal(c.selectedJoint, null);
});

test('setMode switches the single active mode and notifies', () => {
  const c = new UIController();
  let n = 0; c.onChange(() => { n++; });
  c.setMode('bbox');
  assert.equal(c.mode, 'bbox');
  assert.ok(n >= 1);
});

test('switching away from pose clears the joint selection', () => {
  const c = new UIController();
  c.selectJoint(4);
  assert.equal(c.mode, 'pose');
  assert.equal(c.selectedJoint, 4);
  c.setMode('beta');
  assert.equal(c.selectedJoint, null);
});

test('selectJoint forces pose mode', () => {
  const c = new UIController();
  c.setMode('root');
  c.selectJoint(7);
  assert.equal(c.mode, 'pose');
  assert.equal(c.selectedJoint, 7);
});

test('only the active mode reports its interaction live', () => {
  const c = new UIController();
  c.setMode('bbox');
  assert.equal(c.isInteractionActive('bbox'), true);
  assert.equal(c.isInteractionActive('pose'), false);
  assert.equal(c.isInteractionActive('root'), false);
});

test('readOnly forces a read-only mode and blocks edits', () => {
  const c = new UIController({ readOnly: true });
  c.setMode('pose');
  assert.equal(c.mode, 'view');
  c.selectJoint(2);
  assert.equal(c.selectedJoint, null);
  assert.equal(c.isInteractionActive('pose'), false);
});
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `node --test label/tests/ui_controller.test.js`

- [ ] **Step 3: Implement**

```javascript
// label/src/ui/ui_controller.js
// One edit mode active at a time. Modes: 'pose' | 'root' | 'bbox' | 'beta'.
// readOnly collapses to 'view' (no interaction, no selection).
const MODES = ['pose', 'root', 'bbox', 'beta'];

export class UIController {
  constructor({ readOnly = false } = {}) {
    this._readOnly = readOnly;
    this._mode = readOnly ? 'view' : 'pose';
    this._joint = null;
    this._listeners = new Set();
  }

  get mode() { return this._mode; }
  get selectedJoint() { return this._joint; }
  get readOnly() { return this._readOnly; }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _notify() { for (const fn of this._listeners) fn(); }

  setReadOnly(v) {
    this._readOnly = v;
    if (v) { this._mode = 'view'; this._joint = null; }
    else if (this._mode === 'view') { this._mode = 'pose'; }
    this._notify();
  }

  setMode(mode) {
    if (this._readOnly) return;
    if (!MODES.includes(mode)) return;
    this._mode = mode;
    if (mode !== 'pose') this._joint = null;
    this._notify();
  }

  selectJoint(index) {
    if (this._readOnly) return;
    this._joint = index;
    this._mode = 'pose';
    this._notify();
  }

  clearSelection() { this._joint = null; this._notify(); }

  isInteractionActive(mode) { return !this._readOnly && this._mode === mode; }
}
```

- [ ] **Step 4: Run, confirm PASS (6 tests)**

Run: `node --test label/tests/ui_controller.test.js`

- [ ] **Step 5: Commit**

```bash
git add label/src/ui/ui_controller.js label/tests/ui_controller.test.js
git commit -m "feat(label): UIController single-active edit mode + selection"
```

---

## Task 5: Three-pane layout + tabbed edit panel + joint grid (index.html)

Rebuild the page so a first-time user understands it. Left = read-only info; center = viewport; right = tabbed editor with one mode visible at a time; an anatomical joint-button grid replaces the dropdown.

**Files:**
- Modify: `label/index.html`

- [ ] **Step 1: Replace body layout**

Keep the importmap (three + OrbitControls + TransformControls) and the canvas. Restructure `<body>` to three columns: `#left` (read-only), `#stage` (canvas+status, center, flex:1), `#right` (tabbed editor). Use this markup (replace everything inside `<body>` except the trailing `<script type="module" src="./src/app.js">`):

```html
  <aside id="left">
    <h2>SMPL 标注器</h2>
    <button id="btn-open" class="primary">📂 打开数据(目录 / 文件)</button>
    <input id="dir-input" type="file" webkitdirectory directory multiple hidden>

    <div class="card">
      <h3>当前帧</h3>
      <div id="frame-info" class="big">— / —</div>
      <input id="slider" type="range" min="0" max="0" value="0">
      <div class="row">
        <button id="btn-prev" title="上一帧">◀</button>
        <button id="btn-play" title="播放/暂停">▶ 播放</button>
        <button id="btn-next" title="下一帧">▶|</button>
      </div>
      <div class="row small"><span>速度</span><input id="speed" type="range" min="1" max="60" value="24"><span id="speed-val">24 fps</span></div>
    </div>

    <div class="card">
      <h3>本帧标注状态</h3>
      <div id="anno-state" class="status">—</div>
      <div id="anno-actions"></div>
    </div>

    <div class="card">
      <h3>视角</h3>
      <div class="row"><button id="btn-2d" class="on">2D 对齐</button><button id="btn-3d">3D 自由</button></div>
      <h3 style="margin-top:8px">显示</h3>
      <div class="row wrap">
        <button id="t-mesh" class="on">网格</button><button id="t-points" class="on">关键点</button>
        <button id="t-bones" class="on">骨骼</button><button id="t-grid" class="on">底网</button>
        <button id="t-axes">轴</button><button id="t-bg" class="on">底图</button>
      </div>
    </div>

    <div class="card">
      <h3>关节角度 (只读)</h3>
      <div id="angle-list" class="mono"></div>
    </div>

    <div class="card">
      <h3>读写</h3>
      <div class="row"><button id="btn-save" class="primary">💾 保存 JSON</button><button id="btn-reset">↺ 重置</button></div>
      <div class="row"><button id="btn-undo">↶ 撤销 (Ctrl+Z)</button></div>
    </div>
  </aside>

  <div id="stage"><canvas id="c"></canvas><div id="status">就绪 — 请先打开数据</div></div>

  <aside id="right">
    <div id="tabs">
      <button class="tab on" data-mode="pose">姿势</button>
      <button class="tab" data-mode="root">位置</button>
      <button class="tab" data-mode="bbox">框</button>
      <button class="tab" data-mode="beta">体型</button>
    </div>

    <section class="tabpanel" data-mode="pose">
      <p class="hint">点击画面中的关节点,或在下方选择一个关节,然后拖动出现的旋转环。</p>
      <div id="joint-grid"></div>
      <div id="sel-joint" class="status">未选择关节</div>
      <h3>旋转 (欧拉 XYZ, 度)</h3>
      <div class="kgrid">
        <label>X</label><input type="number" id="eul-x" step="1"><input type="range" id="eul-x-s" min="-180" max="180" step="1">
        <label>Y</label><input type="number" id="eul-y" step="1"><input type="range" id="eul-y-s" min="-180" max="180" step="1">
        <label>Z</label><input type="number" id="eul-z" step="1"><input type="range" id="eul-z-s" min="-180" max="180" step="1">
      </div>
    </section>

    <section class="tabpanel" data-mode="root" hidden>
      <p class="hint">拖动箭头移动整个人体;切换到“旋转”可改朝向。</p>
      <div class="row"><button id="root-translate" class="on">移动</button><button id="root-rotate">旋转</button></div>
      <h3>位置 (米)</h3>
      <div class="kgrid">
        <label>x</label><input type="number" id="pos-x" step="0.01">
        <label>y</label><input type="number" id="pos-y" step="0.01">
        <label>z</label><input type="number" id="pos-z" step="0.01">
      </div>
    </section>

    <section class="tabpanel" data-mode="bbox" hidden>
      <p class="hint">在 2D 对齐视角下,拖动方框四角调整;或一键从人体投影。</p>
      <button id="btn-bbox-auto">⌖ 从人体投影生成框</button>
      <div id="bbox-ro" class="status">—</div>
    </section>

    <section class="tabpanel" data-mode="beta" hidden>
      <p class="hint">调整体型参数,实时改变胖瘦高矮。</p>
      <div id="beta-sliders"></div>
      <button id="btn-beta-reset">归零</button>
    </section>

    <div class="card">
      <h3>相机内参 (实时)</h3>
      <div class="kgrid">
        <label>fx</label><input type="number" id="k-fx" step="1">
        <label>fy</label><input type="number" id="k-fy" step="1">
        <label>cx</label><input type="number" id="k-cx" step="1">
        <label>cy</label><input type="number" id="k-cy" step="1">
      </div>
      <button id="btn-k-reset">重置内参</button>
    </div>
  </aside>
```

- [ ] **Step 2: Replace the `<style>` with the three-pane styling**

Replace the contents of `<style>` with:

```css
    html,body { height:100%; margin:0; background:#1a1f2a; color:#eee; font-family:system-ui,monospace; font-size:12px; }
    body { display:flex; }
    #left, #right { width:280px; background:#1a1a1a; padding:10px; display:flex; flex-direction:column; gap:8px; overflow-y:auto; }
    #left { border-right:1px solid #333; } #right { border-left:1px solid #333; }
    #stage { position:relative; flex:1; background:#0f1216; overflow:hidden; min-width:0; }
    canvas { display:block; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); }
    #status { position:absolute; top:8px; left:8px; background:rgba(0,0,0,.6); padding:5px 9px; border-radius:3px; }
    h2 { font-size:14px; color:#7df; margin:0 0 4px; }
    h3 { font-size:11px; color:#8ab; margin:0 0 2px; }
    .card { border-top:1px solid #2a2a2a; padding-top:8px; display:flex; flex-direction:column; gap:5px; }
    button { padding:6px 8px; background:#2a2a2a; border:1px solid #444; color:#eee; border-radius:4px; cursor:pointer; font:inherit; }
    button:hover { background:#3a3a3a; }
    button.on { background:#0066cc; border-color:#3399ff; }
    button.primary { background:#1f6f43; border-color:#2e9e60; }
    .row { display:flex; gap:5px; } .row.wrap { flex-wrap:wrap; } .row > * { flex:1; }
    .row.small { align-items:center; color:#888; } .row.small span { flex:0 0 auto; }
    .big { font-size:16px; color:#ffa; text-align:center; }
    .status { background:#222; border:1px solid #333; color:#ffa; padding:4px 6px; border-radius:3px; min-height:16px; }
    .hint { color:#9ab; font-size:11px; line-height:1.5; margin:0 0 4px; background:#222b33; padding:6px 8px; border-radius:4px; }
    input[type=range] { width:100%; } input[type=number] { background:#222; border:1px solid #444; color:#eee; padding:3px 4px; border-radius:3px; font:inherit; width:100%; }
    .kgrid { display:grid; grid-template-columns:auto 70px 1fr; gap:4px 6px; align-items:center; }
    .kgrid > label { font-size:11px; color:#9ab; text-align:right; }
    .mono { font-size:11px; line-height:1.6; }
    #tabs { display:flex; gap:3px; } #tabs .tab { flex:1; border-radius:4px 4px 0 0; }
    .tabpanel { border:1px solid #333; border-radius:0 0 4px 4px; padding:8px; display:flex; flex-direction:column; gap:6px; }
    #joint-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:3px; }
    #joint-grid button { font-size:10px; padding:4px 2px; } #joint-grid button.on { background:#0066cc; }
```

- [ ] **Step 3: Verify it serves with the new ids**

```bash
npm run serve:label >/tmp/s.log 2>&1 & sleep 2
for id in left right joint-grid tabs anno-actions sel-joint eul-x-s; do
  printf "%s=%s\n" "$id" "$(curl -s http://127.0.0.1:5175/label/ | grep -c "$id")"
done
pkill -f static_server.mjs
```
Expected: each ≥ 1.

- [ ] **Step 4: Commit**

```bash
git add label/index.html
git commit -m "feat(label): three-pane layout — read-only left, tabbed editor right, joint grid"
```

---

## Task 6: Canvas joint picking (`joint_picker.js`) + scene support

Click a joint sphere in the viewport to select it. Thin three.js raycaster wrapper — browser-only, `node --check` + manual verify.

**Files:**
- Create: `label/src/ui/joint_picker.js`
- Modify: `label/src/scene/scene.js` (expose joint sphere meshes for raycasting)

- [ ] **Step 1: Expose joint spheres from the scene**

In `label/src/scene/scene.js`, ensure the 24 joint sphere meshes are reachable. Add a method `jointMeshes()` returning the array `this._jointsGroup.children` (the 24 spheres). Tag each sphere with its SMPL index when built: in `setTopology`, after creating sphere `s` for index `i`, set `s.userData.jointIndex = i;`.

- [ ] **Step 2: Create `joint_picker.js`**

```javascript
// label/src/ui/joint_picker.js
import * as THREE from 'three';

// Raycast a pointer event against the scene's joint spheres.
// Returns the SMPL joint index (0..23) or null. onPick(smplIndex) is called on hit.
export class JointPicker {
  constructor({ canvas, camera, getJointMeshes, onPick }) {
    this._canvas = canvas;
    this._camera = camera;
    this._getJointMeshes = getJointMeshes;
    this._onPick = onPick;
    this._ray = new THREE.Raycaster();
    this._ray.params.Points = { threshold: 0.05 };
    this._enabled = false;
    this._handler = (e) => this._onPointerDown(e);
    canvas.addEventListener('pointerdown', this._handler);
  }

  setEnabled(v) { this._enabled = v; }

  _onPointerDown(e) {
    if (!this._enabled) return;
    const rect = this._canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this._ray.setFromCamera(ndc, this._camera);
    const meshes = this._getJointMeshes();
    const hits = this._ray.intersectObjects(meshes, false);
    if (hits.length) {
      const idx = hits[0].object.userData.jointIndex;
      if (typeof idx === 'number') this._onPick(idx);
    }
  }

  dispose() { this._canvas.removeEventListener('pointerdown', this._handler); }
}
```

Note: picking returns the SMPL joint index (0=pelvis/root, 1..21 are body joints +12 etc.). The app maps SMPL index → UI selection: SMPL 0 → root mode; SMPL j (1..23) where a body-pose joint exists → body index j−1 for `selectJoint`. SMPL joints with no body_pose slot (22,23 hands) can be ignored or clamped.

- [ ] **Step 3: Verify**

```bash
node --check label/src/ui/joint_picker.js
node --check label/src/scene/scene.js
```

- [ ] **Step 4: Commit**

```bash
git add label/src/ui/joint_picker.js label/src/scene/scene.js
git commit -m "feat(label): canvas joint picking via raycaster"
```

---

## Task 7: Fix the pose gizmo to use correct local-frame mapping

Rewrite `pose_gizmo.js` so it displays the gizmo at the joint's WORLD orientation and converts drags back to the joint local quaternion using the parent world rotation (Task 1 output + Task 3 math). Eliminates the jump.

**Files:**
- Modify: `label/src/edit/pose_gizmo.js`
- Modify: `label/src/app.js` (pass parent world rotation to the gizmo on attach)

- [ ] **Step 1: Rewrite `pose_gizmo.js`**

The gizmo proxy is set to the joint's WORLD quaternion (`worldGizmoFromLocal(qParentWorld, qLocal)`); on drag it reads the proxy world quaternion and writes the joint local via `localFromWorldGizmo(qParentWorld, qWorldNew)`. Replace the direct-quaternion mapping:

```javascript
// label/src/edit/pose_gizmo.js
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { worldGizmoFromLocal, localFromWorldGizmo } from './gizmo_frame.js';

// Per-joint rotation gizmo. Displays at the joint's WORLD orientation and maps
// drags back to the joint LOCAL quaternion using the parent world rotation, so
// the on-screen rings align with what the user sees and edits don't jump.
export class PoseGizmo {
  constructor({ scene, camera, canvas, controls, getMode, getRotation, getStore, onEdit }) {
    this._scene = scene;
    this._getMode = getMode;
    this._getRotation = getRotation;
    this._getStore = getStore;
    this._onEdit = onEdit;
    this._jointBody = null;       // body-pose index (0..20)
    this._qParentWorld = [0, 0, 0, 1];
    this._proxy = new THREE.Object3D();
    this._scene.add(this._proxy);
    this._tc = new TransformControls(camera, canvas);
    this._tc.setMode('rotate');
    this._tc.setSpace('local');
    this._tc.addEventListener('dragging-changed', (e) => {
      controls.enabled = e.value ? false : (getMode() === '3d');
      if (e.value) this._getStore().beginEdit();
      else this._getStore().commitEdit();
    });
    this._tc.addEventListener('objectChange', () => this._onDrag());
    this._scene.add(this._tc.getHelper ? this._tc.getHelper() : this._tc);
    this.detach();
  }

  // qParentWorld: [x,y,z,w] parent joint world rotation. worldPos: [x,y,z].
  attach(jointBody, worldPos, qParentWorld) {
    this._jointBody = jointBody;
    this._qParentWorld = qParentWorld;
    const qLocal = this._getRotation().getJointQuat(jointBody);
    const qWorld = worldGizmoFromLocal(qParentWorld, qLocal);
    this._proxy.position.set(worldPos[0], worldPos[1], worldPos[2]);
    this._proxy.quaternion.set(qWorld[0], qWorld[1], qWorld[2], qWorld[3]);
    this._proxy.updateMatrixWorld(true);
    this._tc.attach(this._proxy);
    this._setVisible(true);
  }

  detach() {
    if (this._tc.object) this._tc.detach();
    this._setVisible(false);
    this._jointBody = null;
  }

  _setVisible(v) {
    const helper = this._tc.getHelper ? this._tc.getHelper() : this._tc;
    helper.visible = v;
    if (this._tc.enabled !== undefined) this._tc.enabled = v;
  }

  _onDrag() {
    if (this._jointBody === null) return;
    const q = this._proxy.quaternion;
    const qWorld = [q.x, q.y, q.z, q.w];
    const qLocal = localFromWorldGizmo(this._qParentWorld, qWorld);
    this._getRotation().setJointQuat(this._jointBody, qLocal);
    this._getStore().applyFields(this._getRotation().toAxisAngle());
    this._onEdit();
  }
}
```

(If the installed TransformControls r160 adds itself to the scene directly rather than via `getHelper()`, keep the `getHelper ? ... : this._tc` guard — it handles both.)

- [ ] **Step 2: Supply parent world rotation in app.js**

In `applyAnnotation`, request world rotations: `const out = forwardSmpl(model, buildFrame(), { worldRot: true });` and cache `lastWorldRot = out.worldRot;`. When attaching the pose gizmo for body joint `j` (SMPL joint `j+1`), compute the PARENT's world rotation:
```javascript
import { mat3ToQuat } from '../../smpl_core/rotations.js'; // in app.js
// ...
const smplJ = jBody + 1;
const parent = model.parents[smplJ];
const pm = lastWorldRot.slice(parent * 9, parent * 9 + 9);
const qParentWorld = mat3ToQuat(pm);
poseGizmo.attach(jBody, scene.jointWorldPosition(smplJ), qParentWorld);
```
Re-attach (refresh qParentWorld + position) whenever the frame changes while a joint stays selected, so the gizmo tracks the live pose.

- [ ] **Step 3: Verify**

```bash
node --check label/src/edit/pose_gizmo.js label/src/app.js
node --test label/tests/*.test.js
```
All parse; pure-logic tests (incl. gizmo_frame) pass.

- [ ] **Step 4: Commit**

```bash
git add label/src/edit/pose_gizmo.js label/src/app.js
git commit -m "fix(label): pose gizmo uses correct local-frame mapping (no more jump)"
```

---

## Task 8: Rewire app.js + panels.js to the new UI (tabs, joint grid, status-driven add/delete, single-active interaction)

The integration task that ties it together. Browser — `node --check` + manual verify (Task 9). If it grows too large, report DONE_WITH_CONCERNS.

**Files:**
- Modify: `label/src/app.js`
- Modify: `label/src/ui/panels.js`

- [ ] **Step 1: Switch app.js from EditController to UIController + tabs**

- Import `UIController` (replace EditController), `JointPicker`, `mat3ToQuat`.
- Construct `ui = new UIController({ readOnly })` in `openFiles` after `readOnly` is known.
- Tab buttons: `document.querySelectorAll('#tabs .tab')` → on click `ui.setMode(btn.dataset.mode)`. A central `syncUI()` (subscribed via `ui.onChange`) does ALL of:
  - highlight the active tab; show only the matching `.tabpanel` (`panel.hidden = panel.dataset.mode !== ui.mode`).
  - attach/detach gizmos & overlays so EXACTLY ONE interaction is live:
    - `pose` + `selectedJoint!=null` → poseGizmo.attach(...); else poseGizmo.detach(). rootHandle.detach(); bboxOverlay hidden.
    - `root` → rootHandle.attach(store.current().root_pos); poseGizmo.detach(); bboxOverlay hidden.
    - `bbox` → bboxOverlay visible (only here); gizmos detached.
    - `beta`/`view` → all detached, overlay hidden.
  - `jointPicker.setEnabled(ui.mode === 'pose')`.
  - refresh panels via `panels.syncFromState()`.
- Remove the old `#tool-root/#tool-pose/#tool-bbox` and `#t-bbox` wiring (those ids no longer exist). The bbox visibility is purely driven by `ui.mode === 'bbox'`.

- [ ] **Step 2: Joint grid + canvas picking**

- Build the joint grid in `#joint-grid`: 21 buttons for body joints (labels from JOINT_NAMES[j+1]) plus this is selection UI. On click → `ui.selectJoint(bodyIndex)`. Highlight the selected one in `syncUI`.
- `jointPicker = new JointPicker({ canvas:$('c'), camera:cam.camera, getJointMeshes:()=>scene.jointMeshes(), onPick:(smpl)=>{ if (smpl===0) ui.setMode('root'); else if (smpl>=1 && smpl<=21) ui.selectJoint(smpl-1); } })`.
- `#sel-joint` shows the selected joint name or “未选择关节”.

- [ ] **Step 3: Status-driven add/delete (left panel `#anno-actions`)**

In `syncUI` / `showFrame`, render `#anno-state` + `#anno-actions` from `store.hasData()`:
```javascript
function renderAnnoActions() {
  const has = store && store.hasData();
  $('anno-state').textContent = has ? '✅ 本帧已标注' : '— 本帧无标注';
  $('anno-actions').innerHTML = '';
  const mk = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; $('anno-actions').appendChild(b); };
  if (ui?.readOnly) return;
  if (has) {
    mk('🗑 删除本帧标注', '', () => { store.deleteCurrent(); showFrame(store.currentFrame()); });
  } else {
    mk('＋ 新建:T-pose 姿势', 'primary', () => { store.addTpose(); showFrame(store.currentFrame()); });
    mk('＋ 新建:复制上一帧', '', () => { store.addFromPrevious(); showFrame(store.currentFrame()); });
  }
}
```
Wrap `#anno-actions` buttons in a `.row`. Call `renderAnnoActions()` from `showFrame` and `syncUI`.

- [ ] **Step 4: Keep working: playback, toggles, undo, save/reset, intrinsics, beta, euler, bbox-auto**

- Display toggles `t-mesh..t-bg` (no more `t-bbox`).
- `#btn-undo` + Ctrl+Z; `#btn-save`/`#btn-reset` (unchanged from M2).
- `#root-translate`/`#root-rotate` → rootHandle.setMode(...) (root tab).
- `#btn-bbox-auto`, `#btn-beta-reset`, intrinsics, euler sliders+numbers (Task: wire `#eul-x-s` etc. sliders alongside the numeric inputs — both drive the same setJointEuler/setRootEuler; mirror each other in syncFromState).
- 2D/3D buttons unchanged; when switching to 3D, if `ui.mode==='bbox'` keep the overlay hidden (overlay already gates on cam.mode==='2d').

- [ ] **Step 5: panels.js — euler sliders + read-only split**

- `syncFromState`: also set the three euler range sliders (`#eul-x-s/y-s/z-s`) from the same degree values (skip if focused). Wire their `input` to the same handler as the numeric euler inputs.
- Move the angle-list render target confirm it writes to `#angle-list` (left panel) — unchanged id.
- `populateJointSelect` is replaced by the joint grid built in app.js; remove the dropdown population (the `#joint-select` element no longer exists). If panels.js references `#joint-select`, delete that code.
- Keep beta sliders building into `#beta-sliders`, intrinsics into `#k-*`, pos into `#pos-*`, bbox readout into `#bbox-ro`.

- [ ] **Step 6: Verify**

```bash
node --check label/src/app.js label/src/ui/panels.js
node --test label/tests/*.test.js
npm test
```
Parse OK; all pure-logic tests pass; existing suites green.

- [ ] **Step 7: Commit**

```bash
git add label/src/app.js label/src/ui/panels.js
git commit -m "feat(label): rewire to tabbed single-active UI, joint grid+picking, status-driven add/delete"
```

---

## Task 9: Manual verification

**Files:** none.

- [ ] **Step 1: Serve + load** `npm run serve:label` → `http://127.0.0.1:5175/label/` → load `/Users/penghaotian/Downloads/20260609/test_data`.

- [ ] **Step 2: Layout & clarity** — three panes visible; left shows frame/status/angles read-only; right shows tabs. A first-read user can tell how to add/delete (semantic buttons) and how to edit (tabs + hints).

- [ ] **Step 3: Single-active interaction** — only the active tab's interaction works. In Bbox tab the box shows (2D only) and corners drag; switch to any other tab → box gone, no stray gizmos. 3D mode never shows the bbox.

- [ ] **Step 4: Pose fix** — select a joint (click in viewport OR joint grid); rotate the gizmo; the mesh rotates smoothly about the gizmo rings with NO jump/teleport, even for limbs with rotated parents (elbows, knees). Euler numbers + sliders track the gizmo and vice-versa.

- [ ] **Step 5: Root / Beta / IO** — root translate + rotate gizmos; beta sliders reshape; save downloads json; reset reloads; undo reverts one edit.

- [ ] **Step 6: Portrait gate** — portrait data → editor tabs disabled / read-only, viewport still works.

- [ ] **Step 7: Record pass/fail; fix before final review.**

---

## Out of scope (future)

- Occlusion (occlution_joint) WebGL depth recompute — `occlusionFromDepth` ready, still unwired.
- IK drag-to-pose; multi-person; video frame extraction beyond `<video>` seeking.

## Self-review checklist (run after writing; fix inline)

- Pose-gizmo jump fix is backed by pure tests (gizmo_frame round-trip) + the world-rot lbs output.
- Exactly one edit interaction can be active (UIController + syncUI attach/detach); bbox only in its tab + 2D.
- Add/delete are status-driven semantic buttons; joint selection via canvas pick + grid (no dropdown).
- Read-only info (frame/angles/status) on the left; editors on the right.
- No dangling references to removed ids (`#tool-*`, `#t-bbox`, `#joint-select`).
- Method/name consistency with M1/M2 interfaces; no placeholders.





