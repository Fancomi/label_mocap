# Pole/End Handle Single-Active Switch UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only one IK handle's 3-axis arrows at a time (the active handle); the other shrinks to a clickable marker, and clicking a marker makes it active — with color+shape distinction between the two handles.

**Architecture:** A tiny pure `HandleSelection` state machine (unit-tested) holds `active: 'end' | 'pole'` bound to a chain. `ik_plugin` owns it, attaches BOTH handles whenever an IK limb is selected, and calls `setActive` on each so exactly one shows arrows. Each handle owns a marker mesh (end = grey cube, pole = cyan sphere) used both as the inactive placeholder and as the raycast target for switching. A plugin-local pointerup listener (4px click threshold) raycasts the two markers and flips the selection. Solver and storage are untouched.

**Tech Stack:** Vanilla ES modules, three.js (vendored, browser-only), `node --test`. No build step.

---

## File Structure

- **Create** `smpl_edit/handle_selection.js` — pure (no DOM/three) state machine for `active`/`chain`. Unit-tested.
- **Create** `smpl_edit/tests/handle_selection.test.js` — its tests.
- **Modify** `smpl_edit/ik_handle.js` — add a grey cube marker (child of proxy) + `setActive(bool)` + `markerMesh()`.
- **Modify** `smpl_edit/pole_handle.js` — add `setActive(bool)` + `markerMesh()`; sphere stays visible in both states.
- **Modify** `smpl_edit/ik_plugin.js` — own the `HandleSelection`; attach both handles in `syncHook`; add a pointerup switch raycast; reset on detach/uninstall.

**Visual contract:**
- End handle — active: RGB 3-axis arrows, cube hidden. Inactive: grey cube marker, arrows hidden+disabled.
- Pole handle — active: 3-axis arrows + cyan sphere head (sphere visible). Inactive: cyan sphere marker, arrows hidden+disabled.
- Distinction: pole always carries the cyan sphere (color), end never does; inactive markers differ by shape (cube vs sphere).

---

## Task 1: `HandleSelection` pure state machine

**Files:**
- Create: `smpl_edit/handle_selection.js`
- Test: `smpl_edit/tests/handle_selection.test.js`

- [ ] **Step 1: Write the failing test**

Create `smpl_edit/tests/handle_selection.test.js`:

```javascript
// smpl_edit/tests/handle_selection.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HandleSelection } from '../handle_selection.js';

test('defaults to end with no chain', () => {
  const s = new HandleSelection();
  assert.equal(s.active(), 'end');
});

test('select switches between end and pole; ignores garbage', () => {
  const s = new HandleSelection();
  s.select('pole'); assert.equal(s.active(), 'pole');
  s.select('end'); assert.equal(s.active(), 'end');
  s.select('nonsense'); assert.equal(s.active(), 'end'); // unchanged
});

test('bindChain to the SAME chain keeps the current active handle', () => {
  const s = new HandleSelection();
  s.bindChain('L_Arm');
  s.select('pole');
  s.bindChain('L_Arm'); // same limb across a re-sync
  assert.equal(s.active(), 'pole');
});

test('bindChain to a DIFFERENT chain resets active to end', () => {
  const s = new HandleSelection();
  s.bindChain('L_Arm');
  s.select('pole');
  s.bindChain('R_Arm'); // switched limb
  assert.equal(s.active(), 'end');
});

test('reset returns to end and clears the chain', () => {
  const s = new HandleSelection();
  s.bindChain('L_Arm');
  s.select('pole');
  s.reset();
  assert.equal(s.active(), 'end');
  // after reset, binding the previously-active chain must NOT keep 'pole'
  s.bindChain('L_Arm');
  assert.equal(s.active(), 'end');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test smpl_edit/tests/handle_selection.test.js`
Expected: FAIL — `Cannot find module '../handle_selection.js'`.

- [ ] **Step 3: Implement the state machine**

Create `smpl_edit/handle_selection.js`:

```javascript
// smpl_edit/handle_selection.js
// 极向量/末端柄的「单活动」选择状态机。纯逻辑,无 DOM / 无 three.js。
// active: 'end' | 'pole';绑定到一条链。换链时重置回 'end';同链跨 sync 保持。
export class HandleSelection {
  constructor() {
    this._active = 'end';
    this._chain = null;
  }

  active() { return this._active; }

  // 点选切换:仅接受 'end' / 'pole',其余忽略。
  select(which) {
    if (which === 'end' || which === 'pole') this._active = which;
  }

  // 绑定当前 IK 肢体链名。换了链 → 重置回 'end';同链 → 保持当前选择。
  bindChain(chainName) {
    if (chainName !== this._chain) {
      this._chain = chainName;
      this._active = 'end';
    }
  }

  // 关 IK / 离开 pose / 无选中:回到初始态。
  reset() {
    this._active = 'end';
    this._chain = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test smpl_edit/tests/handle_selection.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add smpl_edit/handle_selection.js smpl_edit/tests/handle_selection.test.js
git commit -m "feat(ik): HandleSelection pure state machine for single-active handle"
```

---

## Task 2: End handle — grey cube marker + setActive/markerMesh

**Files:**
- Modify: `smpl_edit/ik_handle.js`

The constructor currently builds an empty `this._proxy = new THREE.Object3D();` and a TransformControls. Add a grey cube child of the proxy, plus two methods.

- [ ] **Step 1: Add the cube marker in the constructor**

In `smpl_edit/ik_handle.js`, find:

```javascript
    // 代理对象:TransformControls 实际操纵它,我们只取它的世界坐标喂给 IK。
    this._proxy = new THREE.Object3D();
```

Replace with:

```javascript
    // 代理对象:TransformControls 实际操纵它,我们只取它的世界坐标喂给 IK。
    this._proxy = new THREE.Object3D();

    // 占位标识:非活动态显示的灰白小立方体(形状区别于极向量的球),可被点选以切回末端柄。
    this._cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.04),
      new THREE.MeshBasicMaterial({ color: 0xcccccc, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this._cube.renderOrder = 999;
    this._cube.visible = false; // 默认活动(出箭头),立方体藏起
    this._proxy.add(this._cube);
```

- [ ] **Step 2: Add `setActive` and `markerMesh` methods**

In `smpl_edit/ik_handle.js`, after the `detach()` method and before `update()`, add:

```javascript
  // 活动 = 出三轴箭头、藏立方体;非活动 = 藏箭头并禁用、显示立方体占位。
  setActive(active) {
    this._tc.visible = active;
    this._tc.enabled = active;
    this._cube.visible = !active;
  }

  // 供插件做切换拾取:返回占位标识 mesh(立方体)。
  markerMesh() { return this._cube; }
```

- [ ] **Step 3: Verify it imports cleanly (syntax only — bare `three` failing under node is expected)**

Run: `node --input-type=module -e "import('./smpl_edit/ik_handle.js').then(()=>console.log('imported')).catch(e => { const s=String(e); if (s.includes('three')) console.log('OK: only vendored three import unresolved under node (expected)'); else { console.error(s); process.exit(1); } })"`
Expected: prints the OK line. A SYNTAX error must be fixed.

- [ ] **Step 4: Confirm existing suite still green**

Run: `npm run test:web`
Expected: 0 failures (this file is not unit-tested, but the run confirms nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add smpl_edit/ik_handle.js
git commit -m "feat(ik): end handle grey cube marker + setActive/markerMesh"
```

---

## Task 3: Pole handle — setActive/markerMesh (sphere persists)

**Files:**
- Modify: `smpl_edit/pole_handle.js`

The pole handle already has `this._sphere` (cyan) as a child of the proxy. The sphere stays visible in BOTH states — it is the cyan head when active and the marker when inactive. Only the arrows toggle.

- [ ] **Step 1: Add `setActive` and `markerMesh` methods**

In `smpl_edit/pole_handle.js`, after the `detach()` method and before `update()`, add:

```javascript
  // 活动 = 出三轴箭头(青球作头标);非活动 = 藏箭头并禁用(青球仍在,作占位标识)。
  setActive(active) {
    this._tc.visible = active;
    this._tc.enabled = active;
    this._sphere.visible = true; // 青球两态都显示:活动时是头标,非活动时是占位标识
  }

  // 供插件做切换拾取:返回占位标识 mesh(青球)。
  markerMesh() { return this._sphere; }
```

- [ ] **Step 2: Verify it imports cleanly (syntax only)**

Run: `node --input-type=module -e "import('./smpl_edit/pole_handle.js').then(()=>console.log('imported')).catch(e => { const s=String(e); if (s.includes('three')) console.log('OK: only vendored three import unresolved under node (expected)'); else { console.error(s); process.exit(1); } })"`
Expected: prints the OK line.

- [ ] **Step 3: Commit**

```bash
git add smpl_edit/pole_handle.js
git commit -m "feat(ik): pole handle setActive/markerMesh (cyan sphere persists)"
```

---

## Task 4: Wire single-active selection + click-to-switch in ik_plugin

**Files:**
- Modify: `smpl_edit/ik_plugin.js`

This task: (a) import THREE + HandleSelection, (b) own a `selection` instance, (c) in `syncHook` attach both handles and call `setActive` per selection (binding the chain), (d) add a pointerup listener that raycasts the two markers and switches, (e) reset selection + remove the listener on detach/uninstall.

- [ ] **Step 1: Add imports**

In `smpl_edit/ik_plugin.js`, after the existing `import { PoleHandle } from './pole_handle.js';` line, add:

```javascript
import { HandleSelection } from './handle_selection.js';
import * as THREE from 'three';
```

- [ ] **Step 2: Create the selection state + a click-detection raycaster**

Inside `installIK(ctx)`, right after `let ikEnabled = false;`, add:

```javascript
  const selection = new HandleSelection();
  let takeoverActive = false;        // syncHook 置位:当前是否处于 IK 接管态(决定切换监听是否生效)
  const CLICK_THRESH = 4;            // 与 joint_picker 一致:位移 < 4px 视为点击
  const _ray = new THREE.Raycaster();
  let _down = null;                  // pointerdown 起点 {x,y,moved}
```

- [ ] **Step 3: Replace the `syncHook` IK-takeover branch**

In `syncHook`, find this block:

```javascript
    const sel = ui.selectedJoint;
    const ikChain = ikEnabled ? ikController.chainFor((sel ?? -1) + 1) : null;
    if (!ctx.isPlaying() && ui.mode === 'pose' && ikChain && ctx.getLastJoints()) {
      ikHandle.attach(ctx.scene.jointWorldPosition(sel + 1));
      const stored = ikController.storedPole(ikChain.name);
      poleHandle.attach(stored ?? ikController.autoPoleViz(ikChain));
      return true; // 接管:本体不要再挂单关节旋转 gizmo
    }
    ikHandle.detach();
    poleHandle.detach();
    return false;
```

Replace it with:

```javascript
    const sel = ui.selectedJoint;
    const ikChain = ikEnabled ? ikController.chainFor((sel ?? -1) + 1) : null;
    if (!ctx.isPlaying() && ui.mode === 'pose' && ikChain && ctx.getLastJoints()) {
      selection.bindChain(ikChain.name);            // 换链重置回 'end',同链保持
      ikHandle.attach(ctx.scene.jointWorldPosition(sel + 1));
      const stored = ikController.storedPole(ikChain.name);
      poleHandle.attach(stored ?? ikController.autoPoleViz(ikChain));
      // 单活动:按 selection 决定谁出箭头、谁作占位标识。
      const active = selection.active();
      ikHandle.setActive(active === 'end');
      poleHandle.setActive(active === 'pole');
      takeoverActive = true;
      return true; // 接管:本体不要再挂单关节旋转 gizmo
    }
    selection.reset();
    takeoverActive = false;
    ikHandle.detach();
    poleHandle.detach();
    return false;
```

- [ ] **Step 4: Add the pointerup switch listener**

In `smpl_edit/ik_plugin.js`, after `ctx.registerSyncHook(syncHook);`, add:

```javascript
  // 切换拾取:在画布上自挂一条轻量 pointerdown/up 监听,只 raycast 两个占位标识 mesh
  // (末端立方体 / 极向量球)。命中且未拖拽 → 按被点 mesh 的身份设 active 并重挂。
  // 不复用 JointPicker:占位 mesh 不是关节球,且活动柄存在时会落入 engage 闸。
  const canvas = ctx.canvas;
  const onPointerDown = (e) => { _down = { x: e.clientX, y: e.clientY, moved: false }; };
  const onPointerMove = (e) => {
    if (!_down || _down.moved) return;
    if (Math.hypot(e.clientX - _down.x, e.clientY - _down.y) > CLICK_THRESH) _down.moved = true;
  };
  const onPointerUp = (e) => {
    const down = _down; _down = null;
    if (!takeoverActive || !down || down.moved) return;           // 非接管态 / 拖拽 → 不切换
    if (ikHandle.isDragging() || poleHandle.isDragging()) return; // 正在拖箭头 → 不切换
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    _ray.setFromCamera(ndc, ctx.camera);
    const endMarker = ikHandle.markerMesh();
    const poleMarker = poleHandle.markerMesh();
    const hits = _ray.intersectObjects([endMarker, poleMarker], false);
    if (!hits.length) return;
    const obj = hits[0].object;
    if (obj === endMarker) selection.select('end');
    else if (obj === poleMarker) selection.select('pole');
    else return;
    ctx.requestSync(); // 重挂:syncHook 据 selection 重新 setActive
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
```

- [ ] **Step 5: Clean up listeners + reset on uninstall**

In the returned `uninstallIK` function, after the existing `poleHandle.detach();` line, add:

```javascript
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    selection.reset();
    takeoverActive = false;
```

- [ ] **Step 6: Verify import + full suite**

Run: `node --input-type=module -e "import('./smpl_edit/ik_plugin.js').then(()=>console.log('imported')).catch(e => { const s=String(e); if (s.includes('three')) console.log('OK: only vendored three import unresolved under node (expected)'); else { console.error(s); process.exit(1); } })"`
Expected: the OK line (or 'imported'); fix any SYNTAX error.

Run: `npm run test:web`
Expected: 0 failures (handle_selection tests pass; nothing else broke).

- [ ] **Step 7: Commit**

```bash
git add smpl_edit/ik_plugin.js
git commit -m "feat(ik): single-active handle selection + click-to-switch in ik_plugin"
```

---

## Task 5: Full suite + manual-verification checklist

**Files:** none (verification only)

- [ ] **Step 1: Run the full web suite**

Run: `npm run test:web`
Expected: 0 failures.

- [ ] **Step 2: Record the browser manual-verification checklist**

These need three.js/DOM, verified via `node smpl_web_viewer/tools/static_server.mjs --root . --port 5185` → open `http://localhost:5185/label/`:

1. Enable IK, select a wrist/ankle → only the END handle shows 3-axis arrows; the pole appears as a **cyan sphere** (no arrows).
2. Click the cyan sphere → arrows move to the pole handle (with the cyan sphere as its head); the end handle becomes a **grey cube** marker (no arrows).
3. Click the grey cube → arrows return to the end handle; pole goes back to a bare cyan sphere.
4. Drag the active handle's arrows → the limb solves (end drag = solveTo; pole drag = end-locked plane rotation). Dragging arrows must NOT trigger a switch.
5. A small click (<4px) on a marker switches; a drag (>4px) does not.
6. Switch to the other arm/leg → selection resets so the END handle is active again.
7. Disable IK / switch to Pose·Root·Bbox → both handles + markers disappear; re-enabling IK starts with the END handle active.
8. Repeat steps 1-3 in `pcd_label` (`--port 5186` → `/pcd_label/`) to confirm the shared kernel works in both apps.

- [ ] **Step 3: Final commit (empty if no file changes)**

```bash
git add -A
git commit -m "test(ik): single-active handle switch — suite green; manual checklist recorded" --allow-empty
```

---

## Self-Review

- **Spec §3 state model (default end, click-switch, reset on chain/IK/mode change, persist across sync)** → Task 1 `HandleSelection` (unit-tested) + Task 4 `bindChain`/`reset`/`select` wiring. ✓
- **Spec §3 select-by-identity (not blind toggle)** → Task 4 Step 4: `obj === endMarker → select('end')`, `obj === poleMarker → select('pole')`. ✓
- **Spec §4 visual: end=RGB arrows / grey cube; pole=arrows+cyan sphere / cyan sphere** → Task 2 (cube + setActive) + Task 3 (sphere persists + setActive). The cyan-arrow tint is intentionally NOT done (vendored TransformControls shares axis materials + restores `_color` on hover — re-tinting one instance risks tinting rootHandle/ikHandle); distinction is delivered by the persistent cyan sphere head (color) + cube-vs-sphere markers (shape), which satisfies the confirmed "color+shape" decision robustly. ✓ (documented deviation)
- **Spec §5 pickup: plugin-local pointerup, 4px threshold, raycast markers only, no switch while dragging, TC consumes arrows first** → Task 4 Step 4. ✓
- **Spec §5 markers managed for show/hide; syncHook decides arrows vs marker; fall-through detaches both** → Task 4 Step 3. ✓
- **Spec §6 zero app.js change; ctx already sufficient (canvas/camera/scene present)** → Task 4 uses only `ctx.canvas`/`ctx.camera`/`ctx.requestSync`, all already provided. ✓
- **Spec §6 test strategy: state machine unit-tested, rest browser-verified** → Task 1 tests + Task 5 checklist. ✓
- **Spec §7 scope: no solver/storage change, no hotkey/button, JointPicker untouched** → Tasks only touch handle_selection/ik_handle/pole_handle/ik_plugin; no joint_picker.js edit. ✓
- **Placeholder scan:** every code step shows complete code. ✓
- **Name consistency:** `HandleSelection.active()/select()/bindChain()/reset()`, `setActive(bool)`, `markerMesh()` used identically across Tasks 1-4. ✓
