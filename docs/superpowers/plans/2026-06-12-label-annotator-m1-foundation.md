# SMPL Annotator — M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of the SMPL annotator: a shared `smpl_core` module, a single-source-of-truth rotation model, a robust frame loader (image-seq/video × full/none/partial data), a fidelity-preserving COCO document, an AnnotationStore, and an app skeleton that loads, renders, and navigates frames. No editing yet.

**Architecture:** Pure-logic modules (rotations, loader, COCO doc, store) are developed test-first with `node --test`. The three.js scene + camera are ported from the existing `smpl_viewer` and wired by `app.js`. AnnotationStore is the single source of truth; the scene subscribes to it.

**Tech Stack:** Vanilla ES modules, three.js (vendored), `node --test` for JS, existing static server for serving.

**Reference spec:** `docs/superpowers/specs/2026-06-12-label-mocap-annotator-design.md`

---

## Conventions

- Run JS tests from repo root with: `node --test label/tests/<file>.test.js`
- Commit after each task with the message shown in its final step.
- All new runtime code is ES modules (`"type": "module"` already set at repo root).

## File Structure (created/modified in M1)

- `smpl_core/lbs.js`, `math3d.js`, `smpl_model.js`, `smpl_worker.js` — moved from `smpl_web_viewer/src/smpl/`
- `smpl_core/rotations.js` — quaternion↔euler↔axis-angle↔mat3 conversions (new)
- `label/src/edit/rotation_state.js` — single-source quaternion store + euler draft (new)
- `label/src/io/coco_document.js` — COCO json fidelity read/edit/serialize (new)
- `label/src/io/source_loader.js` — frame union model + portrait detection (new)
- `label/src/edit/annotation_store.js` — per-frame annotation model + undo (new)
- `label/src/scene/scene.js`, `camera_modes.js` — ported from `smpl_viewer` (new)
- `label/src/app.js`, `label/index.html` — app skeleton (new)
- Modified: `smpl_web_viewer/src/**` and `smpl_viewer/*.js` import paths → `smpl_core`

---

## Task 1: Extract shared SMPL core

**Files:**
- Create: `smpl_core/lbs.js`, `smpl_core/math3d.js`, `smpl_core/smpl_model.js`, `smpl_core/smpl_worker.js` (moved)
- Modify: `smpl_web_viewer/src/app.js`, `smpl_web_viewer/src/debug/reference_mesh.js`, `smpl_web_viewer/src/viewer/*`, `smpl_viewer/viewer.js` import paths
- Modify: `smpl_web_viewer/tests/*.test.js` import paths

- [ ] **Step 1: Move the four SMPL files into `smpl_core/` preserving git history**

```bash
mkdir -p smpl_core
git mv smpl_web_viewer/src/smpl/lbs.js smpl_core/lbs.js
git mv smpl_web_viewer/src/smpl/math3d.js smpl_core/math3d.js
git mv smpl_web_viewer/src/smpl/smpl_model.js smpl_core/smpl_model.js
git mv smpl_web_viewer/src/smpl/smpl_worker.js smpl_core/smpl_worker.js
```

- [ ] **Step 2: Update all imports that referenced the moved files**

Find every importer:

```bash
grep -rn "smpl/lbs\|smpl/math3d\|smpl/smpl_model\|smpl/smpl_worker\|src/smpl" \
  smpl_web_viewer smpl_viewer --include="*.js"
```

For each hit, rewrite the specifier to the new relative path to `smpl_core/`. Examples:
- In `smpl_web_viewer/src/app.js`: `'./smpl/smpl_model.js'` → `'../../smpl_core/smpl_model.js'`
- In `smpl_web_viewer/src/app.js` worker URL: `new URL('./smpl/smpl_worker.js', import.meta.url)` → `new URL('../../smpl_core/smpl_worker.js', import.meta.url)`
- In `smpl_web_viewer/tests/lbs.test.js`: `'../src/smpl/lbs.js'` → `'../../smpl_core/lbs.js'`
- In `smpl_viewer/viewer.js`: `'../smpl_web_viewer/src/smpl/smpl_model.js'` → `'../smpl_core/smpl_model.js'`

`smpl_core/lbs.js` imports `./math3d.js` — same directory, no change needed.

- [ ] **Step 3: Run the full existing suite to verify zero regression**

Run: `npm test`
Expected: PASS — same test counts as before the move (web JS + python tools + server).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(smpl_core): extract shared SMPL kernel for reuse by label app"
```

---

## Task 2: Rotation conversions (`smpl_core/rotations.js`)

Quaternion is the hub. This module provides lossless conversions to/from the three views. Quaternion format: `[x, y, z, w]`. Euler order: intrinsic `XYZ` in radians. Axis-angle: `[rx, ry, rz]` (magnitude = angle).

**Files:**
- Create: `smpl_core/rotations.js`
- Test: `label/tests/rotations.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  axisAngleToQuat, quatToAxisAngle,
  eulerXYZToQuat, quatToEulerXYZ,
  quatToMat3, quatMultiply, quatNormalize,
} from '../../smpl_core/rotations.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const arrClose = (a, b, eps = 1e-6) => { assert.equal(a.length, b.length); a.forEach((v, i) => close(v, b[i], eps)); };

test('axis-angle ↔ quat round-trips for a generic rotation', () => {
  const aa = [0.3, -1.1, 0.7];
  const q = axisAngleToQuat(aa);
  arrClose(quatToAxisAngle(q), aa);
});

test('zero axis-angle maps to identity quat', () => {
  arrClose(axisAngleToQuat([0, 0, 0]), [0, 0, 0, 1]);
});

test('euler XYZ ↔ quat round-trips away from gimbal lock', () => {
  const e = [0.4, 0.2, -0.9];
  arrClose(quatToEulerXYZ(eulerXYZToQuat(e)), e, 1e-5);
});

test('quatToMat3 gives a proper rotation matrix (orthonormal, det 1)', () => {
  const m = quatToMat3(axisAngleToQuat([0, Math.PI / 2, 0])); // 90° about Y
  // rotates +X(1,0,0) to -Z(0,0,-1)
  arrClose([m[0], m[3], m[6]], [0, 0, -1], 1e-6);
});

test('quatMultiply composes rotations (q2 after q1)', () => {
  const q1 = axisAngleToQuat([0, 0, Math.PI / 2]);
  const q2 = axisAngleToQuat([0, 0, Math.PI / 2]);
  const aa = quatToAxisAngle(quatNormalize(quatMultiply(q2, q1)));
  close(Math.hypot(...aa), Math.PI, 1e-6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test label/tests/rotations.test.js`
Expected: FAIL — cannot find module `smpl_core/rotations.js`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// smpl_core/rotations.js — quaternion [x,y,z,w] is the hub format.

export function quatNormalize([x, y, z, w]) {
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

export function axisAngleToQuat([x, y, z]) {
  const angle = Math.hypot(x, y, z);
  if (angle < 1e-12) return [0, 0, 0, 1];
  const s = Math.sin(angle / 2) / angle;
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
}

export function quatToAxisAngle([x, y, z, w]) {
  const cw = Math.min(1, Math.max(-1, w));
  const angle = 2 * Math.acos(cw);
  const s = Math.sqrt(Math.max(0, 1 - cw * cw));
  if (s < 1e-9) return [0, 0, 0];
  const k = angle / s;
  return [x * k, y * k, z * k];
}

export function eulerXYZToQuat([rx, ry, rz]) {
  const qx = [Math.sin(rx / 2), 0, 0, Math.cos(rx / 2)];
  const qy = [0, Math.sin(ry / 2), 0, Math.cos(ry / 2)];
  const qz = [0, 0, Math.sin(rz / 2), Math.cos(rz / 2)];
  return quatMultiply(qz, quatMultiply(qy, qx)); // intrinsic XYZ
}

export function quatToEulerXYZ([x, y, z, w]) {
  // intrinsic XYZ from rotation matrix
  const m = quatToMat3([x, y, z, w]);
  const sy = m[2]; // m[0][2]
  let rx, ry, rz;
  if (Math.abs(sy) < 1 - 1e-7) {
    ry = Math.asin(sy);
    rx = Math.atan2(-m[5], m[8]);
    rz = Math.atan2(-m[1], m[0]);
  } else {
    ry = Math.asin(Math.min(1, Math.max(-1, sy)));
    rx = Math.atan2(m[7], m[4]);
    rz = 0;
  }
  return [rx, ry, rz];
}

export function quatToMat3([x, y, z, w]) {
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return new Float32Array([
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ]);
}

export function quatMultiply([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test label/tests/rotations.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add smpl_core/rotations.js label/tests/rotations.test.js
git commit -m "feat(smpl_core): add quaternion-hub rotation conversions"
```

---

## Task 3: RotationState (single source + euler draft)

Holds the canonical quaternions (root + 21 joints) for one annotation. Editing views read/write through it. Euler drafts prevent value jumping while the quaternion is unchanged.

**Files:**
- Create: `label/src/edit/rotation_state.js`
- Test: `label/tests/rotation_state.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RotationState } from '../src/edit/rotation_state.js';
import { quatToAxisAngle } from '../../smpl_core/rotations.js';

const arrClose = (a, b, eps = 1e-5) => { assert.equal(a.length, b.length); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= eps, `${v} != ${b[i]}`)); };

test('fromAxisAngle stores root + 21 joints as quaternions', () => {
  const s = RotationState.fromAxisAngle({ root_rota: [0, 0, 0], body_pose: Array(63).fill(0) });
  arrClose(s.getJointQuat(0), [0, 0, 0, 1]);
  assert.equal(s.jointCount, 21);
});

test('toAxisAngle round-trips root_rota and body_pose', () => {
  const root = [0.1, -0.2, 0.3];
  const body = Array.from({ length: 63 }, (_, i) => (i % 7) * 0.01);
  const s = RotationState.fromAxisAngle({ root_rota: root, body_pose: body });
  const out = s.toAxisAngle();
  arrClose(out.root_rota, root);
  arrClose(out.body_pose, body);
});

test('setJointEuler updates the quaternion source and notifies', () => {
  const s = RotationState.fromAxisAngle({ root_rota: [0, 0, 0], body_pose: Array(63).fill(0) });
  let fired = 0;
  s.onChange(() => { fired++; });
  s.setJointEuler(2, [0, Math.PI / 2, 0]);
  fired === 0 && assert.fail('change listener not called');
  arrClose(quatToAxisAngle(s.getJointQuat(2)), [0, Math.PI / 2, 0]);
});

test('euler draft is preserved until quaternion changes elsewhere', () => {
  const s = RotationState.fromAxisAngle({ root_rota: [0, 0, 0], body_pose: Array(63).fill(0) });
  s.setJointEuler(0, [Math.PI, 0, 0]); // a pole-ish value
  arrClose(s.getJointEuler(0), [Math.PI, 0, 0]);
  s.setJointEuler(1, [0.1, 0, 0]);     // different joint changes
  arrClose(s.getJointEuler(0), [Math.PI, 0, 0]); // joint 0 draft intact
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test label/tests/rotation_state.test.js`
Expected: FAIL — cannot find module `rotation_state.js`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// label/src/edit/rotation_state.js
import {
  axisAngleToQuat, quatToAxisAngle,
  eulerXYZToQuat, quatToEulerXYZ,
} from '../../../smpl_core/rotations.js';

const JOINTS = 21;

export class RotationState {
  constructor(rootQ, jointQ) {
    this._rootQ = rootQ;
    this._jointQ = jointQ;            // length 21, each [x,y,z,w]
    this._draftEuler = new Map();     // index (-1=root) -> [rx,ry,rz]
    this._listeners = new Set();
  }

  static fromAxisAngle({ root_rota, body_pose }) {
    const rootQ = axisAngleToQuat(root_rota);
    const jointQ = [];
    for (let j = 0; j < JOINTS; j++) {
      const k = j * 3;
      jointQ.push(axisAngleToQuat([body_pose[k], body_pose[k + 1], body_pose[k + 2]]));
    }
    return new RotationState(rootQ, jointQ);
  }

  get jointCount() { return JOINTS; }
  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _notify() { for (const fn of this._listeners) fn(); }

  getJointQuat(j) { return this._jointQ[j]; }
  getRootQuat() { return this._rootQ; }

  setJointQuat(j, q) { this._jointQ[j] = q; this._invalidateExcept(j); this._notify(); }
  setRootQuat(q) { this._rootQ = q; this._invalidateExcept(-1); this._notify(); }

  getJointEuler(j) {
    if (this._draftEuler.has(j)) return this._draftEuler.get(j);
    return quatToEulerXYZ(this._jointQ[j]);
  }
  getRootEuler() {
    if (this._draftEuler.has(-1)) return this._draftEuler.get(-1);
    return quatToEulerXYZ(this._rootQ);
  }

  setJointEuler(j, e) {
    this._jointQ[j] = eulerXYZToQuat(e);
    this._invalidateExcept(j);
    this._draftEuler.set(j, e.slice());
    this._notify();
  }
  setRootEuler(e) {
    this._rootQ = eulerXYZToQuat(e);
    this._invalidateExcept(-1);
    this._draftEuler.set(-1, e.slice());
    this._notify();
  }

  _invalidateExcept(keep) {
    for (const key of [...this._draftEuler.keys()]) {
      if (key !== keep) this._draftEuler.delete(key);
    }
  }

  toAxisAngle() {
    const root_rota = quatToAxisAngle(this._rootQ);
    const body_pose = new Array(JOINTS * 3);
    for (let j = 0; j < JOINTS; j++) {
      const aa = quatToAxisAngle(this._jointQ[j]);
      body_pose[j * 3] = aa[0]; body_pose[j * 3 + 1] = aa[1]; body_pose[j * 3 + 2] = aa[2];
    }
    return { root_rota, body_pose };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test label/tests/rotation_state.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add label/src/edit/rotation_state.js label/tests/rotation_state.test.js
git commit -m "feat(label): RotationState single-source quaternion store with euler drafts"
```

---

## Task 4: COCO document (fidelity read/edit/serialize)

Wraps a parsed COCO json. Preserves every field; exposes per-image-id annotation get/set/delete. `serialize()` returns a new object that differs from the input only in the fields we touched.

**Files:**
- Create: `label/src/io/coco_document.js`
- Test: `label/tests/coco_document.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CocoDocument } from '../src/io/coco_document.js';

function sampleDoc() {
  return {
    images: [{ file_name: '0000.jpg', width: 1920, height: 1080, id: 0 },
             { file_name: '0001.jpg', width: 1920, height: 1080, id: 1 }],
    annotations: [{
      id: 0, image_id: 0, bbox: [10, 20, 30, 40], keypoints: Array(156).fill(0),
      p3d: [1, 2, 3], iscrowd: 0, area: 5, category_id: 1,
      segmentation: [[1, 2, 3, 4]], occlution_joint: Array(52).fill(1),
      betas: Array(10).fill(0), root_pos: [0, 0, -4], root_rota: [0, 0, 0],
      body_pose: Array(63).fill(0), right_hand_pose: Array(45).fill(0), left_hand_pose: Array(45).fill(0),
    }],
    categories: [{ name: 'p', id: 1 }],
  };
}

test('getAnnotation returns the annotation for an image id, or null', () => {
  const doc = new CocoDocument(sampleDoc());
  assert.equal(doc.getAnnotation(0).bbox[0], 10);
  assert.equal(doc.getAnnotation(1), null);
});

test('imageIds returns every image id in order', () => {
  const doc = new CocoDocument(sampleDoc());
  assert.deepEqual(doc.imageIds(), [0, 1]);
});

test('serialize preserves untouched fields byte-for-byte', () => {
  const raw = sampleDoc();
  const doc = new CocoDocument(raw);
  const out = doc.serialize();
  assert.deepEqual(out.annotations[0].segmentation, [[1, 2, 3, 4]]);
  assert.deepEqual(out.annotations[0].right_hand_pose, Array(45).fill(0));
  assert.deepEqual(out.categories, [{ name: 'p', id: 1 }]);
});

test('setAnnotation merges editable fields, preserves the rest', () => {
  const doc = new CocoDocument(sampleDoc());
  doc.setAnnotation(0, { bbox: [1, 1, 2, 2], betas: Array(10).fill(0.5) });
  const a = doc.serialize().annotations[0];
  assert.deepEqual(a.bbox, [1, 1, 2, 2]);
  assert.deepEqual(a.betas, Array(10).fill(0.5));
  assert.deepEqual(a.segmentation, [[1, 2, 3, 4]]); // untouched
  assert.equal(a.id, 0);                              // untouched
});

test('deleteAnnotation removes the entry but keeps the image', () => {
  const doc = new CocoDocument(sampleDoc());
  doc.deleteAnnotation(0);
  const out = doc.serialize();
  assert.equal(out.annotations.length, 0);
  assert.equal(out.images.length, 2);
});

test('setAnnotation on an empty frame creates an entry with defaults', () => {
  const doc = new CocoDocument(sampleDoc());
  doc.setAnnotation(1, { root_pos: [0, 0, -4] });
  const a = doc.serialize().annotations.find((x) => x.image_id === 1);
  assert.ok(a);
  assert.equal(a.image_id, 1);
  assert.equal(a.keypoints.length, 156);
  assert.equal(a.body_pose.length, 63);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test label/tests/coco_document.test.js`
Expected: FAIL — cannot find module `coco_document.js`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// label/src/io/coco_document.js
const EDITABLE = ['bbox', 'root_pos', 'root_rota', 'body_pose', 'betas', 'keypoints', 'occlution_joint'];

function defaultAnnotation(imageId, nextId) {
  return {
    id: nextId, image_id: imageId, bbox: [0, 0, 0, 0],
    keypoints: Array(156).fill(0), p3d: [], iscrowd: 0, area: 0, category_id: 1,
    segmentation: [], occlution_joint: Array(52).fill(0),
    betas: Array(10).fill(0), root_pos: [0, 0, -4], root_rota: [0, 0, 0],
    body_pose: Array(63).fill(0), right_hand_pose: Array(45).fill(0), left_hand_pose: Array(45).fill(0),
  };
}

export class CocoDocument {
  constructor(raw) {
    this._raw = raw;
    this._byImageId = new Map();
    for (const a of raw.annotations ?? []) this._byImageId.set(a.image_id, structuredClone(a));
  }

  imageIds() { return (this._raw.images ?? []).map((im) => im.id); }
  imageInfo(id) { return (this._raw.images ?? []).find((im) => im.id === id) ?? null; }
  getAnnotation(imageId) { return this._byImageId.get(imageId) ?? null; }

  _nextId() {
    let max = -1;
    for (const a of this._byImageId.values()) max = Math.max(max, a.id ?? -1);
    return max + 1;
  }

  setAnnotation(imageId, fields) {
    let a = this._byImageId.get(imageId);
    if (!a) { a = defaultAnnotation(imageId, this._nextId()); this._byImageId.set(imageId, a); }
    for (const key of EDITABLE) {
      if (fields[key] !== undefined) a[key] = structuredClone(fields[key]);
    }
  }

  deleteAnnotation(imageId) { this._byImageId.delete(imageId); }

  serialize() {
    const out = structuredClone(this._raw);
    out.annotations = this.imageIds()
      .filter((id) => this._byImageId.has(id))
      .map((id) => structuredClone(this._byImageId.get(id)));
    return out;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test label/tests/coco_document.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add label/src/io/coco_document.js label/tests/coco_document.test.js
git commit -m "feat(label): fidelity-preserving COCO document"
```

---

## Task 5: Frame union model + portrait detection

Builds the unified `frames[]` (background ∪ data) and detects portrait/rotated data. Pure functions over plain descriptors so they test without a browser.

**Files:**
- Create: `label/src/io/source_loader.js`
- Test: `label/tests/source_loader.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFrames, isPortrait } from '../src/io/source_loader.js';

test('union: image-seq + full data → one frame per image, all with annotations', () => {
  const frames = buildFrames({
    background: { kind: 'image_sequence', count: 3 },
    annotatedIds: [0, 1, 2],
  });
  assert.equal(frames.length, 3);
  assert.deepEqual(frames.map((f) => f.hasData), [true, true, true]);
  assert.deepEqual(frames.map((f) => f.hasBackground), [true, true, true]);
});

test('image-seq + no data → frames exist, all empty', () => {
  const frames = buildFrames({ background: { kind: 'image_sequence', count: 2 }, annotatedIds: [] });
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map((f) => f.hasData), [false, false]);
});

test('no background + data → frame count from max data id + 1', () => {
  const frames = buildFrames({ background: null, annotatedIds: [0, 2] });
  assert.equal(frames.length, 3);
  assert.deepEqual(frames.map((f) => f.hasBackground), [false, false, false]);
  assert.deepEqual(frames.map((f) => f.hasData), [true, false, true]);
});

test('partial data over image-seq marks only annotated indices', () => {
  const frames = buildFrames({ background: { kind: 'image_sequence', count: 4 }, annotatedIds: [1, 3] });
  assert.deepEqual(frames.map((f) => f.hasData), [false, true, false, true]);
});

test('neither background nor data throws', () => {
  assert.throws(() => buildFrames({ background: null, annotatedIds: [] }), /no content/i);
});

test('isPortrait true when image height > width', () => {
  assert.equal(isPortrait({ width: 1080, height: 1920 }), true);
  assert.equal(isPortrait({ width: 1920, height: 1080 }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test label/tests/source_loader.test.js`
Expected: FAIL — cannot find module `source_loader.js`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// label/src/io/source_loader.js

// Build the unified frame list. `background` is null or { kind, count }.
// `annotatedIds` is the list of image_ids that have annotation data.
export function buildFrames({ background, annotatedIds }) {
  const bgCount = background ? background.count : 0;
  const maxDataId = annotatedIds.length ? Math.max(...annotatedIds) : -1;
  const total = Math.max(bgCount, maxDataId + 1);
  if (total <= 0) throw new Error('no content: neither background nor data provided');

  const dataSet = new Set(annotatedIds);
  const frames = [];
  for (let i = 0; i < total; i++) {
    frames.push({ index: i, hasBackground: i < bgCount, hasData: dataSet.has(i) });
  }
  return frames;
}

// Portrait = physical image taller than wide → labeler is view-only.
export function isPortrait({ width, height }) {
  return height > width;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test label/tests/source_loader.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add label/src/io/source_loader.js label/tests/source_loader.test.js
git commit -m "feat(label): frame union model and portrait detection"
```

---

## Task 6: AnnotationStore (per-frame model + undo events)

The single source of truth the scene/panels subscribe to. Wraps a `CocoDocument`; tracks the current frame; offers `set/add/delete` as undo transactions. Each transaction captures a before-snapshot and pushes one undo unit.

**Files:**
- Create: `label/src/edit/annotation_store.js`
- Test: `label/tests/annotation_store.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnnotationStore } from '../src/edit/annotation_store.js';
import { CocoDocument } from '../src/io/coco_document.js';

function doc() {
  return new CocoDocument({
    images: [{ id: 0 }, { id: 1 }],
    annotations: [{ id: 0, image_id: 0, bbox: [1, 1, 1, 1], betas: Array(10).fill(0),
      root_pos: [0, 0, -4], root_rota: [0, 0, 0], body_pose: Array(63).fill(0),
      keypoints: Array(156).fill(0), occlution_joint: Array(52).fill(0) }],
    categories: [],
  });
}

test('hasData reflects whether the current frame has an annotation', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(0); assert.equal(s.hasData(), true);
  s.setFrame(1); assert.equal(s.hasData(), false);
});

test('addTpose creates a default-centered annotation on an empty frame', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(1);
  s.addTpose();
  assert.equal(s.hasData(), true);
  assert.deepEqual(s.current().root_pos, [0, 0, -4]);
});

test('addFromPrevious copies the most recent non-empty frame', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(1);
  s.addFromPrevious();
  assert.deepEqual(s.current().bbox, [1, 1, 1, 1]);
});

test('deleteCurrent clears the frame', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(0);
  s.deleteCurrent();
  assert.equal(s.hasData(), false);
});

test('undo reverts the last transaction to its start value', () => {
  const s = new AnnotationStore(doc());
  s.setFrame(0);
  s.beginEdit();
  s.applyFields({ bbox: [9, 9, 9, 9] });
  s.commitEdit();
  assert.deepEqual(s.current().bbox, [9, 9, 9, 9]);
  s.undo();
  assert.deepEqual(s.current().bbox, [1, 1, 1, 1]);
});

test('change listeners fire on mutation', () => {
  const s = new AnnotationStore(doc());
  let n = 0; s.onChange(() => { n++; });
  s.setFrame(1); s.addTpose();
  assert.ok(n >= 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test label/tests/annotation_store.test.js`
Expected: FAIL — cannot find module `annotation_store.js`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// label/src/edit/annotation_store.js
const DEFAULT_ROOT_POS = [0, 0, -4];

export class AnnotationStore {
  constructor(cocoDoc) {
    this._doc = cocoDoc;
    this._ids = cocoDoc.imageIds();
    this._frame = 0;
    this._undo = [];
    this._listeners = new Set();
    this._pendingBefore = null;
  }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _notify() { for (const fn of this._listeners) fn(); }

  frameCount() { return this._ids.length; }
  setFrame(i) { this._frame = i; this._notify(); }
  currentFrame() { return this._frame; }
  currentImageId() { return this._ids[this._frame]; }
  current() { return this._doc.getAnnotation(this.currentImageId()); }
  hasData() { return this.current() !== null; }

  _snapshot() {
    const a = this.current();
    return a ? structuredClone(a) : null;
  }
  _restore(imageId, snap) {
    if (snap === null) this._doc.deleteAnnotation(imageId);
    else this._doc.setAnnotation(imageId, snap);
  }
  _pushUndo(imageId, before) { this._undo.push({ imageId, before }); }

  _txn(fn) {
    const imageId = this.currentImageId();
    const before = this._snapshot();
    fn(imageId);
    this._pushUndo(imageId, before);
    this._notify();
  }

  addTpose() {
    this._txn((id) => this._doc.setAnnotation(id, {
      root_pos: DEFAULT_ROOT_POS.slice(), root_rota: [0, 0, 0],
      body_pose: Array(63).fill(0), betas: Array(10).fill(0),
    }));
  }

  addFromPrevious() {
    let src = null;
    for (let i = this._frame - 1; i >= 0; i--) {
      const a = this._doc.getAnnotation(this._ids[i]);
      if (a) { src = a; break; }
    }
    if (!src) { this.addTpose(); return; }
    this._txn((id) => this._doc.setAnnotation(id, {
      bbox: src.bbox, root_pos: src.root_pos, root_rota: src.root_rota,
      body_pose: src.body_pose, betas: src.betas,
    }));
  }

  deleteCurrent() { this._txn((id) => this._doc.deleteAnnotation(id)); }

  // Drag transaction: begin → applyFields* → commit (one undo unit).
  beginEdit() { this._pendingBefore = this._snapshot(); }
  applyFields(fields) { this._doc.setAnnotation(this.currentImageId(), fields); this._notify(); }
  commitEdit() {
    this._pushUndo(this.currentImageId(), this._pendingBefore);
    this._pendingBefore = null;
  }

  undo() {
    const u = this._undo.pop();
    if (!u) return;
    this._restore(u.imageId, u.before);
    this._notify();
  }

  document() { return this._doc; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test label/tests/annotation_store.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add label/src/edit/annotation_store.js label/tests/annotation_store.test.js
git commit -m "feat(label): AnnotationStore single source of truth with undo transactions"
```

---

## Task 7: Port scene + camera into `label/src/scene/`

The 2D/3D camera system and three.js scene already exist and work in `smpl_viewer`. Port them with light cleanup (drop the N×90° data-rotation feature — the labeler forbids rotated annotation). This is a porting task, not TDD; verification is visual + the existing camera-math tests still cover the math.

**Files:**
- Create: `label/src/scene/camera_modes.js` (ported from `smpl_viewer/camera_modes.js`, data-rotation removed)
- Create: `label/src/scene/scene.js` (mesh + 24 joint points + bones, adapted from `smpl_viewer/viewer.js` scene setup)

> **No new unit test in this task.** `camera_modes.js` and `scene.js` both import three.js, which is browser-only and cannot run under `node --test`. The projection math they reuse is already covered by `tests/test_camera_math.py` and `smpl_web_viewer/tests/camera_modes.test.js`. Behavior of this port is verified visually in Task 9. Do NOT add a trivial always-true test.

- [ ] **Step 1: Copy camera_modes.js and strip data-rotation**

```bash
cp smpl_viewer/camera_modes.js label/src/scene/camera_modes.js
```

Then edit `label/src/scene/camera_modes.js`: remove `rotateKn`, `_dataRotN`, `setDataRotation`, `getDataRotation`, and the rotation branches inside `resetIntrinsics` (it should just restore `_meta_K`/`_meta_W`/`_meta_H` directly). Keep: constructor, `setIntrinsics`, `resetIntrinsics`, `bgPlaneParams`, `switchTo`, `snapTo`, `update`, `set3DFollowTarget`, `effectiveAspect`, the `_pose2D`/`_pose3D` tween logic.

- [ ] **Step 2: Create the scene module**

Create `label/src/scene/scene.js` adapting the scene construction from `smpl_viewer/viewer.js:280-317` (mesh + 24 joint spheres + bones) and `applyFrame` vertex/joint upload (`viewer.js:393-419`), WITHOUT the `rot()` data-rotation transform — write vertices/joints straight through. Reuse the bone list `BONES`/`BONE_COLORS` from `viewer.js:10-17`. Expose this interface:

```javascript
// label/src/scene/scene.js  (interface)
export class LabelScene {
  constructor(canvas) {}            // renderer, scene, lights (camera_modes owns OrbitControls)
  setTopology(faces) {}             // build mesh geometry once per model
  setCamera(cameraModes) {}         // attach the CameraModes camera for rendering
  updateMesh(vertices, joints) {}   // upload Float32Array verts (Nx3) + 24 joints
  setBackgroundTexture(texture) {}  // bind image/video texture to bg planes
  render() {}                       // controls.update + renderer.render
}
```

- [ ] **Step 3: Run the existing suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS — unchanged counts (this task added no JS test).

- [ ] **Step 4: Commit**

```bash
git add label/src/scene/
git commit -m "feat(label): port scene + 2D/3D camera (no data-rotation)"
```

---

## Task 8: App skeleton — load, render, navigate (no editing)

Wires everything: file picker → detect background/data → build frames → portrait gate → drive SMPL via worker → render → slider/prev/next. Editing handles come in M2. This is integration; verified manually in Task 9.

**Files:**
- Create: `label/index.html`
- Create: `label/src/app.js`
- Modify: `package.json` (add a serve:label script)

- [ ] **Step 1: Create `label/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>SMPL 标注器</title>
  <script type="importmap">
    { "imports": {
        "three": "../smpl_web_viewer/public/vendor/three.module.js",
        "three/addons/controls/OrbitControls.js": "../smpl_web_viewer/public/vendor/OrbitControls.js"
    } }
  </script>
  <style>
    html,body { height:100%; margin:0; background:#1a1f2a; color:#eee; font-family:monospace; }
    body { display:flex; }
    #stage { position:relative; flex:1; background:#0f1216; overflow:hidden; }
    canvas { display:block; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); }
    #status { position:absolute; top:8px; left:8px; background:rgba(0,0,0,.6); padding:5px 9px; font-size:11px; }
    #side { width:300px; background:#1a1a1a; border-left:1px solid #333; padding:10px; display:flex; flex-direction:column; gap:10px; overflow-y:auto; }
    button { padding:5px 8px; background:#2a2a2a; border:1px solid #444; color:#eee; border-radius:3px; cursor:pointer; }
    button.on { background:#0066cc; }
    input[type=range] { width:100%; }
    .warn { color:#ffb86b; }
  </style>
</head>
<body>
  <div id="stage"><canvas id="c"></canvas><div id="status">就绪</div></div>
  <aside id="side">
    <h2 style="font-size:13px;color:#7df">SMPL 标注器</h2>
    <button id="btn-open">选择目录 / 文件</button>
    <input id="dir-input" type="file" webkitdirectory directory multiple hidden>
    <div class="row"><button id="btn-2d" class="on">2D 对齐</button><button id="btn-3d">3D 自由</button></div>
    <div class="row"><button id="btn-prev">◀</button><button id="btn-play">▶ 播放</button><button id="btn-next">▶|</button></div>
    <input id="slider" type="range" min="0" max="0" value="0">
    <div id="frame-info">— / —</div>
  </aside>
  <script type="module" src="./src/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `label/src/app.js`**

```javascript
// label/src/app.js — M1 skeleton: load, render, navigate. No editing yet.
import { loadModel } from '../../smpl_core/smpl_model.js';
import { forwardSmpl } from '../../smpl_core/lbs.js';
import { CocoDocument } from './io/coco_document.js';
import { buildFrames, isPortrait } from './io/source_loader.js';
import { AnnotationStore } from './edit/annotation_store.js';
import { CameraModes } from './scene/camera_modes.js';
import { LabelScene } from './scene/scene.js';

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };

const MODEL_URL = new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url);
let model = null, scene = null, cam = null, store = null;
let images = new Map();      // index -> File
let readOnly = false;

function isJpeg(name) { return /\.(jpe?g)$/i.test(name); }

async function openFiles(fileList) {
  const files = Array.from(fileList ?? []);
  const jsonFile = files.find((f) => f.name.endsWith('.json'));
  const imageFiles = files.filter((f) => isJpeg(f.name)).sort((a, b) => a.name.localeCompare(b.name));

  let coco = null, annotatedIds = [];
  if (jsonFile) {
    coco = new CocoDocument(JSON.parse(await jsonFile.text()));
    annotatedIds = coco.imageIds().filter((id) => coco.getAnnotation(id));
  }
  const background = imageFiles.length ? { kind: 'image_sequence', count: imageFiles.length } : null;
  if (!coco) {
    // data-less: synthesize an images list from the image files
    coco = new CocoDocument({ images: imageFiles.map((_, i) => ({ id: i })), annotations: [], categories: [] });
  }

  const frames = buildFrames({ background, annotatedIds });
  imageFiles.forEach((f, i) => images.set(i, f));

  // portrait gate
  const info = coco.imageInfo(coco.imageIds()[0]);
  readOnly = info ? isPortrait(info) : false;
  if (readOnly) setStatus('⚠ 该数据为竖拍/旋转,标注器仅支持查看;请用其他软件转正后再标注');

  store = new AnnotationStore(coco);
  $('slider').max = String(Math.max(0, frames.length - 1));
  $('slider').value = '0';
  if (!model) { model = await loadModel(MODEL_URL); scene.setTopology(model.faces); }
  await showFrame(0);
}

async function showFrame(i) {
  store.setFrame(i);
  $('frame-info').textContent = `${i} / ${store.frameCount() - 1}`;
  const a = store.current();
  if (a) {
    const out = forwardSmpl(model, { root_pos: a.root_pos, root_rota: a.root_rota, body_pose: a.body_pose, betas: a.betas });
    scene.updateMesh(out.vertices, out.joints);
  }
  const file = images.get(i);
  if (file) {
    const url = URL.createObjectURL(file);
    new (await import('three')).TextureLoader().load(url, (tex) => { URL.revokeObjectURL(url); scene.setBackgroundTexture(tex); });
  }
}

function boot() {
  scene = new LabelScene($('c'));
  cam = new CameraModes({ canvas: $('c'), meta: { K: { fx: 1850, fy: 1850, cx: 960, cy: 540 }, image_w: 1920, image_h: 1080 } });
  scene.setCamera(cam);
  $('btn-open').addEventListener('click', () => $('dir-input').click());
  $('dir-input').addEventListener('change', (e) => openFiles(e.target.files).catch((err) => setStatus(String(err))));
  $('btn-2d').addEventListener('click', () => { cam.switchTo('2d'); });
  $('btn-3d').addEventListener('click', () => { cam.switchTo('3d'); });
  $('slider').addEventListener('input', (e) => showFrame(+e.target.value));
  $('btn-prev').addEventListener('click', () => showFrame(Math.max(0, store.currentFrame() - 1)));
  $('btn-next').addEventListener('click', () => showFrame(Math.min(store.frameCount() - 1, store.currentFrame() + 1)));
  function loop() { cam.update(); scene.render(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
}
boot();
```

- [ ] **Step 3: Add a serve script**

In `package.json` scripts, add:

```json
"serve:label": "node smpl_web_viewer/tools/static_server.mjs --root . --port 5175"
```

- [ ] **Step 4: Run the full suite (logic modules must still pass)**

Run: `npm test`
Expected: PASS — all M1 logic tests + existing suite green.

- [ ] **Step 5: Commit**

```bash
git add label/index.html label/src/app.js package.json
git commit -m "feat(label): app skeleton — load, render, navigate frames"
```

---

## Task 9: Manual verification of the skeleton

**Files:** none (verification only).

- [ ] **Step 1: Serve and open**

Run: `npm run serve:label`
Open: `http://127.0.0.1:5175/label/`

- [ ] **Step 2: Load the known-good sample**

Click 选择目录 / 文件 and pick the directory `/Users/penghaotian/Downloads/20260609/test_data` (contains `json_results/player_0/player_0.json` + `images/*.jpg`).

Expected: status shows frame count; first frame renders mesh over the background image in 2D-aligned mode; slider/prev/next move through frames; 3D button orbits.

- [ ] **Step 3: Verify the four load combinations**

- json only (no images): renders mesh on plain background, navigable.
- images only (no json): shows images, no mesh, navigable.
- partial data: frames without data show background only.

- [ ] **Step 4: Verify portrait gate**

Load a portrait sequence (image height > width); confirm the read-only warning appears.

- [ ] **Step 5: Record results in the plan**

Note pass/fail for each combination in this task's checkbox list. If anything fails, fix before M2.

---

## Out of scope for M1 (covered by later plans)

This plan delivers a working, navigable, fidelity-preserving loader + renderer. The following are deliberately deferred to their own plans, each building on the modules above:

- **M2 — Editing:** root pos/rot handles (2D in-plane + depth handle, 3D axis arrows), per-joint rotation gizmo + euler numeric/sliders, bbox 4-corner edit + project-from-mesh, beta sliders, add (T-pose / from-previous) and delete buttons, Ctrl+Z wired to `AnnotationStore.undo()`.
- **M3 — Derived fields + IO:** keypoints reprojection (24 SMPL joints → first 24 slots, rest 0), occlusion via WebGL depth compare, Save (download new `player_0.json`), Reset (reload from disk).

Each gets its own spec-derived plan when M1 is green.




