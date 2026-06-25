# PCD 三视口 + F 键聚焦 设计

- 日期：2026-06-24
- 分支：`feat/pcd-tri-view-and-focus`（从 main 并行拉出的 worktree）
- 内核：`smpl_edit`（label / pcd 共享），借此做视口/相机抽象的重构
- 范围：pcd 三视口（主透视 + 侧/正正交参考视）；label & pcd 每个视口 F 键聚焦人体中心

## 1. 背景与目标

pcd_label 当前单视口（一个透视相机 + OrbitControls）。需求：

1. **pcd 三视口**：主透视编辑视 + 侧面、正面两个参考视，布局舒适可调。
2. **F 键聚焦**：label 与 pcd 的每个视口，按 F 让视野聚焦到人体中心（有人时）。

借此把「视口/相机」抽象成共享内核的一等公民，增强复用性与模块化。

## 2. 设计决策（已确认）

| 维度 | 决策 |
|---|---|
| 布局 | 主透视大窗 + 侧/正参考视叠右；拖分隔条调大小 + 预设布局一键切换 |
| 参考视相机 | 正交（`OrthographicCamera`，无透视畸变），初始正对侧面/正面 |
| 参考视交互 | 初始可微调（环绕/缩放）；每视口一个锁🔒，锁上则只读 |
| F 键 | 仅聚焦人体中心，不改朝向；作用于鼠标所在（active）视口 |
| 视角重置键 | 另设无冲突键 `R`：重置当前 active 视口**方向**到标准朝向；**重置时强制解锁**，复位后处于无锁可微调态 |
| 编辑作用域 | 任一视口都可编辑（点选关节 / 拖 gizmo / IK / root） |
| 渲染架构 | 单 WebGL renderer + 单 canvas，`setViewport`/`setScissor` 分区 |
| label 2D 模式 F | 不响应（2D 视口已足够小，无需聚焦）；仅 3D 响应 |

## 3. 架构与模块边界（重构核心）

把「视口」抽象进共享内核，两 app 复用。

### 新增 `smpl_edit/` 模块

- **`framing.js`（纯函数，无 three.js，可单测）**
  - `bodyBounds(joints) → { center:[x,y,z], radius } | null`：从 24 关节世界坐标算人体包围中心与半径；无关节/全零返回 null。
  - `focusPlacement({ position, target }, center, radius) → { position, target }`：保持相机**朝向不变**，把 target 移到 center、并沿当前视线方向调整距离使人体充满。F 聚焦与视角重置都基于它。

- **`viewport.js`**
  - 一个 `Viewport` = `{ camera, controls, rectSpec, locked }`。封装该视口在 canvas 上的归一化矩形（rectSpec：`{x,y,w,h}` 比例）、resize、它自己的 OrbitControls、锁定状态。
  - 方法：`applyScissor(renderer, canvasW, canvasH)`、`setLocked(bool)`、`resetOrientation()`（回标准朝向 + 解锁）、`focus(center, radius)`（调 `framing.focusPlacement`）。

- **`viewport_manager.js`**
  - 持有 N 个 `Viewport` + 一个 layout 配置。职责：
    1. **逐区渲染**：单 renderer 遍历各 Viewport，按 rect 做 `setViewport/setScissor` 后 `render(scene, vp.camera)`。
    2. **指针路由**：canvas pointerdown 时按 clientX/Y 命中哪个 rect → 设为 `_active`，暴露 `activeCamera()` / `activeViewport()`。命中测试抽成纯函数 `hitTest(px, py, rects) → index`（可单测）。
    3. **布局**：layout 预设（`single` / `tri` / `main-big`）+ 分隔条比例 → 各 Viewport 的 rectSpec（纯函数 `computeRects(preset, splits) → rectSpec[]`，可单测）。

### 关键重构：gizmo/拾取动态取相机

现状 `JointPicker`、`pose_gizmo`、`root_handle`、IK 两柄（已合并的 `DragHandle`）在构造时**绑死一个 camera**。改为从 `getCamera()` 回调动态读「当前 active 视口的相机」：

- `JointPicker` 构造参数 `camera` → `getCamera`。
- `DragHandle` / `PoseGizmo` / `RootHandle`：TransformControls 的 `.camera` 在每次 active 视口切换后更新（TransformControls 暴露可写 `camera`），或在 pointerdown 路由时同步。
- 指针落在哪个视口，raycast 与 gizmo 就用哪个相机。单实例跟随 active 视口，无需多套 gizmo。

### app 接线

- **pcd**：用 `viewport_manager` 配三视口（主透视 OrbitCam + 侧/正正交）。`pcd_scene.render()` 委托给 manager 逐区渲染。
- **label**：暂保持单视口（`CameraModes` 有内参/2D 特殊逻辑，不并入 manager）。仅复用 `framing.js`：F 键 → `cam.focusOn(center, radius)`（新方法，内部用 `focusPlacement`）。
- F/R 键作用于「当前 active 视口」（label 单视口即主视）。

## 4. 三视口布局与相机

### 布局（manager 的 rectSpec 驱动）

- 默认 `tri`：主透视占左大区，侧/正正交叠右侧上下。
- 中间竖分隔条拖动改左右占比；右侧横分隔条改侧/正上下占比。拖到极值即隐藏参考视。
- 预设：`[单视口] [三视口] [主大+参考小]` 一键切换，写入 layout 后重渲染。分隔条比例仅存内存（不持久化磁盘，YAGNI）。

### 三个相机

- **主视**：`PerspectiveCamera` + OrbitControls，自由环绕（沿用现有 `OrbitCam`）。
- **侧视 / 正视**：`OrthographicCamera`，初始正对——「侧」沿 right 轴看向人体、「正」沿 front 轴看向人体，up 取场景上轴；各自一套 OrbitControls，默认可微调。
- 正交 frustum 由人体/点云 radius + 该视口 rect 宽高比推导，保证充满不变形。
- 轴系：上轴/前轴沿用 `view_frame.js`，参考视的「正对方向」由它派生（与现有 up/front 切换一致；几何永不旋转）。

### 锁定与重置

- 每个参考视一个锁🔒：锁上则该视口 `controls.enabled=false`，纯只读；解锁可微调。
- **F**：聚焦——仅把当前 active 视口相机的 target/距离对准人体中心（有人时）。不改朝向。无人体提示「无人体可聚焦」，不报错。
- **R（视角重置）**：把当前 active 视口**方向**重置回标准朝向（主视→默认 3/4 俯视；侧→正侧；正→正正）。**强制解锁**并以无锁态复位（锁标记清掉）。
- 作用域：F/R 都作用于鼠标当前所在 active 视口。

### 指针路由与编辑

- manager 在 pointerdown 按坐标判定 active 视口、设 activeCamera。
- JointPicker / DragHandle / PoseGizmo / RootHandle 动态读 activeCamera——点哪个视口在哪个视口编辑。正交相机下 raycast 与 TransformControls 原生支持。
- OrbitControls 冲突：沿用现有 `engageGuards`——gizmo engaged 时只锁当前 active 视口的 controls，不全锁。

## 5. label 接入、键盘、测试

### label 接入 F 聚焦

- 不动 `CameraModes` 结构。新增 `cam.focusOn(center, radius)`：3D 模式调 `focusPlacement` 改 orbit target + 拉近；**2D 模式不响应 F**（视口已足够小）。
- 与现有 `set3DFollowTarget`（换帧被动跟随 pelvis）互补：F 是主动一键拉到人体中心。

### 键盘统一（轻量，不过度设计）

- 不引入快捷键注册中心（YAGNI）。两 app 各自在现有 keydown 里加 `f`/`r` 分支，复用同一套 `framing.js` + active 视口判定。
- 防冲突：F/R 仅在「无输入框聚焦、非播放、有 store、非拖拽/`isBusy()`」时响应。label 的 Ctrl+Z、Escape 已在，互不影响。

### 测试与冒烟策略（CLAUDE.md：纯逻辑单测，three.js/DOM 浏览器验）

可单测（新增 `*.test.js`，`node --test`）：
1. `framing.bodyBounds`：给定 joints 算出正确 center/radius；退化（无关节/全零）返回 null。
2. `framing.focusPlacement`：朝向不变、target=center、距离随 radius 单调。
3. `viewport_manager.hitTest`：clientX/Y + rect 列表 → 命中索引（含边界、未命中）。
4. `viewport_manager.computeRects`：预设 + 分隔条比例 → 各 rect 占比正确、和为全幅。

浏览器手验：三视口渲染、分隔条拖动、正交无畸变、锁/解锁、F 各视口聚焦、R 重置方向并解锁、任一视口点选关节+拖 gizmo、pcd 上轴/前轴切换仍正常、label 单视口零回归。

冒烟：大改前先在 pcd 用 scissor 把现有单场景渲染成两块（同一相机）跑通，确认 `setViewport/setScissor` + resize 链路 OK，再铺三相机。

### 重构风险控制

JointPicker/gizmo 改「动态取相机」触及 label 和 pcd 两边装配点——改完立即跑全量测试 + 两 app 冒烟，确认单视口行为零回归（label 仍单视口，行为不应变）。

## 6. 范围边界

- 仅 pcd 做三视口；label 保持单视口，只接 F 聚焦。
- 不持久化布局/分隔条到磁盘。
- 不改 SMPL 解算、标注存储格式、上轴/前轴的几何不变性。
- 2D 模式不响应 F。
