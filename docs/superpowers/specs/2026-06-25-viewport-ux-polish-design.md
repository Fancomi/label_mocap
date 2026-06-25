# 视口 UX 打磨 设计

- 日期：2026-06-25
- 分支：`feat/pcd-tri-view-and-focus`（在已实现的三视口特性之上的 UX 增强 + bug 修复）
- 内核：`smpl_edit`（label / pcd 共享）

## 1. 背景

三视口 + F 聚焦特性手验后，用户提出 7 项打磨：mesh 打光、手柄跨视口缩放、点大小三视不一致、视口边界不清、缺快捷键提示、预设冗余、锁/重置/坐标轴语义冲突。本设计逐项收口。

## 2. 需求与决策（均已确认）

| # | 需求 | 决策 |
|---|---|---|
| 1 | mesh 亮面朝相机 + 调白调亮 | 各 scene 加一盏跟随 active 相机的方向光；mesh 颜色调更白更亮（适度）。点云不受光 |
| 2 | 手柄被别的视口缩放影响 | 手柄只在 active 视口渲染那一遍可见，size 只由 active 相机决定 |
| 3 | 点大小只主视生效 | `PointsMaterial` 关 `sizeAttenuation`，改屏幕像素恒定，三视一致 |
| 4 | 三视边界不清 | 每视口一个 DOM 描边框，active 高亮、非 active 暗灰 |
| 5 | 新按键无提示 | 右下角可最小化快捷键提示浮层（两 app） |
| 6 | 预设 2/3 仅宽度差 | 砍「主大参考小」，只留「单视口 / 三视口」 |
| 7 | 锁/重置/坐标轴冲突 | 锁按钮→「锁定为重置视角」并移到各视口；R 以坐标轴 up/front 为前提，按记忆的相对方位复位 |

## 3. 改动落点（职责边界）

- **`smpl_edit/viewport.js`**：加「重置基准 = 相对人体中心的方位」；`captureAsReset()` 记当前姿态为基准；`resetOrientation` 改为按当前 up/front + 基准方位复位。
- **`smpl_edit/viewport_manager.js`**：① render 逐区时手柄仅 active 那遍可见；② 砍预设到 single/tri；③ 暴露 rects 供 app 摆 DOM 边框。
- **各 scene（label `scene.js` / pcd `pcd_scene.js`）**：加跟随 active 相机的方向光；mesh 调亮。
- **`pcd_label/src/scene/point_cloud.js`**：`sizeAttenuation: false`。
- **`pcd_label/src/app.js` + `index.html`**：锁按钮→「锁定为重置视角」移到各视口角；预设砍一个；DOM 边框；快捷键提示面板。
- **`label/index.html` + `app.js`**：快捷键提示面板（列 F）。

每处都落在原本负责该事的模块，不新增耦合。

## 4. 锁定为重置视角 + R + 坐标轴 语义

**每个视口存「重置基准」**（代替原单一 `_dirAxis/_upAxis` 标准朝向）：
- 初始 = 标准正交朝向（主视 3/4 俯视、侧→正侧、正→正正），由当前 up/front 派生。
- **「锁定为重置视角」按钮**：把当前相机姿态（相对人体中心的方位向量 + 距离/正交缩放）存为该视口新基准。按下即记忆，不锁交互（仍可自由拖）。

**R 键（重置）——以坐标轴为前提**：
- R = 把 active 视口相机姿态恢复到「重置基准」。
- 基准存的是**相对方位**（相对人体中心、相对当前 up 的方向），非绝对世界坐标。坐标轴 up/front 变化后按 R，会按新 up/front 重新解释该方位，始终产出「当前坐标系下正确朝向人体」的视角。R 不破坏坐标轴语义，建立在其上。
- 从没锁定过 → 基准即初始标准朝向，R 回标准正交。

**坐标轴 up/front 切换（`applyAxisFrame`）**：
- 三视口按新 up/front 重新派生标准朝向并复位（现有行为保留）。
- 已锁定的视口：记忆的相对方位在新坐标系下重新解释后复位——聚焦/朝向都正确，不失效。
- 坐标轴是「世界怎么摆正」的前提，R 和锁定都在此前提下工作，不互相覆盖。

**F 键（聚焦）**：不变——只移 target 到人体中心 + 调距离，不改朝向。与 R/坐标轴正交。

**取舍**：基准存「相对方位」比存绝对姿态稍复杂，但正是「坐标轴为重置前提」所需。代价：锁定后大幅改 up/front，记忆角度在新系下视觉可能与锁定时不完全一致（被重新解释），但保证始终正确朝向人体。

## 5. 手柄显隐、边框、打光、提示面板

**手柄仅 active 视口可见**
- 手柄（TransformControls helper + marker）是共享 scene 对象，逐区渲染同一 scene 无法对单对象「这块画那块不画」。改为：render 遍历视口，画**非 active** 视口时把已注册的手柄对象临时 `.visible=false`，画 **active** 时恢复。
- app 注册一组「仅 active 可见」的 Object3D（poseGizmo/rootHandle/IK 两柄的 TC helper + marker）给 manager；manager 在 render 里按当前画的是否 active 切它们 visible。
- 副作用（正面）：size 只由 active 相机决定 → 根治需求 #2 的缩放问题。

**视口边框**：每视口一个绝对定位的 DOM 描边框，按 rect 定位。active 高亮（青蓝）、非 active 暗灰，仅改 CSS class。不污染 GL。布局/active 变化时更新位置与高亮。

**打光（亮面朝相机）**：各 scene 加一盏 `DirectionalLight`，每帧 render 前把 position 设到 active 相机方向（光从相机打向人体中心），target 设人体中心。面向相机的面始终受光。保留环境光打底。mesh 调更白更亮，适度防过曝。

**快捷键提示面板**：右下角浮层，列 `F 聚焦人体 / R 重置视角 / 锁定为重置视角 / 视口说明`。角标按钮最小化↔展开，状态存内存。两 app 都加（label 列 F；pcd 列 F/R + 视口）。纯 DOM/CSS。

## 6. 测试策略

CLAUDE.md：纯逻辑单测，three.js/DOM 浏览器验。

- 可单测：`viewport.js` 的「相对方位记忆/重新解释」抽成纯函数（给 up/front + 记忆方位 → 世界相机姿态），单测它。`framing` 测试不动。
- 浏览器手验：点大小三视一致、手柄仅 active 显示且尺寸稳定、边框 active 高亮、打光亮面朝相机随视口切换、锁定为重置→改 up/front→R 仍正确朝人体、提示面板最小化、预设只剩两个。

## 7. 范围边界

- 不改 SMPL 解算、标注存储、点云配色/抽稀逻辑（仅点大小关衰减）。
- 不持久化提示面板/锁定基准到磁盘（存内存）。
- label 保持单视口，只接 F + 提示面板 + mesh 打光/调亮。
- 几何永不旋转（坐标轴只改相机，沿用现有不变性）。
