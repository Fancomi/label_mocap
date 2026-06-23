# Pole Vector Controllers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Maya-style pole-vector handles to the elbow/knee of each IK limb so users control which way the hinge bends, reusing the existing `solveTwoBoneIK` pole channel.

**Architecture:** All logic lives in the shared `smpl_edit` kernel + `ik_plugin`, so `label` and `pcd` get the feature automatically with zero app.js change. A pole handle is dragged → controller applies a single rigid rotation about the root→end axis to the limb's root joint (shoulder/hip), keeping elbow/wrist local quats fixed (end-locked, plane-only). Pole world positions persist sparsely per-frame in `player_0.json` under a new `pole_vectors` field; absence = today's auto-derived bend.

**Tech Stack:** Vanilla ES modules, three.js (vendored, browser-only), `node --test` for pure-logic unit tests. No build step.

---

## File Structure

- **Create** `smpl_edit/pole_handle.js` — browser-only draggable handle (TransformControls translate + visible sphere), mirrors `ik_handle.js`. Not unit-tested (three.js/DOM).
- **Create** `smpl_edit/tests/ik_pole.test.js` — pure-logic tests for the controller's pole math + storage round-trip.
- **Modify** `smpl_edit/ik_controller.js` — add `beginPoleDrag`, `solveToPole`, `endPoleDrag`, `autoPoleViz`, `storedPole`; make `solveTo` consume a stored/user pole.
- **Modify** `smpl_edit/ik_plugin.js` — instantiate a `PoleHandle` alongside `IKHandle`; attach both on limb select; wire storage write on pole-drag end.
- **Modify** `smpl_edit/coco_document.js` — add `'pole_vectors'` to `EDITABLE`.
- **Modify** `smpl_edit/annotation_store.js` — `addFromPrevious` sparsely copies `pole_vectors`.

**Chain names** (from `ik_chains.js`): `L_Arm` `[16,18,20]`, `R_Arm` `[17,19,21]`, `L_Leg` `[1,4,7]`, `R_Leg` `[2,5,8]`; `bodyIdx = joints − 1`.

---

## Task 1: Storage — `pole_vectors` is an editable field

**Files:**
- Modify: `smpl_edit/coco_document.js:2`
- Test: `smpl_edit/tests/coco_document.test.js`

- [ ] **Step 1: Write the failing test**

Append to `smpl_edit/tests/coco_document.test.js`:

```javascript
test('pole_vectors round-trips sparsely; untouched chains stay absent', () => {
  const doc = new CocoDocument({
    images: [{ id: 5 }],
    annotations: [{ id: 0, image_id: 5, bbox: [0, 0, 1, 1] }],
  });
  doc.setAnnotation(5, { pole_vectors: { L_Arm: [0.1, 0.2, 0.3] } });
  const out = doc.serialize();
  const a = out.annotations.find((x) => x.image_id === 5);
  assert.deepEqual(a.pole_vectors, { L_Arm: [0.1, 0.2, 0.3] });
  assert.equal('R_Arm' in a.pole_vectors, false);
});

test('annotation with no pole_vectors serializes without the field', () => {
  const doc = new CocoDocument({
    images: [{ id: 7 }],
    annotations: [{ id: 1, image_id: 7, bbox: [0, 0, 1, 1] }],
  });
  doc.setAnnotation(7, { root_rota: [0, 0, 0] });
  const a = doc.serialize().annotations.find((x) => x.image_id === 7);
  assert.equal('pole_vectors' in a, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test smpl_edit/tests/coco_document.test.js`
Expected: FAIL — first test fails because `pole_vectors` is not in `EDITABLE`, so `setAnnotation` ignores it and `a.pole_vectors` is `undefined`.

- [ ] **Step 3: Add `pole_vectors` to EDITABLE**

In `smpl_edit/coco_document.js:2`, change the `EDITABLE` array to include `'pole_vectors'`:

```javascript
const EDITABLE = ['bbox', 'root_pos', 'root_rota', 'body_pose', 'betas', 'keypoints', 'occlution_joint', 'pole_vectors'];
```

(Do NOT add `pole_vectors` to `defaultAnnotation` — absence is the sparse default and the second test pins this.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test smpl_edit/tests/coco_document.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add smpl_edit/coco_document.js smpl_edit/tests/coco_document.test.js
git commit -m "feat(ik): pole_vectors is an editable, sparsely-persisted field"
```

---

## Task 2: `addFromPrevious` sparsely inherits `pole_vectors`

**Files:**
- Modify: `smpl_edit/annotation_store.js:51-54`
- Test: `smpl_edit/tests/annotation_store.test.js`

- [ ] **Step 1: Write the failing test**

Append to `smpl_edit/tests/annotation_store.test.js` (match the file's existing harness for building a store; if it constructs a `CocoDocument` + `AnnotationStore`, follow that exact pattern — read the top of the file first):

```javascript
test('addFromPrevious copies pole_vectors when the source frame has them', () => {
  const doc = new CocoDocument({
    images: [{ id: 1 }, { id: 2 }],
    annotations: [{ id: 0, image_id: 1, bbox: [0, 0, 1, 1], root_pos: [0, 0, -4], root_rota: [0, 0, 0], body_pose: Array(63).fill(0), betas: Array(10).fill(0), pole_vectors: { L_Arm: [1, 2, 3] } }],
  });
  const store = new AnnotationStore(doc);
  store.setFrame(1); // second image (id=2), empty
  store.addFromPrevious();
  assert.deepEqual(store.current().pole_vectors, { L_Arm: [1, 2, 3] });
});

test('addFromPrevious omits pole_vectors when the source has none', () => {
  const doc = new CocoDocument({
    images: [{ id: 1 }, { id: 2 }],
    annotations: [{ id: 0, image_id: 1, bbox: [0, 0, 1, 1], root_pos: [0, 0, -4], root_rota: [0, 0, 0], body_pose: Array(63).fill(0), betas: Array(10).fill(0) }],
  });
  const store = new AnnotationStore(doc);
  store.setFrame(1);
  store.addFromPrevious();
  assert.equal('pole_vectors' in store.current(), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test smpl_edit/tests/annotation_store.test.js`
Expected: FAIL — first test fails: `addFromPrevious` does not copy `pole_vectors`, so `store.current().pole_vectors` is `undefined`.

- [ ] **Step 3: Sparsely copy `pole_vectors` in `addFromPrevious`**

In `smpl_edit/annotation_store.js`, change the `addFromPrevious` body (lines 51-54) so the fields object conditionally includes `pole_vectors` only when the source has it:

```javascript
  addFromPrevious() {
    let src = null;
    for (let i = this._frame - 1; i >= 0; i--) {
      const a = this._doc.getAnnotation(this._ids[i]);
      if (a) { src = a; break; }
    }
    if (!src) { this.addTpose(); return; }
    const fields = {
      bbox: src.bbox, root_pos: src.root_pos, root_rota: src.root_rota,
      body_pose: src.body_pose, betas: src.betas,
    };
    if (src.pole_vectors) fields.pole_vectors = src.pole_vectors;
    this._txn((id) => this._doc.setAnnotation(id, fields));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test smpl_edit/tests/annotation_store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add smpl_edit/annotation_store.js smpl_edit/tests/annotation_store.test.js
git commit -m "feat(ik): addFromPrevious sparsely inherits pole_vectors"
```

---

## Task 3: Controller — end-locked pole drag (the core invariant)

This is the heart of the feature. Dragging the pole rotates the whole limb rigidly about the root→end axis: the end (wrist/ankle) world position is unchanged, the bend angle is unchanged, and **only the limb-root joint's (shoulder/hip) local quaternion changes** — elbow/knee and wrist/ankle local quats are byte-for-byte unchanged.

**Files:**
- Modify: `smpl_edit/ik_controller.js`
- Test: `smpl_edit/tests/ik_pole.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `smpl_edit/tests/ik_pole.test.js`:

```javascript
// smpl_edit/tests/ik_pole.test.js
// Pole-vector drag: end-locked, plane-only. Verifies the limb rotates rigidly
// about the root→end axis — only the root joint's local quat changes; the
// mid (elbow/knee) and end (wrist/ankle) local quats are unchanged.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadModelFromFiles } from '../../smpl_core/smpl_model.js';
import { forwardSmpl } from '../../smpl_core/lbs.js';
import { RotationState } from '../rotation_state.js';
import { IKController } from '../ik_controller.js';

const model = await loadModelFromFiles(
  new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url),
  async (u) => new Uint8Array(await readFile(u)));

function harness() {
  // Start from a slightly bent arm so the bend plane is well-defined.
  const body = Array(63).fill(0);
  body[15 * 3 + 1] = 0.4; // L elbow (bodyIdx 17 → 关节18) small bend on Y
  let rotation = RotationState.fromAxisAngle({ root_rota: [0, 0, 0], body_pose: body });
  let lastJoints = null, lastWorldRot = null;
  let poleStore = {}; // chainName -> [x,y,z]
  const refresh = () => {
    const { root_rota, body_pose } = rotation.toAxisAngle();
    const o = forwardSmpl(model, { root_pos: [0, 0, -4], root_rota, body_pose, betas: Array(10).fill(0) }, { worldRot: true });
    lastJoints = o.joints; lastWorldRot = o.worldRot;
  };
  refresh();
  const store = {
    beginEdit() {}, commitEdit() {},
    current: () => ({ pole_vectors: poleStore }),
    applyFields: (f) => { if (f.pole_vectors) poleStore = f.pole_vectors; },
  };
  const ik = new IKController({
    getRotation: () => rotation, getStore: () => store,
    getLastJoints: () => lastJoints, getLastWorldRot: () => lastWorldRot,
    getSkeleton: () => 'smpl', getParents: () => model.parents, onEdit: () => refresh(),
  });
  return { ik, rotation: () => rotation, joints: () => lastJoints, poleStore: () => poleStore };
}

const j3 = (a, i) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
const qclose = (a, b, eps = 1e-6) => {
  // quats equal up to sign
  const same = Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps && Math.abs(a[3] - b[3]) < eps;
  const neg = Math.abs(a[0] + b[0]) < eps && Math.abs(a[1] + b[1]) < eps && Math.abs(a[2] + b[2]) < eps && Math.abs(a[3] + b[3]) < eps;
  return same || neg;
};

test('pole drag keeps end position fixed (end-locked)', () => {
  const { ik, joints } = harness();
  const chain = ik.chainFor(20); // L_Arm
  const root = j3(joints(), 16), end0 = j3(joints(), 20);
  ik.beginPoleDrag(chain);
  // Pole somewhere off to the side of the limb.
  ik.solveToPole([root[0] + 0.3, root[1] + 0.2, root[2] + 0.1]);
  ik.endPoleDrag();
  const end1 = j3(joints(), 20);
  const err = Math.hypot(end1[0] - end0[0], end1[1] - end0[1], end1[2] - end0[2]);
  assert.ok(err < 1e-3, `end moved by ${err}`);
});

test('pole drag changes ONLY the root joint local quat; elbow & wrist unchanged', () => {
  const { ik, rotation, joints } = harness();
  const chain = ik.chainFor(20); // L_Arm, bodyIdx [15,17,19]
  const [bShoulder, bElbow] = chain.bodyIdx; // 15, 17
  const shoulder0 = rotation().getJointQuat(bShoulder).slice();
  const elbow0 = rotation().getJointQuat(bElbow).slice();
  const root = j3(joints(), 16);
  ik.beginPoleDrag(chain);
  ik.solveToPole([root[0] + 0.3, root[1] + 0.25, root[2] + 0.15]);
  ik.endPoleDrag();
  const shoulder1 = rotation().getJointQuat(bShoulder);
  const elbow1 = rotation().getJointQuat(bElbow);
  assert.equal(qclose(elbow0, elbow1), true, 'elbow local quat must be unchanged');
  assert.equal(qclose(shoulder0, shoulder1), false, 'shoulder local quat must change');
});

test('pole drag persists the world pole into store on end', () => {
  const { ik, joints, poleStore } = harness();
  const chain = ik.chainFor(20);
  const root = j3(joints(), 16);
  const world = [root[0] + 0.3, root[1] + 0.2, root[2] + 0.1];
  ik.beginPoleDrag(chain);
  ik.solveToPole(world);
  ik.endPoleDrag();
  assert.deepEqual(poleStore().L_Arm, world);
});

test('endPoleDrag clears reference; solveToPole after is a no-op', () => {
  const { ik } = harness();
  ik.endPoleDrag();
  ik.solveToPole([0, 0, -3]); // no ref → must not throw
  assert.ok(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test smpl_edit/tests/ik_pole.test.js`
Expected: FAIL — `ik.beginPoleDrag is not a function` (methods don't exist yet).

- [ ] **Step 3: Implement pole-drag methods in the controller**

Add these imports at the top of `smpl_edit/ik_controller.js` if not already present — `shortestArcQuat` is already imported from `./ik_solver.js`; `quatMultiply`, `quatConjugate`, `quatNormalize`, `mat3ToQuat` are already imported from `../smpl_core/rotations.js`. No new imports needed.

Add three methods to the `IKController` class (place after `solveTo`, before the closing brace):

```javascript
  // ── Pole-vector drag ──────────────────────────────────────────────────
  // End-locked, plane-only: the limb rotates rigidly about the root→end axis.
  // Only the root joint (shoulder/hip) local quat changes; mid/end locals are
  // left untouched, so FK carries them rigidly. This is the analytic form of
  // "re-solve with new pole while end stays fixed".
  beginPoleDrag(chain) {
    this.beginDrag(chain); // reuse the same frozen reference (root/upper0/dir/parentShoulderWorld)
    if (this._ref) this._ref.poleDrag = true;
  }

  // worldPole: world-space point the pole handle was dragged to.
  solveToPole(worldPole) {
    const ref = this._ref;
    const rot = this._getRotation();
    if (!ref || !rot) return;

    const dir = norm(sub(ref.endRef, ref.root));         // frozen root→end axis
    const oldBend = ref.perp0;                            // frozen bend direction (⊥ dir)
    // New bend = pole projected onto the plane ⊥ dir.
    let newBend = sub(sub(worldPole, ref.root), scale(dir, dot(sub(worldPole, ref.root), dir)));
    if (len(newBend) < 1e-6) return;                      // pole collinear with axis → ignore this step
    newBend = norm(newBend);

    // Rigid rotation about dir that maps oldBend → newBend (both ⊥ dir, so the
    // shortest arc between them is a pure rotation about dir).
    const R = shortestArcQuat(oldBend, newBend);
    const shoulderWorldNew = quatNormalize(quatMultiply(R, ref.shoulderWorld0));
    const shoulderLocal = quatNormalize(quatMultiply(quatConjugate(ref.parentShoulderWorld), shoulderWorldNew));

    rot.setJointQuat(ref.chain.bodyIdx[0], shoulderLocal); // ONLY the root joint; elbow/wrist untouched
    this._lastPoleWorld = worldPole.slice();
    this._getStore().applyFields(rot.toAxisAngle());
    this._onEdit();
  }

  endPoleDrag() {
    const ref = this._ref;
    if (ref && this._lastPoleWorld) {
      const cur = this._getStore().current?.() ?? null;
      const existing = (cur && cur.pole_vectors) ? cur.pole_vectors : {};
      this._getStore().applyFields({ pole_vectors: { ...existing, [ref.chain.name]: this._lastPoleWorld } });
    }
    this._lastPoleWorld = null;
    this._ref = null;
  }
```

Note: `sub`, `scale`, `dot`, `len`, `norm` are the module-level helpers already defined at the top of `ik_controller.js` (lines 12-17). `shortestArcQuat(oldBend, newBend)` where both vectors are perpendicular to `dir` yields a rotation whose axis is `oldBend × newBend` — which is parallel to `dir` — so it is a pure rotation about the root→end axis, exactly the Maya pole behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test smpl_edit/tests/ik_pole.test.js`
Expected: PASS (all four tests). If "shoulder must change" fails because the chosen pole happens to be collinear with `oldBend`, the test already offsets the pole on multiple axes; verify the harness arm is bent (the `body[15*3+1] = 0.4` line gives a non-degenerate `perp0`).

- [ ] **Step 5: Commit**

```bash
git add smpl_edit/ik_controller.js smpl_edit/tests/ik_pole.test.js
git commit -m "feat(ik): end-locked pole drag rotates only the limb-root joint"
```

---

## Task 4: Controller — end-target IK consumes a stored pole

When the user drags the END handle (normal IK) and this chain already has a stored/user pole, the bend should follow that pole instead of the auto hinge×dir. This makes the two handles interoperate (robustness matrix #5).

**Files:**
- Modify: `smpl_edit/ik_controller.js` (the `solveTo` method, and add `storedPole`/`autoPoleViz` helpers)
- Test: `smpl_edit/tests/ik_pole.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `smpl_edit/tests/ik_pole.test.js`:

```javascript
test('storedPole reads the persisted world pole for a chain', () => {
  const { ik, joints } = harness();
  const chain = ik.chainFor(20);
  const root = j3(joints(), 16);
  const world = [root[0] + 0.3, root[1] + 0.2, root[2] + 0.1];
  ik.beginPoleDrag(chain);
  ik.solveToPole(world);
  ik.endPoleDrag();
  assert.deepEqual(ik.storedPole('L_Arm'), world);
  assert.equal(ik.storedPole('R_Arm'), null);
});

test('autoPoleViz returns a world point on the current bend side', () => {
  const { ik, joints } = harness();
  const chain = ik.chainFor(20);
  const viz = ik.autoPoleViz(chain);
  assert.equal(viz.length, 3);
  assert.ok(Number.isFinite(viz[0]) && Number.isFinite(viz[1]) && Number.isFinite(viz[2]));
});

test('end-target IK with a stored pole bends toward the pole side', () => {
  const { ik, rotation, joints } = harness();
  const chain = ik.chainFor(20);
  const root = j3(joints(), 16);
  // Persist a pole, then drag the end handle a little; solve must not throw and
  // must keep producing a valid (finite) pose driven by the stored pole.
  ik.beginPoleDrag(chain);
  ik.solveToPole([root[0] + 0.3, root[1] + 0.25, root[2] + 0.15]);
  ik.endPoleDrag();
  const end = j3(joints(), 20);
  ik.beginDrag(chain);
  ik.solveTo([end[0] + 0.02, end[1] - 0.02, end[2]]);
  ik.endDrag();
  const elbow = j3(joints(), 18);
  assert.ok(elbow.every(Number.isFinite), 'elbow must be finite');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test smpl_edit/tests/ik_pole.test.js`
Expected: FAIL — `ik.storedPole is not a function`.

- [ ] **Step 3: Add `storedPole`, `autoPoleViz`, and make `solveTo` consume the pole**

Add two helper methods to `IKController`:

```javascript
  // Read the persisted world pole for a chain name, or null.
  storedPole(chainName) {
    const cur = this._getStore().current?.() ?? null;
    const pv = cur && cur.pole_vectors;
    return (pv && pv[chainName]) ? pv[chainName] : null;
  }

  // World point visualizing the auto-derived bend direction, for placing the
  // handle when no pole is stored yet: chainRoot + perp0 * upperBoneLength.
  autoPoleViz(chain) {
    const joints = this._getLastJoints();
    const [jRoot, jMid, jEnd] = chain.joints;
    const root = j3(joints, jRoot), mid = j3(joints, jMid), end = j3(joints, jEnd);
    const upper0 = sub(mid, root);
    const dir0 = norm(sub(end, root));
    const perp0 = norm(sub(upper0, scale(dir0, dot(upper0, dir0))));
    const L = len(upper0);
    return [root[0] + perp0[0] * L, root[1] + perp0[1] * L, root[2] + perp0[2] * L];
  }
```

Then modify the bend computation inside `solveTo` (currently lines 86-90). Replace:

```javascript
    const dir = norm(sub(target, ref.root));
    // 铰链弯曲方向:hinge × dir 已垂直于 dir;目标与铰链轴近平行时回退到参考弯曲侧。
    let bend = cross(ref.hinge, dir);
    if (len(bend) < 1e-5) bend = ref.perp0;
    bend = scale(norm(bend), ref.sign);
```

with:

```javascript
    const dir = norm(sub(target, ref.root));
    // 优先用存储的人控 pole:把它投影到 ⊥dir 平面得到弯曲方向(已隐含侧别,不再乘 sign)。
    // 无存储 pole 或投影退化时,回退到原自动铰链方向 sign·(hinge×dir),再退到 perp0。
    let bend = null;
    const userPole = this.storedPole(ref.chain.name);
    if (userPole) {
      const rel = sub(userPole, ref.root);
      const proj = sub(rel, scale(dir, dot(rel, dir)));
      if (len(proj) >= 1e-5) bend = norm(proj);
    }
    if (!bend) {
      bend = cross(ref.hinge, dir);
      if (len(bend) < 1e-5) bend = ref.perp0;
      bend = scale(norm(bend), ref.sign);
    }
```

(The rest of `solveTo` — `solveTwoBoneIK`, the two `shortestArcQuat` world updates, the two `setJointQuat` calls, `applyFields`, `onEdit` — is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test smpl_edit/tests/ik_pole.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Run the full controller + solver suite to confirm no regression**

Run: `node --test smpl_edit/tests/ik_controller.test.js smpl_edit/tests/ik_solver.test.js`
Expected: PASS — existing end-target IK tests still pass (no stored pole → unchanged auto behavior).

- [ ] **Step 6: Commit**

```bash
git add smpl_edit/ik_controller.js smpl_edit/tests/ik_pole.test.js
git commit -m "feat(ik): end-target IK consumes stored pole; add storedPole/autoPoleViz"
```

---

## Task 5: `PoleHandle` — browser-only draggable handle with visible sphere

Mirrors `ik_handle.js` but adds a visible sphere (distinct color) so the pole point is pickable on its own, not only via TransformControls arrows. Browser-only; not unit-tested per CLAUDE.md.

**Files:**
- Create: `smpl_edit/pole_handle.js`

- [ ] **Step 1: Write the handle**

Create `smpl_edit/pole_handle.js`:

```javascript
// smpl_edit/pole_handle.js — 极向量拖拽手柄。
// 镜像 ik_handle.js(TransformControls translate),但额外挂一个可见小球(青色),
// 让极向量点本身可见、可点选。拖拽中回调 onDrag(worldPos),由 IKController 据此
// 做「末端锁定、仅旋转弯折平面」的反解。
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { tightenTranslatePicker } from './transform_picker.js';

export class PoleHandle {
  constructor({ scene, camera, canvas, controls, getStore, onStart, onDrag, onEnd }) {
    this._scene = scene;
    this._controls = controls;
    this._getStore = getStore;
    this._onStart = onStart;
    this._onDrag = onDrag;
    this._onEnd = onEnd;
    this._attached = false;

    // 代理对象 + 可见小球(子节点,随代理移动)。
    this._proxy = new THREE.Object3D();
    this._sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x00d0d0, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this._sphere.renderOrder = 999;
    this._proxy.add(this._sphere);

    this._tc = new TransformControls(camera, canvas);
    this._tc.setMode('translate');
    tightenTranslatePicker(this._tc);
    this._tc.attach(this._proxy);

    this._tc.addEventListener('mouseDown', () => { this._getStore().beginEdit(); if (this._onStart) this._onStart(); });
    this._tc.addEventListener('objectChange', () => {
      const p = this._proxy.position;
      this._onDrag([p.x, p.y, p.z]);
    });
    this._tc.addEventListener('mouseUp', () => { if (this._onEnd) this._onEnd(); this._getStore().commitEdit(); });
  }

  attach(pos) {
    if (pos) this._proxy.position.set(pos[0], pos[1], pos[2]);
    if (!this._attached) {
      this._scene.add(this._proxy);
      this._scene.add(this._tc);
      this._attached = true;
    }
    this._tc.visible = true;
    this._tc.enabled = true;
    this._sphere.visible = true;
  }

  detach() {
    if (!this._attached) return;
    this._tc.visible = false;
    this._tc.enabled = false;
    this._sphere.visible = false;
    this._scene.remove(this._tc);
    this._scene.remove(this._proxy);
    this._attached = false;
  }

  update() { /* TransformControls 自动跟随相机更新 */ }

  isEngaged() { return !!(this._tc && (this._tc.dragging || this._tc.axis != null)); }
  isDragging() { return !!(this._tc && this._tc.dragging); }
}
```

- [ ] **Step 2: Verify the module imports cleanly (syntax check)**

Run: `node --input-type=module -e "import('./smpl_edit/pole_handle.js').catch(e => { if (String(e).includes('three')) { console.log('OK: only the vendored three import is unresolved under node, which is expected'); } else { console.error(e); process.exit(1); } })"`
Expected: prints the OK line (three.js resolves only via the browser importmap; a bare `three` specifier failing under node is expected and fine). If a *syntax* error is reported instead, fix it.

- [ ] **Step 3: Commit**

```bash
git add smpl_edit/pole_handle.js
git commit -m "feat(ik): PoleHandle — draggable pole vector handle with visible sphere"
```

---

## Task 6: Wire `PoleHandle` into `ik_plugin`

Instantiate the pole handle alongside the existing IK handle; attach both when a limb end is selected; register it in the guard aggregate; detach on uninstall.

**Files:**
- Modify: `smpl_edit/ik_plugin.js`

- [ ] **Step 1: Import and instantiate the pole handle**

In `smpl_edit/ik_plugin.js`, add the import next to the existing ones (after line 11):

```javascript
import { PoleHandle } from './pole_handle.js';
```

After the `ikHandle` instantiation block (after line 42), add the pole handle. It reuses the same `ctx`:

```javascript
  // 极向量手柄:按下冻结参考、拖拽仅旋转弯折平面、松开把世界 pole 写入存储。
  const poleHandle = new PoleHandle({
    scene: ctx.scene.threeScene(),
    camera: ctx.camera,
    canvas: ctx.canvas,
    controls: ctx.controls,
    getStore: ctx.getStore,
    onStart: () => {
      const chain = ikController.chainFor((ctx.getUI()?.selectedJoint ?? -1) + 1);
      if (chain) ikController.beginPoleDrag(chain);
    },
    onDrag: (worldPos) => ikController.solveToPole(worldPos),
    onEnd: () => ikController.endPoleDrag(),
  });
  ctx.registerGuard(poleHandle);
```

- [ ] **Step 2: Attach/detach the pole handle in `syncHook`**

In `syncHook` (lines 59-77), the IK branch currently attaches only `ikHandle`. Update the branch so it also attaches the pole handle (at the stored pole if present, else the auto-viz point), and the fall-through detaches both. Replace the body from `const sel = ui.selectedJoint;` to the end of the function with:

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

- [ ] **Step 3: Detach the pole handle on uninstall**

In the returned `uninstallIK` function (lines 81-87), add `poleHandle.detach();` next to `ikHandle.detach();`:

```javascript
  return function uninstallIK() {
    ctx.toggleButton.removeEventListener('click', onToggleClick);
    ctx.toggleButton.classList.remove('on');
    ctx.toggleButton.hidden = true;
    ikHandle.detach();
    poleHandle.detach();
    ctx.jointGridButtons.forEach((b) => { b.disabled = false; b.classList.remove('ik'); });
  };
```

- [ ] **Step 4: Confirm no app.js change is needed (read-only verification)**

Run: `grep -n "installIK\|syncUI\|requestSync" label/src/app.js pcd_label/src/app.js`
Expected: `installIK(...)` is called with a ctx that already provides `scene`, `camera`, `canvas`, `controls`, `getStore`, `getUI`, `getLastJoints`, `isPlaying`, `getMode`, `registerGuard`, `registerSyncHook`, `requestSync`. If any of these is missing for a given app, note it — but per the design the existing IK handle already uses all of them, so no new ctx field is required. Record the finding; do not edit app.js unless a field is genuinely absent.

- [ ] **Step 5: Commit**

```bash
git add smpl_edit/ik_plugin.js
git commit -m "feat(ik): wire PoleHandle into ik_plugin alongside the end handle"
```

---

## Task 7: Full suite + manual-verification checklist

**Files:** none (verification only)

- [ ] **Step 1: Run the full web test suite**

Run: `npm run test:web`
Expected: PASS, 0 failures. Confirms storage, controller, and all existing kernels are green together.

- [ ] **Step 2: Record the browser manual-verification checklist**

These cannot be unit-tested (three.js/WebGL/DOM). Note them in the commit/PR body for the human to run via `npm run serve:label` → open `/label/`:

1. Enable IK, select a wrist/ankle → two handles appear (end handle + cyan pole sphere).
2. Drag the pole sphere → wrist/ankle stays put, the limb swings about the shoulder/hip-to-end axis (elbow/knee plane rotates).
3. Switch to the other arm/leg → handles re-attach to the new limb.
4. Drag pole, change frame, return → pole handle reappears at the stored position; an un-poled frame shows the auto position.
5. Translate root after setting a pole → pose stays sane (projection fallback); handle may visually lag until re-dragged.
6. Undo once after a pole drag → both the pose and the stored pole revert together.
7. Disable IK / switch to Pose/Root/Bbox → both handles disappear; re-enabling IK restores the stored pole.
8. Save → `player_0.json` contains a sparse `pole_vectors` only for dragged limbs.
9. Repeat steps 1-2 in `pcd_label` (`npm run serve:pcd` → `/pcd_label/`) to confirm the shared kernel works in both apps.

- [ ] **Step 3: Final commit (if any docs/notes changed)**

```bash
git add -A
git commit -m "test(ik): pole vector controllers — full suite green; manual checklist recorded" --allow-empty
```

---

## Self-Review

- **Spec §3 data model** → Task 1 (`pole_vectors` in EDITABLE, sparse) + Task 2 (`addFromPrevious` inheritance). ✓
- **Spec §4 drag semantics (end-locked, only root rotates)** → Task 3, pinned by the local-quat invariant test. ✓
- **Spec §4 two-handle interop + initial position** → Task 4 (`solveTo` consumes pole, `autoPoleViz`) + Task 6 (attach logic). ✓
- **Spec §5 robustness**: #4 atomic undo → Task 3/6 single begin/commit transaction; #5 stored-pole bend → Task 4; #6 sparse inherit → Task 2; #7 guard conflict → Task 6 `registerGuard`; #9/#11 no-data/playing → Task 6 reuses existing `isPlaying()`/`getLastJoints()` gates; #10 degenerate → Task 3 `len(newBend) < 1e-6` guard + solver fallback; #1/#8 reattach from store → Task 6 `storedPole`. ✓
- **Spec §6 two-app wiring, zero app.js change** → Task 6 Step 4 verifies ctx sufficiency. ✓
- **Spec §6 test strategy** → Tasks 1-4 are the pure-logic tests; Task 7 records the browser checklist. ✓
- **Placeholder scan**: every code step shows complete code. ✓
- **Type/name consistency**: `beginPoleDrag`/`solveToPole`/`endPoleDrag`/`storedPole`/`autoPoleViz` are used identically in controller, plugin, and tests; chain names `L_Arm`/`R_Arm`/`L_Leg`/`R_Leg` match `ik_chains.js`. ✓

**Note on a refinement vs. the literal spec wording:** the spec §4 step 2 said "re-call `solveTwoBoneIK` with the new pole." The plan implements the mathematically equivalent but stronger form — a single rigid rotation about the root→end axis applied to the limb-root joint only — because that pins the "elbow/wrist local quats unchanged" invariant exactly, whereas re-running the general `solveTo` (per-bone shortest-arc) could let a small twist leak into the elbow. Behavior matches the spec's intent; only the internal method differs.
