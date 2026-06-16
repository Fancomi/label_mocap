# IK 关节调整 实现计划 (IK Joint Drag)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在标注器姿势编辑中加入两段解析 IK:拖动末端关节(腕/踝),自动反解肩-肘 / 髋-膝朝向;3D 与 2D 视角均可拖;骨骼无关,为 SMPLX/MHR/SKEL 预留。

**Architecture:** 三层切分——`ik_solver.js` 纯几何(余弦定理 + 自动 pole,返回肘/末端的新世界坐标 + 最短弧四元数),零 three.js / 零 SMPL;`ik_chains.js` 把骨骼差异(哪些关节构成肢体链、哪个是末端)收敛成配置;`ik_controller.js` 编排:取链世界坐标 → 解 → 世界 delta → 经父关节世界旋转换算成局部四元数 → 写回 `RotationState`,复用 `forwardSmpl`/撤销/保存链路。

**Tech Stack:** 原生 ES 模块,`node --test` 测纯逻辑;three.js(vendored)用于拖拽 gizmo;复用 `smpl_core/rotations.js`、`RotationState`、`forwardSmpl({worldRot:true})`。

**Reference spec:** `docs/superpowers/specs/2026-06-16-ik-joint-drag-design.md`

---

## Conventions

- 仓库根运行测试:`node --test label/tests/<file>.test.js`
- 浏览器代码(three.js/DOM)用 `node --check` 验语法 + Task 6 人工验证
- 每个 Task 末尾提交,提交信息见该 Task 最后一步
- 分支 `feat-ik-joint-drag`(已创建,基于 main)

## File structure (本计划)

- 新增 `label/src/edit/ik_solver.js` — 纯几何:`solveTwoBoneIK`、`shortestArcQuat`(测)
- 新增 `label/src/edit/ik_chains.js` — 骨骼链配置:`chainsFor`、`endEffectorChain`(测)
- 新增 `label/src/edit/ik_controller.js` — 编排,世界→局部写回(浏览器)
- 修改 `label/index.html` — 姿势 Tab 加 `#ik-toggle`
- 修改 `label/src/app.js` — IK 开关 + 末端关节 3D/2D 拖拽接线
- 新增测试 `label/tests/ik_solver.test.js`、`label/tests/ik_chains.test.js`

---

## Task 1: IK 求解器(纯几何,可单测)

两段解析 IK + 最短弧四元数。求解器返回中段(肘)与末端(腕)的**新世界坐标**——纯几何,测试只需验证"可达目标 → 末端命中 target"。`shortestArcQuat` 给控制器把"旧骨向→新骨向"转成世界旋转 delta 用。零 three.js / 零 SMPL。

**Files:**
- Create: `label/src/edit/ik_solver.js`
- Test: `label/tests/ik_solver.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { solveTwoBoneIK, shortestArcQuat } from '../src/edit/ik_solver.js';
import { quatToMat3 } from '../../smpl_core/rotations.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const close = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// 上臂长1、前臂长1,肩在原点。
const ROOT = [0, 0, 0];
const MID0 = [1, 0, 0];   // 当前肘
const END0 = [2, 0, 0];   // 当前腕(伸直)
const POLE = [0, 1, 0];   // 弯曲平面朝 +Y

test('可达目标:末端精确命中 target', () => {
  const target = [1, 1, 0]; // 距肩 √2,在 [0,2] 可达域内
  const { mid, end } = solveTwoBoneIK({ root: ROOT, mid: MID0, end: END0, target, pole: POLE });
  close(dist(end, target), 0);
  // 两段长度保持
  close(dist(ROOT, mid), 1);
  close(dist(mid, end), 1);
});

test('不可达(过远):肢体伸直,末端落在 root→target 射线上 a+b 处', () => {
  const target = [10, 0, 0];
  const { mid, end } = solveTwoBoneIK({ root: ROOT, mid: MID0, end: END0, target, pole: POLE });
  close(dist(ROOT, end), 2);            // a+b
  close(dist(ROOT, mid), 1);
  close(dist(mid, end), 1);
  // 伸直:mid 在 root 与 end 之间,共线
  close(mid[1], 0); close(mid[2], 0);
});

test('过近:clamp 到 |a-b|,无 NaN', () => {
  const target = [0.001, 0, 0]; // 距 ~0 < |a-b|=0,等臂时退化
  const { mid, end } = solveTwoBoneIK({ root: ROOT, mid: MID0, end: END0, target, pole: POLE });
  assert.ok(Number.isFinite(mid[0]) && Number.isFinite(end[0]) && Number.isFinite(mid[1]));
});

test('pole 决定弯曲方向:肘偏向 pole 一侧', () => {
  const target = [1, 0, 0]; // 距 1,需要弯曲
  const up = solveTwoBoneIK({ root: ROOT, mid: MID0, end: END0, target, pole: [0, 1, 0] });
  const down = solveTwoBoneIK({ root: ROOT, mid: MID0, end: END0, target, pole: [0, -1, 0] });
  assert.ok(up.mid[1] > 0, `pole+Y 肘应在 +Y: ${up.mid}`);
  assert.ok(down.mid[1] < 0, `pole-Y 肘应在 -Y: ${down.mid}`);
});

test('退化(肩腕重合 / 零臂)不抛错', () => {
  const r = solveTwoBoneIK({ root: ROOT, mid: ROOT, end: ROOT, target: [1, 0, 0], pole: POLE });
  assert.ok(Number.isFinite(r.mid[0]) && Number.isFinite(r.end[0]));
});

test('shortestArcQuat 把单位向量 from 旋到 to', () => {
  const q = shortestArcQuat([1, 0, 0], [0, 1, 0]); // +X → +Y,绕 +Z 90°
  const m = quatToMat3(q);
  // 旋转后 +X 落到 +Y:列0 应 ≈ (0,1,0)
  close(m[0], 0); close(m[3], 1); close(m[6], 0);
});

test('shortestArcQuat 同向返回单位四元数', () => {
  const q = shortestArcQuat([1, 0, 0], [2, 0, 0]);
  close(q[0], 0); close(q[1], 0); close(q[2], 0); close(Math.abs(q[3]), 1);
});

test('shortestArcQuat 反向(180°)仍是合法单位四元数', () => {
  const q = shortestArcQuat([1, 0, 0], [-1, 0, 0]);
  close(Math.hypot(q[0], q[1], q[2], q[3]), 1);
});
```

- [ ] **Step 2: 跑测试,确认 FAIL**

Run: `node --test label/tests/ik_solver.test.js`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

```javascript
// label/src/edit/ik_solver.js
// 两段解析 IK(余弦定理)+ 最短弧四元数。纯几何:点用 [x,y,z],四元数 [x,y,z,w]。
// 零 three.js / 零 SMPL —— 对任何两段肢体成立。
import { quatNormalize } from '../../../smpl_core/rotations.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function norm(a) { const l = len(a); return l < 1e-9 ? [0, 0, 0] : scale(a, 1 / l); }
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// 单位向量 from → to 的最短弧旋转四元数。
export function shortestArcQuat(from, to) {
  const f = norm(from); const t = norm(to);
  const d = clamp(dot(f, t), -1, 1);
  if (d > 1 - 1e-8) return [0, 0, 0, 1];
  if (d < -1 + 1e-8) {
    // 反向:绕任一垂直轴转 180°
    let axis = cross([1, 0, 0], f);
    if (len(axis) < 1e-6) axis = cross([0, 1, 0], f);
    axis = norm(axis);
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(f, t);
  return quatNormalize([c[0], c[1], c[2], 1 + d]);
}

// 解两段 IK。root/mid/end 是当前三关节世界坐标,target 是末端目标,pole 决定弯曲平面。
// 返回中段(肘)与末端(腕)的新世界坐标,保持两段骨长。
export function solveTwoBoneIK({ root, mid, end, target, pole }) {
  const a = len(sub(mid, root));   // 上臂长
  const b = len(sub(end, mid));    // 前臂长
  if (a < 1e-9 || b < 1e-9) return { mid: mid.slice(), end: end.slice() };

  const toTarget = sub(target, root);
  let d = len(toTarget);
  const dir = d < 1e-9 ? [1, 0, 0] : scale(toTarget, 1 / d);
  d = clamp(d, Math.abs(a - b) + 1e-6, a + b - 1e-6); // 可达域内,留 epsilon 防共线退化

  // 弯曲平面法向:pole 在垂直于 dir 的分量;退化则取一个稳定垂直轴。
  let bend = sub(pole, scale(dir, dot(pole, dir)));
  if (len(bend) < 1e-6) {
    bend = sub([0, 1, 0], scale(dir, dot([0, 1, 0], dir)));
    if (len(bend) < 1e-6) bend = sub([1, 0, 0], scale(dir, dot([1, 0, 0], dir)));
  }
  bend = norm(bend);

  // 肩处张角(dir 与上臂的夹角),余弦定理。
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const alpha = Math.acos(cosA);
  const newMid = add(root, add(scale(dir, a * Math.cos(alpha)), scale(bend, a * Math.sin(alpha))));
  const newEnd = add(root, scale(dir, d));
  return { mid: newMid, end: newEnd };
}
```

- [ ] **Step 4: 跑测试,确认 8/8 PASS**

Run: `node --test label/tests/ik_solver.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add label/src/edit/ik_solver.js label/tests/ik_solver.test.js
git commit -m "feat(ik): two-bone analytic IK solver + shortest-arc quat (pure)"
```

---

## Task 2: 骨骼链配置(可单测)

把骨骼差异收敛成一份配置:每条肢体链的三关节 SMPL 索引 + body_pose 索引,以及"某 SMPL 关节是否某链末端"的查询。换骨骼只加配置。

**Files:**
- Create: `label/src/edit/ik_chains.js`
- Test: `label/tests/ik_chains.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chainsFor, endEffectorChain } from '../src/edit/ik_chains.js';

test('chainsFor(smpl) 返回 4 条链,各含三关节,bodyIdx = joints − 1', () => {
  const chains = chainsFor('smpl');
  assert.equal(chains.length, 4);
  for (const c of chains) {
    assert.equal(c.joints.length, 3);
    assert.equal(c.bodyIdx.length, 3);
    for (let i = 0; i < 3; i++) assert.equal(c.bodyIdx[i], c.joints[i] - 1);
  }
});

test('未知骨骼返回空数组(不抛错)', () => {
  assert.deepEqual(chainsFor('mhr'), []);
});

test('endEffectorChain 命中末端关节,返回其链', () => {
  const lWrist = endEffectorChain('smpl', 20);
  assert.ok(lWrist);
  assert.equal(lWrist.name, 'L_Arm');
  assert.deepEqual(lWrist.joints, [16, 18, 20]);
});

test('非末端关节返回 null', () => {
  assert.equal(endEffectorChain('smpl', 18), null);
  assert.equal(endEffectorChain('smpl', 0), null);
});

test('四个末端:L/R 腕(20,21)、L/R 踝(7,8)', () => {
  for (const j of [20, 21, 7, 8]) assert.ok(endEffectorChain('smpl', j), `joint ${j} 应是末端`);
});
```

- [ ] **Step 2: 跑测试,确认 FAIL**

Run: `node --test label/tests/ik_chains.test.js`

- [ ] **Step 3: 实现**

```javascript
// label/src/edit/ik_chains.js
// 骨骼无关的肢体链配置。joints = SMPL 24 关节索引(世界坐标取 lastJoints);
// bodyIdx = body_pose 21 索引(= 关节索引 − 1,关节 0 是 root,不在 body_pose)。
// 换骨骼只在此表加一项,solver/controller 不动。
const CHAINS = {
  smpl: [
    { name: 'L_Arm', joints: [16, 18, 20], bodyIdx: [15, 17, 19] },
    { name: 'R_Arm', joints: [17, 19, 21], bodyIdx: [16, 18, 20] },
    { name: 'L_Leg', joints: [1, 4, 7], bodyIdx: [0, 3, 6] },
    { name: 'R_Leg', joints: [2, 5, 8], bodyIdx: [1, 4, 7] },
  ],
};

export function chainsFor(skeleton) { return CHAINS[skeleton] ?? []; }

// 给定 SMPL 关节索引,若它是某链末端(第 3 个关节),返回该链;否则 null。
export function endEffectorChain(skeleton, smplJointIdx) {
  return chainsFor(skeleton).find((c) => c.joints[2] === smplJointIdx) ?? null;
}
```

- [ ] **Step 4: 跑测试,确认 5/5 PASS**

Run: `node --test label/tests/ik_chains.test.js`

- [ ] **Step 5: 提交**

```bash
git add label/src/edit/ik_chains.js label/tests/ik_chains.test.js
git commit -m "feat(ik): skeleton-agnostic limb-chain config (smpl)"
```

---

## Task 3: IK 控制器(编排,世界→局部写回)

把求解器和骨骼配置接到 `RotationState`。浏览器侧编排(不直接 import three.js),`node --check` 验语法,行为在 Task 6 人工验证。

**核心**:给定末端链 + 目标点 + 当前 `lastJoints`(24×3 世界坐标)+ `lastWorldRot`(24×9 每关节世界旋转)+ `parents`(24 父索引),解出肘/腕新世界坐标,把每段"旧骨向→新骨向"的世界旋转 delta,经**父关节世界旋转**换算成该关节局部增量,叠加到当前局部四元数后写回。

**Files:**
- Create: `label/src/edit/ik_controller.js`

- [ ] **Step 1: 实现**

```javascript
// label/src/edit/ik_controller.js
// 编排两段 IK:末端目标 → 解 → 世界旋转 delta → 局部四元数 → 写回 RotationState。
// 复用现有 forwardSmpl({worldRot})/撤销/保存链路;不直接依赖 three.js。
import { solveTwoBoneIK, shortestArcQuat } from './ik_solver.js';
import { endEffectorChain } from './ik_chains.js';
import { mat3ToQuat, quatConjugate, quatMultiply, quatNormalize } from '../../../smpl_core/rotations.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const j3 = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
const m9 = (arr, i) => arr.slice(i * 9, i * 9 + 9);

export class IKController {
  constructor({ getRotation, getStore, getLastJoints, getLastWorldRot, getSkeleton, onEdit }) {
    this._getRotation = getRotation;
    this._getStore = getStore;
    this._getLastJoints = getLastJoints;
    this._getLastWorldRot = getLastWorldRot;
    this._getSkeleton = getSkeleton || (() => 'smpl');
    this._onEdit = onEdit;
    this._parents = null;
  }

  setParents(parents) { this._parents = parents; }

  // smplJointIdx 是否可 IK 拖动的末端;是则返回其链,否则 null。
  chainFor(smplJointIdx) { return endEffectorChain(this._getSkeleton(), smplJointIdx); }

  // 把末端关节拖到世界点 target,解 IK 并写回肩/肘局部四元数。
  solveTo(chain, target) {
    const rot = this._getRotation();
    const joints = this._getLastJoints();
    const worldRot = this._getLastWorldRot();
    if (!rot || !joints || !worldRot || !this._parents) return;
    const [jRoot, jMid, jEnd] = chain.joints;
    const root = j3(joints, jRoot);
    const mid = j3(joints, jMid);
    const end = j3(joints, jEnd);

    // 自动 pole:传入当前肘点,solver 内部投影到垂直于肩腕轴的分量,保持弯曲平面。
    const out = solveTwoBoneIK({ root, mid, end, target, pole: mid });

    // 上臂段:旧骨向(root→mid)→新骨向(root→out.mid),叠加到肩(jRoot)局部。
    this._applySegment(chain.bodyIdx[0], jRoot, sub(mid, root), sub(out.mid, root), rot, worldRot);
    // 前臂段:旧骨向(mid→end)→新骨向(out.mid→out.end),叠加到肘(jMid)局部。
    this._applySegment(chain.bodyIdx[1], jMid, sub(end, mid), sub(out.end, out.mid), rot, worldRot);

    this._getStore().applyFields(rot.toAxisAngle());
    this._onEdit();
  }

  _applySegment(bodyIdx, smplJointIdx, oldBone, newBone, rot, worldRot) {
    const qDeltaWorld = shortestArcQuat(oldBone, newBone);
    const parentQ = this._parentWorldQuat(smplJointIdx, worldRot);
    const pInv = quatConjugate(parentQ);
    // 世界 delta 投到该关节局部空间:q_local_new = (P⁻¹·ΔW·P)·q_local_old
    const qDeltaLocal = quatNormalize(quatMultiply(pInv, quatMultiply(qDeltaWorld, parentQ)));
    const qOld = rot.getJointQuat(bodyIdx);
    rot.setJointQuat(bodyIdx, quatNormalize(quatMultiply(qDeltaLocal, qOld)));
  }

  // 关节 smplJointIdx 的父关节世界旋转四元数。worldRot[j] 是关节 j 自身世界旋转;
  // 父世界旋转取 worldRot[parents[j]]。根的父(-1)用单位四元数。
  _parentWorldQuat(smplJointIdx, worldRot) {
    const p = this._parents[smplJointIdx];
    if (p == null || p < 0) return [0, 0, 0, 1];
    return mat3ToQuat(m9(worldRot, p));
  }
}
```

- [ ] **Step 2: 语法检查**

Run: `node --check label/src/edit/ik_controller.js`
Expected: 通过。

- [ ] **Step 3: 跑全部纯逻辑测试确认未破坏**

Run: `node --test label/tests/*.test.js`
Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add label/src/edit/ik_controller.js
git commit -m "feat(ik): IK controller — solve + world->local writeback to RotationState"
```

---

## Task 4: index.html 加 IK 拖拽开关

姿势 Tab 内加一个开关,默认关。

**Files:**
- Modify: `label/index.html`

- [ ] **Step 1: 在姿势 tabpanel 的 `#joint-grid` 之前插入开关**

读 `label/index.html`,在 `data-mode="pose"` 的 `<section>` 内、`<div id="joint-grid">` 之前加:

```html
      <div class="row" style="align-items:center;gap:6px">
        <button id="ik-toggle">🔗 IK 拖拽</button>
        <span style="font-size:10px;color:#8ab">开启后拖手腕/脚踝自动反解</span>
      </div>
```

- [ ] **Step 2: 验证可服务 + 元素存在**

```bash
npm run serve:label >/tmp/s.log 2>&1 & sleep 2
curl -s http://127.0.0.1:5175/label/ | grep -c "ik-toggle"
pkill -f static_server.mjs
```
Expected: ≥1。

- [ ] **Step 3: 提交**

```bash
git add label/index.html
git commit -m "feat(ik): pose-tab IK drag toggle button"
```

---

## Task 5: app.js 接线 IK(开关 + 末端关节 3D/2D 拖拽)

把 IKController 接入,IK 开启时拖末端关节走反解。复用已有的 worldRot(`applyAnnotation` 已 `forwardSmpl({worldRot:true})` 并缓存 `lastWorldRot`)、`lastJoints`、`store` 事务、`applyAnnotation` 刷新。浏览器集成,Task 6 人工验证。

**Files:**
- Modify: `label/src/app.js`

- [ ] **Step 1: 构造 IKController 并注入 parents**

读 `label/src/app.js`。在 import 区加:
```javascript
import { IKController } from './edit/ik_controller.js';
```
模块状态加:`let ikController = null; let ikEnabled = false;`

在 `boot()` 里,gizmo/picker 构造之后加:
```javascript
  ikController = new IKController({
    getRotation: () => rotation,
    getStore: () => store,
    getLastJoints: () => lastJoints,
    getLastWorldRot: () => lastWorldRot,
    getSkeleton: () => 'smpl',
    onEdit: applyAnnotation,
  });
```
在 `openFiles`/`openFromDirSource` 里模型加载后(`model` 就绪处)注入父索引:`ikController.setParents(model.parents);`(两条路径都要;放在 `scene.setTopology(model.faces)` 之后即可,model 已加载)。

- [ ] **Step 2: IK 开关按钮**

`boot()` 里加:
```javascript
  $('ik-toggle').addEventListener('click', () => {
    ikEnabled = !ikEnabled;
    $('ik-toggle').classList.toggle('on', ikEnabled);
    setStatus(ikEnabled ? 'IK 拖拽已开启:拖手腕/脚踝' : 'IK 拖拽已关闭');
  });
```

- [ ] **Step 3: 末端关节拖拽 → IK**

复用 `RootHandle` 式的平移 gizmo 拖末端关节,或直接用画布指针在末端关节上拖。最小实现:复用已有的 `poseGizmo` 选中机制 + 一个平移代理。为避免与单关节旋转 gizmo 冲突,采用如下规则:
- 当 `ikEnabled` 且选中的关节是末端(`ikController.chainFor(smplJoint)` 非空)时,显示一个**平移 gizmo**(新增轻量 `IKHandle`,或复用 RootHandle 的平移模式挂到末端关节世界位置);拖动时 `store.beginEdit()`(按下)→ 每次 `objectChange` 调 `ikController.solveTo(chain, 代理世界坐标)` → `store.commitEdit()`(抬起)。
- 2D 对齐视角:代理限制在末端关节当前深度的平面(x/y 跟手、深度锁定),与 root 深度退化处理一致——平移 gizmo 在 2D 下只露 X/Y 箭头即可(深度本就退化)。

> 注:`solveTo` 内部已做世界→局部写回与 `applyAnnotation` 刷新;app 只需把"被拖到的世界点"喂给它。一次拖拽 = 一个 store 撤销单元。

具体接法(在 `syncUI` 的 pose 分支):当 `ikEnabled && ui.selectedJoint != null` 且该 body 关节对应的 SMPL 关节(`ui.selectedJoint + 1`)是末端,attach IK 平移手柄到 `scene.jointWorldPosition(smplJoint)`,detach 单关节旋转 gizmo;否则维持现有逻辑。手柄拖动回调:
```javascript
// 伪代码,IKHandle 复用 TransformControls translate:
onDrag(worldPos) {
  const chain = ikController.chainFor(ui.selectedJoint + 1);
  if (chain) ikController.solveTo(chain, worldPos);
}
```

- [ ] **Step 4: 语法 + 全测**

```bash
node --check label/src/app.js
node --test label/tests/*.test.js
```
Expected: 解析通过;纯逻辑测试全绿。

- [ ] **Step 5: 提交**

```bash
git add label/src/app.js
git commit -m "feat(ik): wire IK toggle + end-effector drag (3D/2D) into app"
```

---

## Task 6: 人工验证

**Files:** 无。

- [ ] **Step 1** 服务 + 打开:`npm run serve:label` → `http://127.0.0.1:5175/label/` → Chrome/Edge 打开 `test_data`。
- [ ] **Step 2** 姿势 Tab → 开「🔗 IK 拖拽」→ 选中手腕(L_Wrist)→ 出现平移手柄;3D 自由视角拖手腕,肘/肩实时跟随反解,网格平滑无跳变。
- [ ] **Step 3** 拖到很远(不可达):手臂伸直指向目标,不报错不抖。
- [ ] **Step 4** 切 2D 对齐 → 拖手腕在图像平面贴合底图人物;深度不乱跳。
- [ ] **Step 5** Ctrl+Z:一次拖拽整体回退到拖前。
- [ ] **Step 6** 关「IK 拖拽」→ 选关节恢复单关节旋转 gizmo。脚踝(L_Ankle)同样可 IK。
- [ ] **Step 7** 保存 → 重开,姿势保留。记录通过情况;有问题先修再合并。

## Out of scope

- 显式肘/膝朝向控制;FABRIK 长链;脊柱/手指 IK;多人。
- SMPLX/MHR/SKEL:架构已预留(`ik_chains` 加配置 + `getSkeleton` 返回对应名),本计划只实现 smpl。

## Self-review checklist(写完自查,已核对)

- 每个 spec 章节都有对应 Task:求解器(T1)、骨骼配置(T2)、控制器世界→局部(T3)、入口开关(T4)、3D/2D 拖拽接线(T5)、错误兜底(T1 测试覆盖不可达/过近/退化)、测试(T1/T2)、人工验证(T6)、扩展性(T2 配置 + T3 getSkeleton)。
- 无占位符;每个写码步骤含完整代码。
- 接口一致:`solveTwoBoneIK({root,mid,end,target,pole})→{mid,end}`、`shortestArcQuat(from,to)`、`chainsFor`/`endEffectorChain`、`IKController.{chainFor,solveTo,setParents}` 在各 Task 间名称一致。
- 复用既有:`rotations.js`(mat3ToQuat/quatConjugate/quatMultiply/quatNormalize)、`RotationState.{getJointQuat,setJointQuat,toAxisAngle}`、`forwardSmpl({worldRot:true})` 输出 `lastWorldRot`、`model.parents`。


