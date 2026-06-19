# 3D 点云 SMPL 标注器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建纯 Web、可部署 GitHub Pages、数据本地操作的 3D LiDAR 点云 SMPL 标注器,脱胎于 `label/`,先把共享编辑内核抽到 `smpl_edit/`(B),再新建 `pcd_label/`(A)。

**Architecture:** 三层包结构。`smpl_edit/`(从 label 原样搬出的世界系编辑内核:rotation/annotation/coco/gizmo/IK/ui)→ `label/` 改为依赖它(瘦身,零回归)→ `pcd_label/` 新建,复用 `smpl_edit/` + `smpl_core/`,只写点云特有的解码/配色/坐标轴/相机/装配。

**Tech Stack:** ES modules、three.js(vendored r160)、File System Access API、Node `--test`(纯逻辑单测)、静态托管。

**关键事实(已从产出代码 + 实测一帧验证):**
- 序列目录含 `manifest.json` + `frame_%06d.png`。
- PNG 尺寸 `point_width × (point_height*3)` RGB888,纵向 3 band:band0=X、band1=Y、band2=Z。
- 像素 RGB = 24 位整数高/中/低字节:`encoded=(R<<16)|(G<<8)|B`;`value=encoded/scale-center`;`encoded==0` 为无效点。
- 像素 `(row,col)`(band 内)对应点线性序 `row*point_width+col`。
- 样例:scale=1000, center=256;Z-up/X-front;单帧 ~48 万有效点/62.4 万。
- SMPL 内核是 Y-up;需要数据系→three.js 显示系(Y-up)的可配置基变换。

**导入深度备忘(避免路径错误):**
- `smpl_edit/foo.js` → smpl_core:`../smpl_core/bar.js`;内部互引:`./bar.js`。
- `smpl_edit/tests/x.test.js` → 被测模块:`../x.js`;→ smpl_core:`../../smpl_core/bar.js`。
- `label/src/**` → smpl_edit:`../../smpl_edit/foo.js`。
- `pcd_label/src/**` → smpl_edit:`../../smpl_edit/foo.js`;→ smpl_core:`../../smpl_core/bar.js`。
- `pcd_label/index.html` importmap → three:`../smpl_web_viewer/public/vendor/...`。

---

## 阶段 1:抽取 `smpl_edit/` 公共包(B 重构,零回归门槛)

搬运的模块(原样移动,仅改 import 路径深度):
`rotation_state.js` `annotation_store.js` `coco_document.js` `gizmo_frame.js`
`pose_gizmo.js` `root_handle.js` `transform_picker.js` `ik_controller.js`
`ik_handle.js` `ik_solver.js` `ik_chains.js` `ik_plugin.js` `ui_controller.js`
`joint_picker.js`。全部平铺到 `smpl_edit/`(无子目录)。

### Task 1: 移动模块文件到 smpl_edit/(git mv,保留历史)

**Files:**
- Move: `label/src/edit/{rotation_state,annotation_store,gizmo_frame,pose_gizmo,root_handle,transform_picker,ik_controller,ik_handle,ik_solver,ik_chains,ik_plugin}.js` → `smpl_edit/`
- Move: `label/src/io/coco_document.js` → `smpl_edit/coco_document.js`
- Move: `label/src/ui/{ui_controller,joint_picker}.js` → `smpl_edit/`

- [ ] **Step 1: 建目录并 git mv 全部 14 个模块**

```bash
cd /Users/penghaotian/Documents/pythonCode/temp2025.6/knowledge_work/label_mocap
mkdir -p smpl_edit/tests
git mv label/src/edit/rotation_state.js smpl_edit/rotation_state.js
git mv label/src/edit/annotation_store.js smpl_edit/annotation_store.js
git mv label/src/io/coco_document.js smpl_edit/coco_document.js
git mv label/src/edit/gizmo_frame.js smpl_edit/gizmo_frame.js
git mv label/src/edit/pose_gizmo.js smpl_edit/pose_gizmo.js
git mv label/src/edit/root_handle.js smpl_edit/root_handle.js
git mv label/src/edit/transform_picker.js smpl_edit/transform_picker.js
git mv label/src/edit/ik_controller.js smpl_edit/ik_controller.js
git mv label/src/edit/ik_handle.js smpl_edit/ik_handle.js
git mv label/src/edit/ik_solver.js smpl_edit/ik_solver.js
git mv label/src/edit/ik_chains.js smpl_edit/ik_chains.js
git mv label/src/edit/ik_plugin.js smpl_edit/ik_plugin.js
git mv label/src/ui/ui_controller.js smpl_edit/ui_controller.js
git mv label/src/ui/joint_picker.js smpl_edit/joint_picker.js
```

- [ ] **Step 2: 确认移动结果**

Run: `ls smpl_edit/`
Expected: 列出上述 14 个 .js 文件 + `tests/` 目录。

### Task 2: 修正 smpl_edit/ 内部 import 路径深度

模块从 `label/src/edit/`(深度 3 到根)移到 `smpl_edit/`(深度 1 到根),对 `smpl_core`
的相对路径由 `../../../smpl_core/` 变为 `../smpl_core/`。互引由各自原路径变为同目录 `./`。

**Files:**
- Modify: `smpl_edit/rotation_state.js:5`、`smpl_edit/gizmo_frame.js:6`、`smpl_edit/ik_solver.js:4`、`smpl_edit/ik_controller.js:10`(smpl_core 路径)
- Modify: `smpl_edit/pose_gizmo.js:4`、`smpl_edit/root_handle.js:4`、`smpl_edit/ik_handle.js:6`、`smpl_edit/ik_controller.js:8-9`、`smpl_edit/ik_plugin.js:10-11`(互引仍是 `./`,无需改——确认)

- [ ] **Step 1: 批量修 smpl_core 路径(`../../../` → `../`)**

```bash
cd /Users/penghaotian/Documents/pythonCode/temp2025.6/knowledge_work/label_mocap
sed -i '' "s#\.\./\.\./\.\./smpl_core/#../smpl_core/#g" \
  smpl_edit/rotation_state.js smpl_edit/gizmo_frame.js \
  smpl_edit/ik_solver.js smpl_edit/ik_controller.js
```

- [ ] **Step 2: 确认互引仍正确(同目录 `./`)**

Run: `grep -rnE "from '\./" smpl_edit/*.js`
Expected: `pose_gizmo.js`→`./gizmo_frame.js`、`root_handle.js`/`ik_handle.js`→`./transform_picker.js`、`ik_controller.js`→`./ik_solver.js`+`./ik_chains.js`、`ik_plugin.js`→`./ik_controller.js`+`./ik_handle.js`。都是同目录,无需改动。

- [ ] **Step 3: 确认无残留三级路径**

Run: `grep -rn "\.\./\.\./\.\./smpl_core" smpl_edit/`
Expected: 无输出(exit 1)。

### Task 3: 迁移公共单测到 smpl_edit/tests/

把不依赖 2D/相机的测试从 `label/tests/` 移到 `smpl_edit/tests/`,修 import。

迁移的测试:`rotation_state` `annotation_store` `coco_document` `gizmo_frame`
`ik_solver` `ik_chains` `ik_controller` `ui_controller` `rotations`(rotations 测的是
smpl_core,但与 gizmo 同源,留 label 也行——为聚合公共测试一并迁)。

**Files:**
- Move: `label/tests/{rotation_state,annotation_store,coco_document,gizmo_frame,ik_solver,ik_chains,ik_controller,ui_controller}.test.js` → `smpl_edit/tests/`

- [ ] **Step 1: git mv 测试文件**

```bash
cd /Users/penghaotian/Documents/pythonCode/temp2025.6/knowledge_work/label_mocap
for t in rotation_state annotation_store coco_document gizmo_frame ik_solver ik_chains ik_controller ui_controller; do
  git mv label/tests/$t.test.js smpl_edit/tests/$t.test.js
done
```

- [ ] **Step 2: 修测试内 import 路径**

测试从 `label/tests/`(深度 2)移到 `smpl_edit/tests/`(深度 2,但被测模块现在是上一级):
- 被测模块:`../src/edit/X.js` / `../src/io/X.js` / `../src/ui/X.js` → `../X.js`
- smpl_core:`../../smpl_core/X.js` → `../../smpl_core/X.js`(深度不变,保留)

```bash
cd /Users/penghaotian/Documents/pythonCode/temp2025.6/knowledge_work/label_mocap
sed -i '' \
  -e "s#'\.\./src/edit/#'../#g" \
  -e "s#'\.\./src/io/#'../#g" \
  -e "s#'\.\./src/ui/#'../#g" \
  smpl_edit/tests/*.test.js
```

- [ ] **Step 3: 确认测试 import 指向正确**

Run: `grep -rnE "^import" smpl_edit/tests/*.test.js | grep -vE "node:|'\.\./(\.\./smpl_core/)?[a-z_]+\.js'"`
Expected: 无输出(所有 import 要么是 node 内置,要么指向 `../X.js` 或 `../../smpl_core/X.js`)。

- [ ] **Step 4: 跑迁移后的公共测试**

Run: `node --test smpl_edit/tests/*.test.js`
Expected: 全部 PASS(rotation_state/annotation_store/coco_document/gizmo_frame/ik_solver/ik_chains/ik_controller/ui_controller)。ik_controller 测试会加载 SMPL 模型,确认其内部对 smpl_core 的路径(`../../smpl_core/`)仍正确。

### Task 4: 更新 label/ 对已移动模块的 import 路径

label 仍要用这些编辑内核,但现在从 `smpl_edit/` 引。涉及 `app.js` 和已留在 label 的
模块(无——所有互引模块都一起搬走了,只剩 `app.js` 引用它们)。

label 内对被移动模块的引用(已 grep 确认):仅 `label/src/app.js` 的这些行。
深度:`label/src/app.js` → `smpl_edit/` 是 `../../smpl_edit/`。

**Files:**
- Modify: `label/src/app.js`(6,9,12,13,14,18,19,20 行的 import)

- [ ] **Step 1: 改 app.js 的 8 条 import**

```bash
cd /Users/penghaotian/Documents/pythonCode/temp2025.6/knowledge_work/label_mocap
sed -i '' \
  -e "s#from '\./io/coco_document\.js'#from '../../smpl_edit/coco_document.js'#" \
  -e "s#from '\./edit/annotation_store\.js'#from '../../smpl_edit/annotation_store.js'#" \
  -e "s#from '\./edit/rotation_state\.js'#from '../../smpl_edit/rotation_state.js'#" \
  -e "s#from '\./ui/ui_controller\.js'#from '../../smpl_edit/ui_controller.js'#" \
  -e "s#from '\./ui/joint_picker\.js'#from '../../smpl_edit/joint_picker.js'#" \
  -e "s#from '\./edit/root_handle\.js'#from '../../smpl_edit/root_handle.js'#" \
  -e "s#from '\./edit/pose_gizmo\.js'#from '../../smpl_edit/pose_gizmo.js'#" \
  -e "s#from '\./edit/ik_plugin\.js'#from '../../smpl_edit/ik_plugin.js'#" \
  label/src/app.js
```

- [ ] **Step 2: 确认 label 不再本地引用已移动模块**

Run: `grep -nE "(coco_document|annotation_store|rotation_state|ui_controller|joint_picker|root_handle|pose_gizmo|ik_plugin)" label/src/app.js`
Expected: 全部指向 `../../smpl_edit/`。

- [ ] **Step 3: 确认 label/src 下已无遗留对旧路径的引用**

Run: `grep -rnE "from '\.\.?/(edit|io|ui)/(rotation_state|annotation_store|coco_document|gizmo_frame|pose_gizmo|root_handle|transform_picker|ik_controller|ik_handle|ik_solver|ik_chains|ik_plugin|ui_controller|joint_picker)\.js'" label/src/`
Expected: 无输出(exit 1)。

### Task 5: 跑 label 全套测试 + 确认零回归

**Files:** 无(纯验证)

- [ ] **Step 1: 跑 label 剩余测试**

Run: `node --test label/tests/*.test.js`
Expected: 全部 PASS。label 剩余测试:`bbox_edit` `dataset_paths` `derived` `image_order` `projection` `source_loader` `view_zoom` `lbs_worldrot`(均不依赖已移动模块)。

- [ ] **Step 2: 跑全仓 web 测试集**

Run: `npm run test:web`
Expected: 全部 PASS。注意 `package.json` 的 `test:web` 现在还指向 `label/tests/*.test.js`;迁移到 smpl_edit 的测试需要加入(见 Step 3)。

- [ ] **Step 3: 把 smpl_edit/tests 纳入 test:web**

**Files:** Modify `package.json`

将 `test:web` 脚本改为同时包含 smpl_edit 测试:

```json
"test:web": "node --test smpl_web_viewer/tests/*.test.js label/tests/*.test.js smpl_edit/tests/*.test.js tests/smpl_viewer_local_data.test.js",
```

- [ ] **Step 4: 复跑确认**

Run: `npm run test:web`
Expected: 全部 PASS(含 smpl_edit/tests)。

- [ ] **Step 5: 浏览器人工走查 label(零回归门槛)**

Run: `npm run serve:label`,浏览器开 http://127.0.0.1:5175/label/,打开样例 2D 数据集(/Users/penghaotian/Downloads/20260609/test_data),确认:加载渲染、帧导航、Pose/Root/Bbox/Beta 编辑、IK 开关、撤销、保存均与重构前一致。
Expected: 行为无变化。若有异常,停下修复后再继续。

- [ ] **Step 6: 提交阶段 1**

```bash
cd /Users/penghaotian/Documents/pythonCode/temp2025.6/knowledge_work/label_mocap
git add -A
git commit -m "refactor(smpl_edit): extract shared world-space editing core from label

Move rotation_state/annotation_store/coco_document/gizmo_frame/pose_gizmo/
root_handle/transform_picker/ik_*/ui_controller/joint_picker into smpl_edit/,
repoint label imports, migrate shared tests. label behavior unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## 阶段 2:`pcd_label/` 点云解码 + 坐标轴(纯逻辑,TDD)

先建纯逻辑模块(Node 可单测,无 three.js / 无 DOM):点云解码、坐标轴映射、manifest 解析。

### Task 6: 点云解码核心 `decodeXYZ`(纯逻辑)

把一帧 PNG 的 RGB 像素缓冲(`Uint8ClampedArray`,RGBA 或 RGB)解码成有效点的
`Float32Array` 位置缓冲。解码逻辑与 DOM 无关——传入已解出的像素数组,便于单测。

**Files:**
- Create: `pcd_label/src/scene/point_cloud_decode.js`
- Test: `pcd_label/tests/point_cloud_decode.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
// pcd_label/tests/point_cloud_decode.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeXYZ } from '../src/scene/point_cloud_decode.js';

// 构造一个 1x1 point 的最小帧:point_width=1, point_height=1, 图像高=3。
// band0(row0)=X, band1(row1)=Y, band2(row2)=Z。RGBA 像素(每像素4字节)。
// 取 scale=1000, center=256。要编码 X=1.0 → encoded=(1.0+256)*1000=257000=0x03EBA8。
function rgbaFrame(encs) {
  // encs: [encX, encY, encZ] 三个 24 位整数;返回 3 像素的 RGBA(高/中/低 -> R/G/B)
  const out = new Uint8ClampedArray(3 * 4);
  encs.forEach((e, i) => {
    out[i * 4 + 0] = (e >> 16) & 0xff;
    out[i * 4 + 1] = (e >> 8) & 0xff;
    out[i * 4 + 2] = e & 0xff;
    out[i * 4 + 3] = 255;
  });
  return out;
}

test('decodeXYZ decodes one valid point', () => {
  const encX = Math.round((1.0 + 256) * 1000);
  const encY = Math.round((-2.0 + 256) * 1000);
  const encZ = Math.round((0.5 + 256) * 1000);
  const px = rgbaFrame([encX, encY, encZ]);
  const r = decodeXYZ(px, { pointWidth: 1, pointHeight: 1, scale: 1000, center: 256, channels: 4 });
  assert.equal(r.count, 1);
  assert.ok(Math.abs(r.positions[0] - 1.0) < 1e-3);
  assert.ok(Math.abs(r.positions[1] - (-2.0)) < 1e-3);
  assert.ok(Math.abs(r.positions[2] - 0.5) < 1e-3);
});

test('decodeXYZ skips points whose encoded value is 0 in any band', () => {
  const px = rgbaFrame([0, 0, 0]); // all-zero -> invalid
  const r = decodeXYZ(px, { pointWidth: 1, pointHeight: 1, scale: 1000, center: 256, channels: 4 });
  assert.equal(r.count, 0);
  assert.equal(r.positions.length, 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test pcd_label/tests/point_cloud_decode.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 decodeXYZ**

```javascript
// pcd_label/src/scene/point_cloud_decode.js
// 把导出端 PNG（RGB888 三段 band = X/Y/Z）的像素缓冲解码成有效点位置缓冲。
// 像素布局：图像宽 = pointWidth，图像高 = pointHeight*3；band b 的第 row 行在图像
// 第 b*pointHeight+row 行。每像素 RGB = 24 位整数高/中/低字节，encoded=(R<<16)|(G<<8)|B，
// value = encoded/scale - center；encoded==0 为无效点（任一 band 为 0 即丢弃该点）。
export function decodeXYZ(pixels, { pointWidth, pointHeight, scale, center, channels = 4 }) {
  const n = pointWidth * pointHeight;
  const positions = new Float32Array(n * 3);
  // 每点在三段 band 同一 (row,col) 取 X/Y/Z；像素线性索引 = (band*pointHeight+row)*pointWidth+col。
  let count = 0;
  for (let row = 0; row < pointHeight; row++) {
    for (let col = 0; col < pointWidth; col++) {
      const enc = (b) => {
        const px = ((b * pointHeight + row) * pointWidth + col) * channels;
        return (pixels[px] << 16) | (pixels[px + 1] << 8) | pixels[px + 2];
      };
      const ex = enc(0), ey = enc(1), ez = enc(2);
      if (ex === 0 || ey === 0 || ez === 0) continue; // 无效点
      positions[count * 3 + 0] = ex / scale - center;
      positions[count * 3 + 1] = ey / scale - center;
      positions[count * 3 + 2] = ez / scale - center;
      count++;
    }
  }
  return { positions: positions.subarray(0, count * 3), count };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test pcd_label/tests/point_cloud_decode.test.js`
Expected: PASS（2 个测试）。

- [ ] **Step 5: 提交**

```bash
git add pcd_label/src/scene/point_cloud_decode.js pcd_label/tests/point_cloud_decode.test.js
git commit -m "feat(pcd): PNG XYZ decode core with invalid-point skipping"
```

### Task 7: 配色 colormap（纯逻辑）

把标量（Z/range 归一化到 [0,1]）映射成 RGB，供 4 种配色之一使用。实现一个 turbo
近似查找(纯函数)+ 一个最值/分位归一化辅助。

**Files:**
- Create: `pcd_label/src/scene/colormap.js`
- Test: `pcd_label/tests/colormap.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
// pcd_label/tests/colormap.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { turbo, normalizeRange } from '../src/scene/colormap.js';

test('turbo returns rgb in [0,1] and is monotonic-ish at ends', () => {
  const lo = turbo(0), hi = turbo(1);
  for (const c of [...lo, ...hi]) assert.ok(c >= 0 && c <= 1);
  // turbo: low end is dark blue-ish (b > r), high end is dark red-ish (r > b)
  assert.ok(lo[2] > lo[0]);
  assert.ok(hi[0] > hi[2]);
});

test('normalizeRange clamps to [0,1] with given lo/hi', () => {
  assert.equal(normalizeRange(5, 0, 10), 0.5);
  assert.equal(normalizeRange(-3, 0, 10), 0);
  assert.equal(normalizeRange(99, 0, 10), 1);
  assert.equal(normalizeRange(5, 5, 5), 0); // 退化区间 → 0
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test pcd_label/tests/colormap.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 colormap**

```javascript
// pcd_label/src/scene/colormap.js
// turbo colormap 多项式近似（Google AI turbo 的低阶拟合），输入 t∈[0,1]，输出 [r,g,b]∈[0,1]。
export function turbo(t) {
  const x = Math.min(1, Math.max(0, t));
  const r = 0.13572138 + x * (4.61539260 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))));
  const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))));
  const b = 0.10667330 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))));
  return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))];
}

// 把 v 归一化到 [0,1]，区间 [lo,hi]，越界钳制；退化区间返回 0。
export function normalizeRange(v, lo, hi) {
  if (hi <= lo) return 0;
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test pcd_label/tests/colormap.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add pcd_label/src/scene/colormap.js pcd_label/tests/colormap.test.js
git commit -m "feat(pcd): turbo colormap + range normalize (pure)"
```

### Task 8: 坐标轴映射 `axisFrameMatrix`（纯逻辑）

给定「上轴 + 前轴」，产出一个把数据系点变换到 three.js 显示系（Y-up、相机看 -Z、
右手系 X 向右）的 3×3 旋转矩阵（row-major 长度 9）。SMPL 活在 three.js 显示系。

显示系约定（与 label/three.js 一致）：**up = +Y**，**front（人/场景朝向相机的方向）
= -Z**，**right = +X**。映射规则：把数据系的 up 轴映到 +Y，front 轴映到 -Z，
right 轴（= up × front 的合适手性）映到 +X。

**Files:**
- Create: `pcd_label/src/scene/axis_frame.js`
- Test: `pcd_label/tests/axis_frame.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
// pcd_label/tests/axis_frame.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { axisFrameMatrix, applyMat3, AXIS_OPTIONS } from '../src/scene/axis_frame.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const vclose = (a, b) => a.forEach((v, i) => close(v, b[i]));

test('Z-up / X-front maps data up(+Z)->+Y and front(+X)->-Z', () => {
  const M = axisFrameMatrix('Z', 'X');
  // 数据 up = +Z 应落到 three +Y
  vclose(applyMat3(M, [0, 0, 1]), [0, 1, 0]);
  // 数据 front = +X 应落到 three -Z
  vclose(applyMat3(M, [1, 0, 0]), [0, 0, -1]);
});

test('Y-up / Z-front is identity-up and front(+Z)->-Z', () => {
  const M = axisFrameMatrix('Y', 'Z');
  vclose(applyMat3(M, [0, 1, 0]), [0, 1, 0]);
  vclose(applyMat3(M, [0, 0, 1]), [0, 0, -1]);
});

test('matrix is orthonormal (rows unit length, mutually perpendicular)', () => {
  const M = axisFrameMatrix('Z', 'X');
  const r0 = [M[0], M[1], M[2]], r1 = [M[3], M[4], M[5]], r2 = [M[6], M[7], M[8]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  close(dot(r0, r0), 1); close(dot(r1, r1), 1); close(dot(r2, r2), 1);
  close(dot(r0, r1), 0); close(dot(r1, r2), 0); close(dot(r0, r2), 0);
});

test('AXIS_OPTIONS lists valid front axes per up axis', () => {
  assert.deepEqual(AXIS_OPTIONS.Z, ['X', 'Y']);
  assert.deepEqual(AXIS_OPTIONS.Y, ['X', 'Z']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test pcd_label/tests/axis_frame.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 axis_frame**

```javascript
// pcd_label/src/scene/axis_frame.js
// 数据坐标系 → three.js 显示系（up=+Y, front=-Z, right=+X）的基变换。
// 用户选「上轴(up) + 前轴(front)」，本模块据此构造正交 3×3（row-major 长度 9）。
//
// 思路：在数据系里取出 up、front 的单位向量（含正负），right = front × up（右手），
// 再把列 [right, up, -front] 解为「数据基」，则把数据点 p 映到显示系 = Basisᵀ · p，
// 使 up->+Y、front->-Z、right->+X。

const UNIT = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
export const AXIS_OPTIONS = { Z: ['X', 'Y'], Y: ['X', 'Z'] };

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// up/front 为 'X'|'Y'|'Z'（取正方向）。返回 row-major 长度 9 矩阵。
export function axisFrameMatrix(up, front) {
  const u = UNIT[up];
  const f = UNIT[front];
  const right = cross(f, u); // 右手：right = front × up
  // 数据基的列向量在数据系中的坐标：col0=right(->+X), col1=u(->+Y), col2=-f(->-Z)。
  // 显示坐标 = Basisᵀ · p，其中 Basis 的列是 [right, u, -f]。Basisᵀ 的行即这三个向量。
  const negF = [-f[0], -f[1], -f[2]];
  return [
    right[0], right[1], right[2],
    u[0], u[1], u[2],
    negF[0], negF[1], negF[2],
  ];
}

// row-major 3×3 乘 3 向量。
export function applyMat3(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
  ];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test pcd_label/tests/axis_frame.test.js`
Expected: PASS（4 个测试）。若 orthonormal 或方向不符，检查 cross 手性与列定义。

- [ ] **Step 5: 提交**

```bash
git add pcd_label/src/scene/axis_frame.js pcd_label/tests/axis_frame.test.js
git commit -m "feat(pcd): data->display axis-frame matrix (up/front configurable)"
```

### Task 9: manifest 解析 + 帧名生成（纯逻辑）

解析 `manifest.json`，给出帧数、帧文件名生成器、解码所需参数。

**Files:**
- Create: `pcd_label/src/io/manifest.js`
- Test: `pcd_label/tests/manifest.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
// pcd_label/tests/manifest.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseManifest, frameFileName } from '../src/io/manifest.js';

const RAW = {
  format: 'png-sequence', frame_pattern: 'frame_%06d.png', frame_count: 176, fps: 10,
  point_width: 800, point_height: 780, image_width: 800, image_height: 2340,
  png_channel_order: 'RGB_HIGH_MID_LOW', scale: 1000, center: 256,
};

test('parseManifest extracts decode params', () => {
  const m = parseManifest(RAW);
  assert.equal(m.frameCount, 176);
  assert.equal(m.pointWidth, 800);
  assert.equal(m.pointHeight, 780);
  assert.equal(m.scale, 1000);
  assert.equal(m.center, 256);
  assert.equal(m.fps, 10);
});

test('frameFileName formats %06d', () => {
  assert.equal(frameFileName('frame_%06d.png', 0), 'frame_000000.png');
  assert.equal(frameFileName('frame_%06d.png', 175), 'frame_000175.png');
});

test('parseManifest throws on wrong format', () => {
  assert.throws(() => parseManifest({ format: 'avi' }), /png-sequence/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test pcd_label/tests/manifest.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现 manifest**

```javascript
// pcd_label/src/io/manifest.js
// 解析导出端 manifest.json（lidar_pcap_export_pointcloud_frames.cpp 的 png-sequence）。
export function parseManifest(raw) {
  if (!raw || raw.format !== 'png-sequence') {
    throw new Error(`unsupported manifest format: ${raw && raw.format} (expected png-sequence)`);
  }
  return {
    framePattern: raw.frame_pattern,
    frameCount: raw.frame_count,
    fps: raw.fps ?? 10,
    pointWidth: raw.point_width,
    pointHeight: raw.point_height,
    scale: raw.scale,
    center: raw.center,
  };
}

// 把 'frame_%06d.png' + 帧序号格式化成文件名（仅支持 %0Nd）。
export function frameFileName(pattern, index) {
  return pattern.replace(/%0(\d+)d/, (_, w) => String(index).padStart(Number(w), '0'));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test pcd_label/tests/manifest.test.js`
Expected: PASS（3 个测试）。

- [ ] **Step 5: 把 pcd_label/tests 纳入 test:web 并提交**

**Files:** Modify `package.json`（`test:web` 追加 `pcd_label/tests/*.test.js`）

```json
"test:web": "node --test smpl_web_viewer/tests/*.test.js label/tests/*.test.js smpl_edit/tests/*.test.js pcd_label/tests/*.test.js tests/smpl_viewer_local_data.test.js",
```

Run: `npm run test:web`
Expected: 全部 PASS。

```bash
git add pcd_label/src/io/manifest.js pcd_label/tests/manifest.test.js package.json
git commit -m "feat(pcd): manifest parse + frame-name format; wire pcd tests into test:web"
```

## 阶段 3:`pcd_label/` three.js 渲染层（浏览器验证）

three.js / WebGL / DOM 部分无 Node 单测，靠浏览器走查（与 label 约定一致）。

### Task 10: 点云渲染对象 `PointCloud`（THREE.Points + 配色 + 抽稀）

封装一个 `THREE.Points`：吃解码后的 positions + 标量，按配色模式算每点 color，
支持抽稀比例与点大小。配色用 Task 6/7/8 的纯函数；坐标用 Task 8 的矩阵预变换到显示系。

**Files:**
- Create: `pcd_label/src/scene/point_cloud.js`

- [ ] **Step 1: 实现 PointCloud**

```javascript
// pcd_label/src/scene/point_cloud.js
import * as THREE from 'three';
import { turbo, normalizeRange } from './colormap.js';
import { applyMat3 } from './axis_frame.js';

// 配色模式：'height'(Z) | 'range' | 'axis'(XYZ->RGB) | 'solid'
export class PointCloud {
  constructor() {
    this._geom = new THREE.BufferGeometry();
    this._mat = new THREE.PointsMaterial({ size: 0.03, vertexColors: true, sizeAttenuation: true });
    this.object = new THREE.Points(this._geom, this._mat);
    this.object.frustumCulled = false;
    this._raw = null;        // { positions:Float32Array(displaySpace), count }
    this._mode = 'height';
    this._stride = 1;        // 抽稀步长（1=全量）
    this._solid = [0.8, 0.85, 0.9];
  }

  // 用「数据系 positions」+ 轴变换矩阵 M 设置点云：先把每点变换到显示系并缓存。
  setData({ positions, count }, M) {
    const disp = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const p = applyMat3(M, [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
      disp[i * 3] = p[0]; disp[i * 3 + 1] = p[1]; disp[i * 3 + 2] = p[2];
    }
    this._raw = { positions: disp, count };
    this._rebuild();
  }

  setColorMode(mode) { this._mode = mode; this._rebuild(); }
  setDecimation(ratio) { this._stride = Math.max(1, Math.round(1 / Math.min(1, Math.max(0.01, ratio)))); this._rebuild(); }
  setPointSize(s) { this._mat.size = s; }
  setSolidColor(rgb) { this._solid = rgb; if (this._mode === 'solid') this._rebuild(); }

  _rebuild() {
    if (!this._raw) return;
    const { positions, count } = this._raw;
    const stride = this._stride;
    const kept = Math.ceil(count / stride);
    const pos = new Float32Array(kept * 3);
    const col = new Float32Array(kept * 3);
    // 先扫一遍求 Z / range 的 2%/98% 分位近似（用 min/max 简化：取全量 min/max）。
    let zmin = Infinity, zmax = -Infinity, rmax = 0;
    for (let i = 0; i < count; i += stride) {
      const y = positions[i * 3 + 1]; // 显示系 up=+Y → 高度取 Y
      if (y < zmin) zmin = y; if (y > zmax) zmax = y;
      const r = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      if (r > rmax) rmax = r;
    }
    let k = 0;
    for (let i = 0; i < count; i += stride) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      let c;
      if (this._mode === 'height') c = turbo(normalizeRange(y, zmin, zmax));
      else if (this._mode === 'range') c = turbo(normalizeRange(Math.hypot(x, y, z), 0, rmax || 1));
      else if (this._mode === 'axis') c = [normalizeRange(x, -10, 10), normalizeRange(y, -10, 10), normalizeRange(z, -10, 10)];
      else c = this._solid;
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
      k++;
    }
    this._geom.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
    this._geom.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, k * 3), 3));
    this._geom.attributes.position.needsUpdate = true;
    this._geom.attributes.color.needsUpdate = true;
  }

  setVisible(v) { this.object.visible = v; }
  dispose() { this._geom.dispose(); this._mat.dispose(); }
}
```

> 注:`axis` 模式的 `[-10,10]` 归一化区间是经验值(样例 X∈[0.6,37.6] 等),Task 14
> 浏览器走查时若色彩失衡可调,非阻塞。height 取显示系 +Y(数据 up 已映射到 +Y)。

- [ ] **Step 2: 浏览器冒烟(并入 Task 14 整体走查)**

本任务无 Node 测试。语法/导入正确性在 Task 14 加载真实数据时验证。

- [ ] **Step 3: 提交**

```bash
git add pcd_label/src/scene/point_cloud.js
git commit -m "feat(pcd): PointCloud render object (colormap modes + decimation)"
```

### Task 11: 自由 orbit 相机 `OrbitCam`

纯 3D 自由 orbit（无 2D snap、无内参、无 setViewOffset）。包一层 OrbitControls，
给 scene 提供 camera + controls + resize。

**Files:**
- Create: `pcd_label/src/scene/orbit_cam.js`

- [ ] **Step 1: 实现 OrbitCam**

```javascript
// pcd_label/src/scene/orbit_cam.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 纯自由 orbit 相机：透视 + OrbitControls。无 2D/内参概念。
export class OrbitCam {
  constructor({ canvas }) {
    this.mode = '3d'; // 恒为 3d；保留字段供编辑基元的 getMode 复用
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(0, 2, 6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1, 0);
  }

  // 把视角对准某世界点（首帧加载时居中人/点云）。
  lookAtTarget(vec3) {
    this.controls.target.set(vec3.x, vec3.y, vec3.z);
    this.controls.update();
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update() { this.controls.update(); }
}
```

- [ ] **Step 2: 提交**

```bash
git add pcd_label/src/scene/orbit_cam.js
git commit -m "feat(pcd): free-orbit perspective camera wrapper"
```

### Task 12: 场景 `PcdScene`（点云 + SMPL mesh/joints/bones + grid/axes）

three.js 场景容器。复用 label scene 的 SMPL mesh/joints/bones 构建（BONES/BONE_COLORS
拷贝过来，去掉背景图/frustum/bg 平面），加入点云对象。

**Files:**
- Create: `pcd_label/src/scene/pcd_scene.js`

- [ ] **Step 1: 实现 PcdScene**

```javascript
// pcd_label/src/scene/pcd_scene.js
import * as THREE from 'three';
import { PointCloud } from './point_cloud.js';

const BONES = [
  [0,3,0],[3,6,0],[6,9,0],[9,12,0],[12,15,0],
  [9,13,1],[13,16,1],[16,18,1],[18,20,1],[20,22,1],
  [9,14,2],[14,17,2],[17,19,2],[19,21,2],[21,23,2],
  [0,1,3],[1,4,3],[4,7,3],[7,10,3],
  [0,2,4],[2,5,4],[5,8,4],[8,11,4],
];
const BONE_COLORS = [0xd4b800, 0x4da6ff, 0xff7733, 0x33cc66, 0xcc44cc];

export class PcdScene {
  constructor(canvas) {
    this._canvas = canvas;
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._renderer.setClearColor(0x05070a, 1);
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;

    this._scene = new THREE.Scene();
    this._scene.add(new THREE.HemisphereLight(0xddeeff, 0x223344, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.8); key.position.set(3, 5, 2);
    this._scene.add(key);
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.2));

    this._cam = null;
    this._mesh = null; this._jointsGroup = null; this._bonesGroup = null;
    this._lastJoints = null; this._personVisible = false;
    this._flags = { points: true, mesh: true, joints: true, bones: true, grid: true, axes: false };

    this.pointCloud = new PointCloud();
    this._scene.add(this.pointCloud.object);

    this._grid = new THREE.GridHelper(20, 40, 0x6695c8, 0x33455a);
    this._grid.material.opacity = 0.5; this._grid.material.transparent = true; this._scene.add(this._grid);
    this._axes = new THREE.AxesHelper(1.0); this._scene.add(this._axes);
  }

  threeScene() { return this._scene; }
  setCamera(cam) { this._cam = cam; }
  jointMeshes() { return this._jointsGroup ? this._jointsGroup.children : []; }
  jointWorldPosition(j) { return this._lastJoints ? [this._lastJoints[j*3], this._lastJoints[j*3+1], this._lastJoints[j*3+2]] : [0,0,0]; }
  meshObject() { return this._mesh; }

  setSelectedJoint(smplIndex) {
    if (!this._jointsGroup) return;
    this._jointsGroup.children.forEach((s, i) => {
      const sel = (i === smplIndex);
      s.material.color.set(sel ? 0x33ff88 : 0xffffff);
      s.scale.setScalar(sel ? 1.8 : 1.0);
    });
  }

  setTopology(faces) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
    this._mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ color: 0xf0c0a0, side: THREE.DoubleSide }));
    this._mesh.frustumCulled = false; this._mesh.renderOrder = 5; this._scene.add(this._mesh);

    this._jointsGroup = new THREE.Group(); this._jointsGroup.frustumCulled = false;
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false }));
      s.userData.jointIndex = i; s.frustumCulled = false; s.renderOrder = 11;
      this._jointsGroup.add(s);
    }
    this._scene.add(this._jointsGroup);

    this._bonesGroup = new THREE.Group(); this._bonesGroup.frustumCulled = false;
    for (const [, , g] of BONES) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: BONE_COLORS[g], depthTest: false }));
      line.frustumCulled = false; line.renderOrder = 11; this._bonesGroup.add(line);
    }
    this._scene.add(this._bonesGroup);
  }

  updateMesh(vertices, joints) {
    if (!this._mesh) return;
    this._lastJoints = joints;
    const pos = this._mesh.geometry.attributes.position;
    if (!pos || pos.array.length !== vertices.length) {
      this._mesh.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices.length), 3));
    }
    this._mesh.geometry.attributes.position.array.set(vertices);
    this._mesh.geometry.attributes.position.needsUpdate = true;
    this._mesh.geometry.computeVertexNormals();
    for (let j = 0; j < 24; j++) this._jointsGroup.children[j].position.set(joints[j*3], joints[j*3+1], joints[j*3+2]);
    for (let bi = 0; bi < BONES.length; bi++) {
      const [a, b] = BONES[bi];
      this._bonesGroup.children[bi].geometry.setFromPoints([
        new THREE.Vector3(joints[a*3], joints[a*3+1], joints[a*3+2]),
        new THREE.Vector3(joints[b*3], joints[b*3+1], joints[b*3+2]),
      ]);
      this._bonesGroup.children[bi].geometry.attributes.position.needsUpdate = true;
    }
  }

  setPersonVisible(v) { this._personVisible = v; this._applyVisibility(); }
  setFlag(key, v) { this._flags[key] = v; this._applyVisibility(); }

  _applyVisibility() {
    this.pointCloud.setVisible(this._flags.points);
    if (this._mesh) this._mesh.visible = this._flags.mesh && this._personVisible;
    if (this._jointsGroup) this._jointsGroup.visible = this._flags.joints && this._personVisible;
    if (this._bonesGroup) this._bonesGroup.visible = this._flags.bones && this._personVisible;
    if (this._grid) this._grid.visible = this._flags.grid;
    if (this._axes) this._axes.visible = this._flags.axes;
  }

  resize() {
    const parent = this._canvas.parentElement;
    const w = parent.clientWidth, h = parent.clientHeight;
    if (w <= 0 || h <= 0 || !this._cam) return;
    this._canvas.style.width = `${w}px`; this._canvas.style.height = `${h}px`;
    this._renderer.setSize(w, h, false);
    this._cam.resize(w, h);
  }

  render() {
    if (!this._cam) return;
    this._applyVisibility();
    this._cam.update();
    this._renderer.render(this._scene, this._cam.camera);
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add pcd_label/src/scene/pcd_scene.js
git commit -m "feat(pcd): three.js scene (point cloud + SMPL mesh/joints/bones/grid/axes)"
```

## 阶段 4:`pcd_label/` IO + PNG 加载

### Task 13: 序列目录源 `PcdDirSource`

包一层 FileSystemDirectoryHandle:读 manifest、按帧序读 PNG File、读写标注 json。
复用 label `dir_source.js` 的 FS Access 辅助思路,但简化为「单序列目录」语义。

**Files:**
- Create: `pcd_label/src/io/pcd_dir_source.js`

- [ ] **Step 1: 实现 PcdDirSource**

```javascript
// pcd_label/src/io/pcd_dir_source.js
// 单序列目录:含 manifest.json + frame_%06d.png（+ 可选 player_0.json 标注）。
import { parseManifest, frameFileName } from './manifest.js';

export function fsAccessSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}
export async function pickDirectory() {
  return window.showDirectoryPicker({ mode: 'readwrite' });
}

const ANNO_NAME = 'player_0.json';

export class PcdDirSource {
  constructor(dirHandle) { this._dir = dirHandle; this._manifest = null; }

  async readManifest() {
    const fh = await this._dir.getFileHandle('manifest.json');
    const raw = JSON.parse(await (await fh.getFile()).text());
    this._manifest = parseManifest(raw);
    return this._manifest;
  }

  // 第 i 帧的 PNG File 对象。
  async frameFile(i) {
    const name = frameFileName(this._manifest.framePattern, i);
    const fh = await this._dir.getFileHandle(name);
    return fh.getFile();
  }

  // 已有标注 json（player_0.json）则返回其原始对象，否则 null。
  async readAnnotation() {
    try {
      const fh = await this._dir.getFileHandle(ANNO_NAME);
      return JSON.parse(await (await fh.getFile()).text());
    } catch { return null; }
  }

  // 原地写标注 json 到序列目录。
  async saveAnnotation(obj) {
    const fh = await this._dir.getFileHandle(ANNO_NAME, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(obj, null, 2));
    await w.close();
    return ANNO_NAME;
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add pcd_label/src/io/pcd_dir_source.js
git commit -m "feat(pcd): single-sequence directory source (manifest/frame/annotation IO)"
```

### Task 14: PNG → 像素 解码桥 `decodePngFile`

把一个 PNG `File` 解到 `decodeXYZ` 需要的像素缓冲(用 `createImageBitmap` +
`OffscreenCanvas`)。这是 DOM 部分,无 Node 测试,Task 16 走查验证。

**Files:**
- Create: `pcd_label/src/io/png_pixels.js`

- [ ] **Step 1: 实现 png_pixels**

```javascript
// pcd_label/src/io/png_pixels.js
// 把 PNG File 解码成 RGBA 像素缓冲（Uint8ClampedArray, channels=4）+ 宽高。
export async function decodePngFile(file) {
  const bmp = await createImageBitmap(file);
  const w = bmp.width, h = bmp.height;
  const cnv = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close && bmp.close();
  const { data } = ctx.getImageData(0, 0, w, h);
  return { pixels: data, width: w, height: h, channels: 4 };
}
```

- [ ] **Step 2: 提交**

```bash
git add pcd_label/src/io/png_pixels.js
git commit -m "feat(pcd): decode PNG File to RGBA pixel buffer"
```

## 阶段 5:`pcd_label/` UI 面板 + 装配 + 页面

### Task 15: 编辑面板 `PcdPanels`（Pose/Root euler + pos + beta，无内参）

基于 label 的 `panels.js` 裁剪:去掉内参(k-*)绑定与 bbox 读出,保留 pose/root 欧拉
输入、root_pos 输入、beta 滑杆、关节角只读。结构与事务(begin/commit 防双提交)照搬。

**Files:**
- Create: `pcd_label/src/ui/pcd_panels.js`

- [ ] **Step 1: 实现 PcdPanels（照搬 label panels，去内参/bbox）**

```javascript
// pcd_label/src/ui/pcd_panels.js
// 数值/滑杆读出 + 编辑面板。裁剪自 label/src/ui/panels.js：去掉相机内参与 bbox。
import { JOINT_NAMES } from '../../../smpl_core/joint_names.js';

const $ = (id) => document.getElementById(id);
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const ANGLES = [
  ['R-Elbow', 16, 18, 20], ['L-Elbow', 17, 19, 21],
  ['R-Knee', 1, 4, 7], ['L-Knee', 2, 5, 8],
  ['R-Shoulder', 9, 16, 18], ['L-Shoulder', 9, 17, 19],
  ['R-Hip', 0, 1, 4], ['L-Hip', 0, 2, 5],
  ['Spine', 0, 6, 12],
];

export class PcdPanels {
  constructor({ getRotation, getStore, getUI, getLastJoints, onEdit }) {
    this._getRotation = getRotation;
    this._getStore = getStore;
    this._getUI = getUI;
    this._getLastJoints = getLastJoints;
    this._onEdit = onEdit;
    this._betaEditing = false;
    this._activeDragEl = null;
    this._bindEulerInputs();
    this._buildBetaSliders();
    this._bindPosInputs();
  }

  _readOnly() { const ui = this._getUI(); return !!(ui && ui.readOnly); }

  _setVal(el, v) {
    if (!el) return;
    if (el === this._activeDragEl) return;
    if (el === document.activeElement && el.type !== 'range') return;
    el.value = v;
  }

  syncFromState() {
    const rot = this._getRotation();
    const store = this._getStore();
    const ui = this._getUI();
    const cur = store ? store.current() : null;

    const clearSet = (prefix) => {
      for (const id of [`${prefix}-eul-x`, `${prefix}-eul-y`, `${prefix}-eul-z`, `${prefix}-eul-x-s`, `${prefix}-eul-y-s`, `${prefix}-eul-z-s`]) this._setVal($(id), '');
    };
    const writeSet = (prefix, e) => {
      const dx = (e[0] * DEG).toFixed(1), dy = (e[1] * DEG).toFixed(1), dz = (e[2] * DEG).toFixed(1);
      this._setVal($(`${prefix}-eul-x`), dx); this._setVal($(`${prefix}-eul-y`), dy); this._setVal($(`${prefix}-eul-z`), dz);
      this._setVal($(`${prefix}-eul-x-s`), dx); this._setVal($(`${prefix}-eul-y-s`), dy); this._setVal($(`${prefix}-eul-z-s`), dz);
    };

    if (!rot || !cur) {
      clearSet('pose'); clearSet('root');
      for (const id of ['pos-x', 'pos-y', 'pos-z']) this._setVal($(id), '');
      $('angle-list').innerHTML = '';
    } else {
      if (ui && ui.mode === 'pose' && ui.selectedJoint != null) writeSet('pose', rot.getJointEuler(ui.selectedJoint));
      else clearSet('pose');
      writeSet('root', rot.getRootEuler());
      const p = cur.root_pos || [0, 0, 0];
      this._setVal($('pos-x'), (+p[0]).toFixed(3));
      this._setVal($('pos-y'), (+p[1]).toFixed(3));
      this._setVal($('pos-z'), (+p[2]).toFixed(3));
      const lj = this._getLastJoints();
      if (lj) this.renderAngles(lj);
      const betas = cur.betas || [];
      for (let i = 0; i < 10; i++) { const s = $(`beta-${i}`); if (s) this._setVal(s, String(betas[i] ?? 0)); }
    }
  }

  renderAngles(joints) {
    const html = ANGLES.map(([label, a, v, b]) => {
      const ax = joints[a*3]-joints[v*3], ay = joints[a*3+1]-joints[v*3+1], az = joints[a*3+2]-joints[v*3+2];
      const bx = joints[b*3]-joints[v*3], by = joints[b*3+1]-joints[v*3+1], bz = joints[b*3+2]-joints[v*3+2];
      const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
      let deg = 0;
      if (la > 1e-9 && lb > 1e-9) { const c = Math.min(1, Math.max(-1, (ax*bx+ay*by+az*bz)/(la*lb))); deg = Math.acos(c) * DEG; }
      return `<div style="display:flex;justify-content:space-between"><span>${label}</span><span>${deg.toFixed(1)}°</span></div>`;
    }).join('');
    $('angle-list').innerHTML = html;
  }

  _bindEulerInputs() { this._bindEulerSet('pose'); this._bindEulerSet('root'); }

  _bindEulerSet(prefix) {
    const axes = [[`${prefix}-eul-x`, `${prefix}-eul-x-s`], [`${prefix}-eul-y`, `${prefix}-eul-y-s`], [`${prefix}-eul-z`, `${prefix}-eul-z-s`]];
    const readDegs = () => axes.map(([num]) => parseFloat($(num).value) || 0);
    const commitTo = (degVals) => {
      if (this._readOnly()) return;
      const rot = this._getRotation(); const store = this._getStore();
      if (!rot || !store || !store.current()) return;
      const e = degVals.map((d) => (d || 0) * RAD);
      if (prefix === 'pose') { const ui = this._getUI(); if (!ui || ui.selectedJoint == null) return; rot.setJointEuler(ui.selectedJoint, e); }
      else rot.setRootEuler(e);
      store.applyFields(rot.toAxisAngle()); this._onEdit();
    };
    let editing = false;
    const begin = () => { if (this._readOnly() || editing) return; const s = this._getStore(); if (s && s.current()) { s.beginEdit(); editing = true; } };
    const commit = () => { if (this._readOnly() || !editing) return; this._getStore().commitEdit(); editing = false; };
    for (const [numId, sliderId] of axes) {
      const num = $(numId), slider = $(sliderId);
      if (!num || !slider) continue;
      num.addEventListener('focus', begin);
      num.addEventListener('input', () => { begin(); this._setVal(slider, num.value); commitTo(readDegs()); });
      num.addEventListener('change', commit); num.addEventListener('blur', commit);
      slider.addEventListener('pointerdown', () => { this._activeDragEl = slider; begin(); });
      slider.addEventListener('input', () => { begin(); num.value = slider.value; commitTo(readDegs()); });
      const endSlider = () => { this._activeDragEl = null; commit(); };
      slider.addEventListener('change', endSlider); slider.addEventListener('pointerup', endSlider); slider.addEventListener('pointercancel', endSlider);
    }
  }

  _buildBetaSliders() {
    const host = $('beta-sliders'); host.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;align-items:center;gap:5px';
      const lab = document.createElement('span'); lab.textContent = `β${i}`; lab.style.cssText = 'font-size:10px;color:#888;width:22px';
      const s = document.createElement('input'); s.type = 'range'; s.id = `beta-${i}`; s.min = '-5'; s.max = '5'; s.step = '0.1'; s.value = '0';
      wrap.appendChild(lab); wrap.appendChild(s); host.appendChild(wrap);
    }
    const readBetas = () => { const out = []; for (let i = 0; i < 10; i++) out.push(parseFloat($(`beta-${i}`).value) || 0); return out; };
    for (let i = 0; i < 10; i++) {
      const s = $(`beta-${i}`);
      s.addEventListener('pointerdown', () => { this._activeDragEl = s; });
      s.addEventListener('input', () => {
        if (this._readOnly()) return;
        const store = this._getStore(); if (!store || !store.current()) return;
        if (!this._betaEditing) { store.beginEdit(); this._betaEditing = true; }
        store.applyFields({ betas: readBetas() }); this._onEdit();
      });
      const endDrag = () => { this._activeDragEl = null; if (this._readOnly() || !this._betaEditing) return; this._getStore().commitEdit(); this._betaEditing = false; };
      s.addEventListener('pointerup', endDrag); s.addEventListener('pointercancel', endDrag); s.addEventListener('change', endDrag);
    }
    $('btn-beta-reset').addEventListener('click', () => {
      if (this._readOnly()) return;
      const store = this._getStore(); if (!store || !store.current()) return;
      for (let i = 0; i < 10; i++) $(`beta-${i}`).value = '0';
      store.beginEdit(); store.applyFields({ betas: Array(10).fill(0) }); store.commitEdit(); this._onEdit();
    });
  }

  _bindPosInputs() {
    const ids = ['pos-x', 'pos-y', 'pos-z'];
    const readP = () => ids.map((id) => parseFloat($(id).value) || 0);
    let editing = false;
    for (const id of ids) {
      const el = $(id);
      el.addEventListener('focus', () => { if (this._readOnly()) return; const store = this._getStore(); if (store && store.current() && !editing) { store.beginEdit(); editing = true; } });
      el.addEventListener('input', () => { if (this._readOnly()) return; const store = this._getStore(); if (!store || !store.current()) return; if (!editing) { store.beginEdit(); editing = true; } store.applyFields({ root_pos: readP() }); this._onEdit(); });
      const commit = () => { if (this._readOnly() || !editing) return; this._getStore().commitEdit(); editing = false; };
      el.addEventListener('change', commit); el.addEventListener('blur', commit);
    }
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add pcd_label/src/ui/pcd_panels.js
git commit -m "feat(pcd): edit panels (pose/root euler + pos + beta, no intrinsics)"
```

### Task 16: ui_controller 支持可选 modes（去掉 bbox）

`smpl_edit/ui_controller.js` 的 `MODES` 硬编码含 `bbox`。让构造接受可选 `modes`,
pcd 传 `['pose','root','beta']`。label 不传则保持原四模式 → 零回归。

**Files:**
- Modify: `smpl_edit/ui_controller.js`
- Test: `smpl_edit/tests/ui_controller.test.js`（追加一个断言）

- [ ] **Step 1: 追加失败测试**

在 `smpl_edit/tests/ui_controller.test.js` 末尾追加:

```javascript
test('custom modes restrict setMode (e.g. no bbox)', () => {
  const ui = new UIController({ modes: ['pose', 'root', 'beta'] });
  ui.setMode('bbox');           // 不在白名单 → 忽略
  assert.notEqual(ui.mode, 'bbox');
  ui.setMode('root');
  assert.equal(ui.mode, 'root');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test smpl_edit/tests/ui_controller.test.js`
Expected: 新测试 FAIL（bbox 仍可设,因 MODES 含 bbox）。

- [ ] **Step 3: 改 ui_controller 支持 modes 参数**

把 `smpl_edit/ui_controller.js` 顶部的模块级 `MODES` 改为实例级,默认值保持原四模式:

```javascript
// label/src/ui/ui_controller.js → smpl_edit/ui_controller.js
// One edit mode active at a time. Modes default to pose/root/bbox/beta; callers
// (e.g. point-cloud annotator) may restrict via the `modes` option.
const DEFAULT_MODES = ['pose', 'root', 'bbox', 'beta'];

export class UIController {
  constructor({ readOnly = false, modes = DEFAULT_MODES } = {}) {
    this._modes = modes;
    this._readOnly = readOnly;
    this._mode = readOnly ? 'view' : modes[0];
    this._joint = null;
    this._listeners = new Set();
  }
```

并把 `setMode` 内的 `MODES.includes(mode)` 改为 `this._modes.includes(mode)`:

```javascript
  setMode(mode) {
    if (this._readOnly) return;
    if (!this._modes.includes(mode)) return;
    this._mode = mode;
    if (mode !== 'pose') this._joint = null;
    this._notify();
  }
```

`setReadOnly` 里 `this._mode = 'pose'` 改为 `this._mode = this._modes[0]` 以保持一致:

```javascript
  setReadOnly(v) {
    this._readOnly = v;
    if (v) { this._mode = 'view'; this._joint = null; }
    else if (this._mode === 'view') { this._mode = this._modes[0]; }
    this._notify();
  }
```

- [ ] **Step 4: 跑测试确认通过 + 零回归**

Run: `node --test smpl_edit/tests/ui_controller.test.js`
Expected: 全部 PASS（含新测试与原有测试,原有测试不传 modes 走默认四模式）。

- [ ] **Step 5: 提交**

```bash
git add smpl_edit/ui_controller.js smpl_edit/tests/ui_controller.test.js
git commit -m "feat(smpl_edit): UIController accepts optional modes whitelist"
```

### Task 17: 页面 `pcd_label/index.html`

三栏布局,沿用 label 样式;importmap 指向 vendored three;右面板 Tabs 仅
`姿势/整体/体型`(无框);加配色控件(模式下拉 + 抽稀滑杆 + 点大小)、坐标轴控件
(上轴/前轴下拉)、点云显示开关。

**Files:**
- Create: `pcd_label/index.html`

- [ ] **Step 1: 写 index.html（前 50 行）**

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>点云 SMPL 标注器</title>
  <script type="importmap">
    { "imports": {
        "three": "../smpl_web_viewer/public/vendor/three.module.js",
        "three/addons/controls/OrbitControls.js": "../smpl_web_viewer/public/vendor/OrbitControls.js",
        "three/addons/controls/TransformControls.js": "../smpl_web_viewer/public/vendor/TransformControls.js"
    } }
  </script>
  <style>
    html,body { height:100%; margin:0; background:#0a0e14; color:#eee; font-family:system-ui,monospace; font-size:12px; }
    body { display:flex; }
    #left, #right { width:280px; background:#12161e; padding:10px; display:flex; flex-direction:column; gap:8px; overflow-y:auto; }
    #left { border-right:1px solid #283040; } #right { border-left:1px solid #283040; }
    #stage { position:relative; flex:1; background:#05070a; overflow:hidden; min-width:0; }
    canvas { display:block; position:absolute; top:0; left:0; }
    #status { position:absolute; top:8px; left:8px; background:rgba(0,0,0,.6); padding:5px 9px; border-radius:3px; }
    #loading { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:240px; background:rgba(0,0,0,.7); padding:14px 16px; border-radius:8px; text-align:center; }
    #loading[hidden] { display:none; }
    #loading-text { font-size:12px; color:#cde; margin-bottom:8px; }
    #loading-track { height:6px; background:#2a3140; border-radius:3px; overflow:hidden; }
    #loading-bar { height:100%; width:0%; background:#3399ff; transition:width .1s linear; }
    h2 { font-size:14px; color:#7df; margin:0 0 4px; } h3 { font-size:11px; color:#8ab; margin:0 0 2px; }
    .card { border-top:1px solid #222a36; padding-top:8px; display:flex; flex-direction:column; gap:5px; }
    button { padding:6px 8px; background:#222a36; border:1px solid #3a4555; color:#eee; border-radius:4px; cursor:pointer; font:inherit; }
    button:hover { background:#2e3848; } button.on { background:#0066cc; border-color:#3399ff; }
    button.primary { background:#1f6f43; border-color:#2e9e60; }
    select { background:#222a36; border:1px solid #3a4555; color:#eee; padding:4px; border-radius:4px; font:inherit; }
    .row { display:flex; gap:5px; } .row.wrap { flex-wrap:wrap; } .row > * { flex:1; }
    .row.small { align-items:center; color:#888; } .row.small span { flex:0 0 auto; }
    .big { font-size:16px; color:#ffa; text-align:center; }
    .status { background:#1a212c; border:1px solid #2a3340; color:#ffa; padding:4px 6px; border-radius:3px; min-height:16px; }
    .hint { color:#9ab; font-size:11px; line-height:1.5; margin:0 0 4px; background:#1a2530; padding:6px 8px; border-radius:4px; }
    input[type=range] { width:100%; } input[type=number] { background:#1a212c; border:1px solid #3a4555; color:#eee; padding:3px 4px; border-radius:3px; font:inherit; width:100%; }
    .kgrid { display:grid; grid-template-columns:auto 70px 1fr; gap:4px 6px; align-items:center; }
    .kgrid > label { font-size:11px; color:#9ab; text-align:right; }
    .kgrid2 { display:grid; grid-template-columns:auto 1fr; gap:4px 6px; align-items:center; }
    .kgrid2 > label { font-size:11px; color:#9ab; text-align:right; }
    .mono { font-size:11px; line-height:1.6; }
    #tabs { display:flex; gap:3px; } #tabs .tab { flex:1; border-radius:4px 4px 0 0; }
    .tabpanel { border:1px solid #2a3340; border-radius:0 0 4px 4px; padding:8px; display:flex; flex-direction:column; gap:6px; }
    .tabpanel[hidden] { display:none; }
    #joint-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:3px; }
    #joint-grid button { font-size:10px; padding:4px 2px; } #joint-grid button.on { background:#0066cc; }
    #joint-grid button.ik { outline:1px solid #2e9e60; } #joint-grid button:disabled { opacity:.35; cursor:not-allowed; }
    #right.disabled { opacity:.5; pointer-events:none; }
    #pose-rot-block[hidden] { display:none; }
  </style>
</head>
<body>
PLACEHOLDER_HTML_BODY
</body>
</html>
```

- [ ] **Step 2: 用 Edit 替换 `PLACEHOLDER_HTML_BODY` 为左栏（≤50 行）**

```html
  <aside id="left">
    <h2>点云 SMPL 标注器</h2>
    <button id="btn-open" class="primary" style="width:100%">📂 打开序列目录</button>
    <input id="dir-input" type="file" webkitdirectory directory multiple hidden>
    <div class="hint" id="open-hint">Chrome/Edge 可原地保存;其他浏览器为下载模式</div>

    <div class="card">
      <h3>当前帧</h3>
      <div id="frame-info" class="big">— / —</div>
      <input id="slider" type="range" min="0" max="0" value="0">
      <div class="row">
        <button id="btn-prev" title="上一帧">◀</button>
        <button id="btn-play" title="播放/暂停">▶ 播放</button>
        <button id="btn-next" title="下一帧">▶|</button>
      </div>
      <div class="row small"><span>速度</span><input id="speed" type="range" min="1" max="30" value="10"><span id="speed-val">10 fps</span></div>
    </div>

    <div class="card">
      <h3>本帧标注状态</h3>
      <div id="anno-state" class="status">—</div>
      <div id="anno-actions"></div>
    </div>

    <div class="card">
      <h3>显示</h3>
      <div class="row wrap">
        <button id="t-points" class="on">点云</button><button id="t-mesh" class="on">网格</button>
        <button id="t-joints" class="on">关节</button><button id="t-bones" class="on">骨骼</button>
        <button id="t-grid" class="on">底网</button><button id="t-axes">轴</button>
      </div>
    </div>

    <div class="card">
      <h3>关节角度 (只读)</h3>
      <div id="angle-list" class="mono"></div>
    </div>

    <div class="card">
      <h3>读写</h3>
      <div class="row"><button id="btn-save" class="primary">💾 保存标注</button><button id="btn-reset">↺ 重置</button></div>
      <div class="row"><button id="btn-undo">↶ 撤销 (Ctrl+Z)</button></div>
    </div>
  </aside>

  <div id="stage"><canvas id="c"></canvas><div id="status">就绪 — 请打开序列目录</div><div id="loading" hidden><div id="loading-text">加载模型…</div><div id="loading-track"><div id="loading-bar"></div></div></div></div>

  PLACEHOLDER_HTML_RIGHT
```

- [ ] **Step 3: 用 Edit 替换 `PLACEHOLDER_HTML_RIGHT` 为右栏（≤50 行）**

```html
  <aside id="right" class="disabled">
    <div class="card">
      <h3>点云渲染</h3>
      <div class="kgrid2">
        <label>配色</label>
        <select id="color-mode">
          <option value="height">按高度</option>
          <option value="range">按距离</option>
          <option value="axis">轴向RGB</option>
          <option value="solid">单色</option>
        </select>
        <label>抽稀</label><input id="decimation" type="range" min="0.02" max="1" step="0.02" value="1">
        <label>点大小</label><input id="point-size" type="range" min="0.005" max="0.1" step="0.005" value="0.03">
      </div>
      <h3 style="margin-top:6px">坐标轴</h3>
      <div class="kgrid2">
        <label>上轴</label><select id="axis-up"><option value="Z">Z-up</option><option value="Y">Y-up</option></select>
        <label>前轴</label><select id="axis-front"></select>
      </div>
    </div>

    <div id="tabs">
      <button class="tab on" data-mode="pose">姿势</button>
      <button class="tab" data-mode="root">整体</button>
      <button class="tab" data-mode="beta">体型</button>
    </div>

    <section class="tabpanel" data-mode="pose">
      <p class="hint">点击点云中的关节点,或在下方选择关节,拖动旋转环。</p>
      <div class="row" style="align-items:center;gap:6px"><button id="ik-toggle" hidden>🔗 IK 拖拽</button><span style="font-size:10px;color:#8ab">开启后拖手腕/脚踝自动反解</span></div>
      <div id="joint-grid"></div>
      <div id="sel-joint" class="status">未选择关节</div>
      <div id="pose-rot-block" hidden>
        <h3>旋转 (欧拉 XYZ, 度)</h3>
        <div class="kgrid">
          <label>X</label><input type="number" id="pose-eul-x" step="1"><input type="range" id="pose-eul-x-s" min="-180" max="180" step="1">
          <label>Y</label><input type="number" id="pose-eul-y" step="1"><input type="range" id="pose-eul-y-s" min="-180" max="180" step="1">
          <label>Z</label><input type="number" id="pose-eul-z" step="1"><input type="range" id="pose-eul-z-s" min="-180" max="180" step="1">
        </div>
      </div>
    </section>

    <section class="tabpanel" data-mode="root" hidden>
      <p class="hint">控制整个人体:拖箭头平移、切换"旋转"改朝向。</p>
      <div class="row"><button id="root-translate" class="on">移动</button><button id="root-rotate">旋转</button></div>
      <h3>整体平移 (米)</h3>
      <div class="kgrid2"><label>x</label><input type="number" id="pos-x" step="0.01"><label>y</label><input type="number" id="pos-y" step="0.01"><label>z</label><input type="number" id="pos-z" step="0.01"></div>
      <h3>整体旋转 (欧拉 XYZ, 度)</h3>
      <div class="kgrid">
        <label>X</label><input type="number" id="root-eul-x" step="1"><input type="range" id="root-eul-x-s" min="-180" max="180" step="1">
        <label>Y</label><input type="number" id="root-eul-y" step="1"><input type="range" id="root-eul-y-s" min="-180" max="180" step="1">
        <label>Z</label><input type="number" id="root-eul-z" step="1"><input type="range" id="root-eul-z-s" min="-180" max="180" step="1">
      </div>
    </section>

    <section class="tabpanel" data-mode="beta" hidden>
      <p class="hint">调整体型参数,实时改变胖瘦高矮。</p>
      <div id="beta-sliders"></div>
      <button id="btn-beta-reset">归零</button>
    </section>
  </aside>
  <script type="module" src="./src/app.js"></script>
```

- [ ] **Step 4: 提交**

```bash
git add pcd_label/index.html
git commit -m "feat(pcd): page layout (3-pane, color/axis controls, pose/root/beta tabs)"
```

### Task 18: 装配 `pcd_label/src/app.js`

把所有件装到一起:加载模型 → 打开目录 → 读 manifest → 逐帧解码 PNG 并渲染点云 +
SMPL → 复用 smpl_edit 的 Root/Pose/IK/Beta 编辑链路 → 保存标注。这是最大的一块,
分多步用 Edit 追加(每块 ≤50 行)。

**Files:**
- Create: `pcd_label/src/app.js`

- [ ] **Step 1: 写 app.js 顶部（imports + 模块级状态 + 模型加载）（≤50 行）**

```javascript
// pcd_label/src/app.js — 点云 SMPL 标注器装配。复用 smpl_edit 的世界系编辑内核。
import { loadModel } from '../../smpl_core/smpl_model.js';
import { forwardSmpl } from '../../smpl_core/lbs.js';
import { mat3ToQuat } from '../../smpl_core/rotations.js';
import { JOINT_NAMES } from '../../smpl_core/joint_names.js';
import { CocoDocument } from '../../smpl_edit/coco_document.js';
import { AnnotationStore } from '../../smpl_edit/annotation_store.js';
import { RotationState } from '../../smpl_edit/rotation_state.js';
import { UIController } from '../../smpl_edit/ui_controller.js';
import { JointPicker } from '../../smpl_edit/joint_picker.js';
import { RootHandle } from '../../smpl_edit/root_handle.js';
import { PoseGizmo } from '../../smpl_edit/pose_gizmo.js';
import { installIK } from '../../smpl_edit/ik_plugin.js';
import { PcdScene } from './scene/pcd_scene.js';
import { OrbitCam } from './scene/orbit_cam.js';
import { PcdPanels } from './ui/pcd_panels.js';
import { axisFrameMatrix, AXIS_OPTIONS } from './scene/axis_frame.js';
import { decodeXYZ } from './scene/point_cloud_decode.js';
import { decodePngFile } from './io/png_pixels.js';
import { PcdDirSource, fsAccessSupported, pickDirectory } from './io/pcd_dir_source.js';
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };
const MODEL_URL = new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url);

let model = null, scene = null, cam = null, store = null;
let source = null, manifest = null;
let rotation = null, ui = null, panels = null;
let rootHandle = null, poseGizmo = null, jointPicker = null;
let jointGridButtons = [];
let lastVertices = null, lastJoints = null, lastWorldRot = null;
let syncUI = null, syncHooks = [], dragGuards = [], engageGuards = [];
let playing = false, fps = 10, lastTick = 0, acc = 0;
let axisUp = 'Z', axisFront = 'X', axisM = axisFrameMatrix('Z', 'X');
let lastDecoded = null; // 缓存当前帧解码结果，切换轴/配色时无需重解 PNG

async function loadModelWithProgress() {
  const box = $('loading'), bar = $('loading-bar'), txt = $('loading-text');
  if (box) box.hidden = false;
  try {
    return await loadModel(MODEL_URL, { onProgress: ({ loaded, total }) => {
      if (!bar) return;
      if (total > 0) { const pct = Math.min(100, Math.round(loaded / total * 100)); bar.style.width = `${pct}%`; if (txt) txt.textContent = `加载模型… ${pct}%`; }
      else if (txt) txt.textContent = `加载模型… ${(loaded / 1048576).toFixed(1)} MB`;
    } });
  } finally { if (box) box.hidden = true; }
}
```

- [ ] **Step 2: Edit 追加 帧渲染 + 标注应用（≤50 行）**

在文件末尾追加:

```javascript
function buildFrame() {
  const a = store.current();
  const { root_rota, body_pose } = rotation.toAxisAngle();
  return { root_pos: a.root_pos, root_rota, body_pose, betas: a.betas };
}

function applyAnnotation() {
  if (!rotation || !store.current()) return;
  const out = forwardSmpl(model, buildFrame(), { worldRot: true });
  lastVertices = out.vertices; lastJoints = out.joints; lastWorldRot = out.worldRot;
  scene.updateMesh(out.vertices, out.joints);
  if (panels) panels.syncFromState();
}

// 解码当前帧 PNG → 点云（用当前轴矩阵变换到显示系）。缓存解码结果供轴/配色切换复用。
async function renderPointCloud(i) {
  const file = await source.frameFile(i);
  const { pixels, channels } = await decodePngFile(file);
  lastDecoded = decodeXYZ(pixels, {
    pointWidth: manifest.pointWidth, pointHeight: manifest.pointHeight,
    scale: manifest.scale, center: manifest.center, channels,
  });
  scene.pointCloud.setData(lastDecoded, axisM);
}

function reapplyAxis() {
  axisM = axisFrameMatrix(axisUp, axisFront);
  if (lastDecoded) scene.pointCloud.setData(lastDecoded, axisM);
}

function renderAnnoActions() {
  const host = $('anno-actions'); if (!host) return;
  const has = store && store.hasData();
  $('anno-state').textContent = !store ? '—' : (has ? '✅ 本帧已标注' : '— 本帧无标注');
  host.innerHTML = '';
  if (!store || ui?.readOnly) return;
  const row = document.createElement('div'); row.className = 'row'; host.appendChild(row);
  const mk = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; row.appendChild(b); };
  if (has) mk('🗑 删除本帧标注', '', () => { store.deleteCurrent(); showFrame(store.currentFrame()); });
  else { mk('＋ 新建:T-pose', 'primary', () => { store.addTpose(); showFrame(store.currentFrame()); }); mk('＋ 复制上一帧', '', () => { store.addFromPrevious(); showFrame(store.currentFrame()); }); }
}
```

- [ ] **Step 3: Edit 追加 showFrame（≤50 行）**

在文件末尾追加:

```javascript
async function showFrame(i) {
  store.setFrame(i);
  $('slider').value = String(i);
  $('frame-info').textContent = `${i} / ${store.frameCount() - 1}`;
  const a = store.current();
  if (a) {
    rotation = RotationState.fromAxisAngle({ root_rota: a.root_rota, body_pose: a.body_pose });
    applyAnnotation();
    scene.setPersonVisible(true);
  } else {
    rotation = null; lastVertices = null; lastJoints = null; lastWorldRot = null;
    scene.setPersonVisible(false);
    if (panels) panels.syncFromState();
  }
  renderAnnoActions();
  try { await renderPointCloud(i); }
  catch (e) { setStatus(`点云解码失败: ${e}`); }
  if (syncUI) syncUI();
}
```

- [ ] **Step 4: Edit 追加 打开目录 + 保存（≤50 行）**

在文件末尾追加:

```javascript
async function mountSequence() {
  manifest = await source.readManifest();
  const raw = await source.readAnnotation();
  let coco;
  if (raw) coco = new CocoDocument(raw);
  else coco = new CocoDocument({ images: Array.from({ length: manifest.frameCount }, (_, i) => ({ id: i })), annotations: [], categories: [] });
  store = new AnnotationStore(coco);
  ui = new UIController({ modes: ['pose', 'root', 'beta'] });
  if (syncUI) ui.onChange(syncUI);
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
  $('slider').value = '0';
  $('right').classList.remove('disabled');
  if (!model) { model = await loadModelWithProgress(); scene.setTopology(model.faces); }
  fps = manifest.fps || 10; $('speed').value = String(fps); $('speed-val').textContent = `${fps} fps`;
  scene.resize();
  await showFrame(0);
  cam.lookAtTarget(new THREE.Vector3(0, 1, 0));
  if (syncUI) syncUI();
  setStatus(`已加载 ${manifest.frameCount} 帧`);
}

async function openDirectory() {
  const h = await pickDirectory();
  source = new PcdDirSource(h);
  await mountSequence();
}

async function saveAnnotation() {
  if (!store) return;
  const obj = store.document().serialize();
  const path = await source.saveAnnotation(obj);
  setStatus(`已保存 ${path}`);
}
```

- [ ] **Step 5: Edit 追加 boot() —— 场景/相机/编辑基元装配（≤50 行）**

在文件末尾追加:

```javascript
function boot() {
  scene = new PcdScene($('c'));
  cam = new OrbitCam({ canvas: $('c') });
  scene.setCamera(cam);

  $('btn-open').addEventListener('click', () => {
    if (!fsAccessSupported()) { $('dir-input').click(); return; }
    openDirectory().catch((e) => { if (e?.name !== 'AbortError') setStatus(String(e)); });
  });

  $('slider').addEventListener('input', (e) => { if (!store) return; setPlaying(false); showFrame(+e.target.value); });
  $('btn-prev').addEventListener('click', () => { if (!store) return; setPlaying(false); showFrame(Math.max(0, store.currentFrame() - 1)); });
  $('btn-next').addEventListener('click', () => { if (!store) return; setPlaying(false); showFrame(Math.min(store.frameCount() - 1, store.currentFrame() + 1)); });
  $('btn-play').addEventListener('click', () => { if (store) setPlaying(!playing); });
  $('speed').addEventListener('input', (e) => { fps = +e.target.value; $('speed-val').textContent = `${fps} fps`; });
  $('btn-undo').addEventListener('click', () => { if (store) { store.undo(); showFrame(store.currentFrame()); } });
  window.addEventListener('keydown', (e) => { if (store && (e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); store.undo(); showFrame(store.currentFrame()); } });
  $('btn-save').addEventListener('click', () => saveAnnotation().catch((e) => setStatus(String(e))));
  $('btn-reset').addEventListener('click', async () => { if (!source || !store) return; const raw = await source.readAnnotation(); if (raw) { store = new AnnotationStore(new CocoDocument(raw)); ui = new UIController({ modes: ['pose','root','beta'] }); if (syncUI) ui.onChange(syncUI); } await showFrame(Math.min(store.currentFrame(), store.frameCount() - 1)); setStatus('已重置'); });

  const toggle = (id, key) => $(id).addEventListener('click', () => { const on = !$(id).classList.contains('on'); $(id).classList.toggle('on', on); scene.setFlag(key, on); });
  toggle('t-points', 'points'); toggle('t-mesh', 'mesh'); toggle('t-joints', 'joints'); toggle('t-bones', 'bones'); toggle('t-grid', 'grid'); toggle('t-axes', 'axes');

  boot2();
}
```

> 说明:`boot()` 拆成两半(`boot()` + `boot2()`)只为满足单次 Edit ≤50 行;两者都在
> 模块加载时顺序执行,无运行期差异。

- [ ] **Step 6: Edit 追加 boot2() —— 配色/轴控件 + 面板 + gizmo + IK + 渲染循环（≤50 行 ×2）**

在文件末尾追加(第一段):

```javascript
function populateFrontAxis() {
  const sel = $('axis-front'); sel.innerHTML = '';
  for (const f of AXIS_OPTIONS[axisUp]) { const o = document.createElement('option'); o.value = f; o.textContent = `${f}-front`; sel.appendChild(o); }
  if (!AXIS_OPTIONS[axisUp].includes(axisFront)) axisFront = AXIS_OPTIONS[axisUp][0];
  sel.value = axisFront;
}

function setPlaying(on) {
  playing = on && store && store.frameCount() > 0;
  if (playing) { poseGizmo?.detach(); rootHandle?.detach(); }
  $('btn-play').textContent = playing ? '⏸ 暂停' : '▶ 播放';
  $('btn-play').classList.toggle('on', playing);
}

function boot2() {
  // 配色控件
  $('color-mode').addEventListener('change', (e) => scene.pointCloud.setColorMode(e.target.value));
  $('decimation').addEventListener('input', (e) => scene.pointCloud.setDecimation(+e.target.value));
  $('point-size').addEventListener('input', (e) => scene.pointCloud.setPointSize(+e.target.value));
  // 坐标轴控件
  populateFrontAxis();
  $('axis-up').addEventListener('change', (e) => { axisUp = e.target.value; populateFrontAxis(); reapplyAxis(); });
  $('axis-front').addEventListener('change', (e) => { axisFront = e.target.value; reapplyAxis(); });

  panels = new PcdPanels({ getRotation: () => rotation, getStore: () => store, getUI: () => ui, getLastJoints: () => lastJoints, onEdit: applyAnnotation });

  const grid = $('joint-grid'); jointGridButtons = [];
  for (let j = 0; j < 21; j++) {
    const b = document.createElement('button'); b.textContent = JOINT_NAMES[j + 1];
    b.addEventListener('click', () => { setPlaying(false); ui && ui.selectJoint(j); });
    grid.appendChild(b); jointGridButtons.push(b);
  }
  document.querySelectorAll('#tabs .tab').forEach((btn) => btn.addEventListener('click', () => {
    if (dragGuards.some((g) => g.isDragging())) return;
    if (btn.dataset.mode === 'root' || btn.dataset.mode === 'pose') setPlaying(false);
    if (ui) ui.setMode(btn.dataset.mode);
  }));

  boot3();
}
```

在文件末尾追加(第二段):

```javascript
function boot3() {
  jointPicker = new JointPicker({
    canvas: $('c'), camera: cam.camera, getJointMeshes: () => scene.jointMeshes(),
    onPick: (smpl) => { setPlaying(false); if (smpl === 0) ui.setMode('root'); else if (smpl >= 1 && smpl <= 21) ui.selectJoint(smpl - 1); },
    onMiss: () => { if (ui && ui.mode === 'pose') ui.clearSelection(); },
    canPick: () => !engageGuards.some((g) => g.isEngaged()),
  });
  rootHandle = new RootHandle({ scene: scene.threeScene(), camera: cam.camera, canvas: $('c'), controls: cam.controls, getMode: () => cam.mode, getStore: () => store, getRotation: () => rotation, onEdit: applyAnnotation });
  poseGizmo = new PoseGizmo({ scene: scene.threeScene(), camera: cam.camera, canvas: $('c'), controls: cam.controls, getMode: () => cam.mode, getRotation: () => rotation, getStore: () => store, onEdit: applyAnnotation });
  dragGuards.push(poseGizmo, rootHandle); engageGuards.push(poseGizmo, rootHandle);

  syncUI = () => {
    if (!ui) return;
    document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('on', b.dataset.mode === ui.mode));
    document.querySelectorAll('.tabpanel').forEach((p) => { p.hidden = p.dataset.mode !== ui.mode; });
    jointGridButtons.forEach((b, j) => b.classList.toggle('on', ui.mode === 'pose' && ui.selectedJoint === j));
    $('sel-joint').textContent = ui.selectedJoint == null ? '未选择关节' : `已选择: ${JOINT_NAMES[ui.selectedJoint + 1]}`;
    const prb = $('pose-rot-block'); if (prb) prb.hidden = !(ui.mode === 'pose' && ui.selectedJoint != null);
    scene.setSelectedJoint(ui.mode === 'pose' && ui.selectedJoint != null ? ui.selectedJoint + 1 : -1);
    if (jointPicker) jointPicker.setEnabled(ui.mode === 'pose');
    let claimed = false;
    for (const h of syncHooks) { if (h()) claimed = true; }
    if (claimed) { poseGizmo.detach(); rootHandle.detach(); }
    else if (!playing && ui.mode === 'pose' && ui.selectedJoint != null && rotation && lastWorldRot) {
      const j = ui.selectedJoint, smplJ = j + 1, parent = model.parents[smplJ];
      const qParentWorld = mat3ToQuat(lastWorldRot.slice(parent * 9, parent * 9 + 9));
      poseGizmo.attach(j, scene.jointWorldPosition(smplJ), qParentWorld); rootHandle.detach();
    } else if (!playing && ui.mode === 'root' && store && store.current()) { rootHandle.attach(store.current().root_pos); poseGizmo.detach(); }
    else { poseGizmo.detach(); rootHandle.detach(); }
    renderAnnoActions(); panels.syncFromState();
  };

  $('root-translate').addEventListener('click', () => { setPlaying(false); rootHandle.setMode('translate'); $('root-translate').classList.add('on'); $('root-rotate').classList.remove('on'); if (syncUI) syncUI(); });
  $('root-rotate').addEventListener('click', () => { setPlaying(false); rootHandle.setMode('rotate'); $('root-rotate').classList.add('on'); $('root-translate').classList.remove('on'); if (syncUI) syncUI(); });

  boot4();
}
```

- [ ] **Step 7: Edit 追加 boot4() —— IK 安装 + 渲染循环 + 启动（≤50 行）**

在文件末尾追加:

```javascript
function boot4() {
  const IK_ENABLED = true;
  if (IK_ENABLED) {
    installIK({
      scene, camera: cam.camera, canvas: $('c'), controls: cam.controls,
      getMode: () => cam.mode, getStore: () => store, getRotation: () => rotation,
      getLastJoints: () => lastJoints, getLastWorldRot: () => lastWorldRot,
      getUI: () => ui, getParents: () => model && model.parents, isPlaying: () => playing,
      onEdit: applyAnnotation, jointGridButtons, setStatus,
      requestSync: () => { if (syncUI) syncUI(); },
      toggleButton: $('ik-toggle'),
      registerSyncHook: (fn) => syncHooks.push(fn),
      registerGuard: (g) => { dragGuards.push(g); engageGuards.push(g); },
    });
  }

  window.addEventListener('resize', () => scene.resize());

  function loop(now) {
    if (playing && store && store.frameCount() > 0) {
      acc += now - lastTick;
      const interval = 1000 / fps;
      if (acc >= interval) { acc %= interval; const next = (store.currentFrame() + 1) % store.frameCount(); showFrame(next); }
    }
    lastTick = now;
    const gizmoBusy = engageGuards.some((g) => g.isEngaged());
    if (cam) cam.controls.enabled = !gizmoBusy;
    scene.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame((now) => { lastTick = now; loop(now); });
}

boot();
```

- [ ] **Step 8: 加 serve:pcd 脚本并提交**

**Files:** Modify `package.json`（scripts 追加 `serve:pcd`）

```json
"serve:pcd": "node smpl_web_viewer/tools/static_server.mjs --root . --port 5176",
```

```bash
git add pcd_label/src/app.js package.json
git commit -m "feat(pcd): assemble app (load/decode/render + reuse smpl_edit editing + save)"
```

## 阶段 6:端到端浏览器验证 + 部署

### Task 19: 浏览器端到端走查（真实样例数据）

**Files:** 无（验证）

- [ ] **Step 1: 启动静态服务**

Run: `npm run serve:pcd`
浏览器开 http://127.0.0.1:5176/pcd_label/(Chrome/Edge,需 FS Access)。

- [ ] **Step 2: 打开样例序列并逐项验证**

打开目录:`/Users/penghaotian/Downloads/20260616/pointcloud_png/45/2026-06-02-17-07-58-RS-520-Data`。
逐项确认:
- 点云渲染出现,默认按高度配色(turbo),朝向合理(Z-up/X-front)。
- 切配色模式(按距离/轴向RGB/单色)即时生效;抽稀滑杆变稀疏;点大小可调。
- 切上轴 Z↔Y、前轴下拉联动,点云朝向随之变换。
- 帧滑杆/上一帧/下一帧/播放正常,逐帧点云刷新。
- 「新建:T-pose」出现 SMPL 人体;Root 移动/旋转 gizmo 可拖且人体跟随。
- Pose:点关节球或点关节按钮 → 出现旋转环,拖动改姿势;欧拉输入框/滑杆同步。
- IK 开关:开启后拖手腕/脚踝两段反解,关节按钮末端高亮。
- Beta 滑杆改体型;撤销(Ctrl+Z)回退;保存写出 player_0.json 到序列目录。
- 重开页面 + 同目录 → 续读已存标注。
Expected: 全部正常。记录任何异常,回到对应 Task 修复。

- [ ] **Step 2.5: 性能感受 + 抽稀兜底确认**

播放整段(176 帧),若主线程解码掉帧明显,确认抽稀滑杆能把帧率拉回可用。
Expected: 全量可能偏卡;抽稀到 ~30%-50% 后流畅。若全量完全不可用,记录为后续
「解码挪 Worker」的跟进项(本计划不实现,见 spec §10/§11)。

### Task 20: 部署接入（GitHub Pages 入口）

**Files:**
- Modify: `index.html`（仓库根的导航页,加 pcd_label 入口）

- [ ] **Step 1: 查看根导航页结构**

Run: `cat index.html`
Expected: 看到现有指向 label/ 等的链接结构。

- [ ] **Step 2: 加 pcd_label 入口链接**

按根 `index.html` 现有的链接卡片样式,新增一条指向 `./pcd_label/` 的入口(标题
「点云 SMPL 标注器」,描述「3D LiDAR 点云 + SMPL 标注,纯本地」)。沿用现有 DOM
结构与 class,不改样式系统。

- [ ] **Step 3: 跑全套测试确认整体绿**

Run: `npm run test:web`
Expected: 全部 PASS(smpl_web_viewer + label + smpl_edit + pcd_label)。

- [ ] **Step 4: 提交**

```bash
git add index.html
git commit -m "feat(pcd): add point-cloud annotator entry to landing page"
```

- [ ] **Step 5:（可选）推送触发 Pages 部署**

仅在用户确认后执行(部署是 outward-facing,需用户授权):

```bash
git push
```

Expected: GitHub Pages 重新构建,公网入口出现「点云 SMPL 标注器」。

## 完成标准

- `smpl_edit/` 公共包建立,label 改为依赖且全套测试 + 浏览器走查零回归。
- `pcd_label/` 能打开样例序列、解码渲染点云(4 配色 + 抽稀 + 点大小)、上轴/前轴切换、
  摆放并编辑 SMPL(Root/Pose/IK/Beta)、保存/续读 player_0.json。
- 纯静态、无服务端;`npm run test:web` 全绿;根导航页有入口。

## 自检与 spec 对照(写计划后回看)

- spec §2 数据格式 → Task 6/9/14(解码、manifest、PNG 像素)。✅
- spec §3 包结构 → 阶段 1(smpl_edit 抽取 + label 瘦身)、阶段 2-5(pcd_label)。✅
- spec §4 解码/配色/抽稀 → Task 6/7/10。✅
- spec §5 坐标轴(上轴+前轴) → Task 8 + Task 17/18 控件。✅
- spec §6 编辑(Root/Pose/IK/Beta)+ COCO 产物 → Task 15/16/18 + 复用 smpl_edit。✅
- spec §7 UI 三栏 → Task 17。✅
- spec §8 加载交互(单序列目录) → Task 13/18。✅
- spec §9 测试与回归 → Task 3/5/19,各纯逻辑 Task 的 TDD。✅
- spec §10 YAGNI(无 2D/bbox/多人/Worker/intensity) → 计划未实现这些;Task 16 去 bbox。✅
- 类型一致性:`decodeXYZ` 返回 `{positions,count}` 全程一致;`PointCloud.setData(decoded, M)`
  签名在 Task 10 定义、Task 18 调用一致;`axisFrameMatrix(up,front)`/`applyMat3` 一致;
  `UIController({modes})` 在 Task 16 定义、Task 18 使用一致。✅

