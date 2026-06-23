# 极向量控制器（Pole Vector Controllers）设计

- 日期：2026-06-23
- 分支：`feat/pole-vector-controllers`（从 `main` 并行拉出，与 `label-cloud-gvhmr` 互不影响）
- 内核：`smpl_edit`（label / pcd 两 app 共享，自动同时获得能力）
- 状态：设计已确认（brainstorming 四段全部通过），待写实现计划

## 1. 背景与目标

设计师要求在现有 IK 基础上，于**膝盖与手肘**加控制器。诉求实质是 Maya 式的**极向量（pole vector）**：在 IK 调节弯折关节（肘/膝）时，给一个柄来约束「肘/膝朝哪一侧弯」，避免 IK 求解时弯折关节乱跑。

拖动极向量柄时的期望行为：**末端（腕/踝）世界位置不动、弯折角（肘/膝弯曲程度）不变**，整条肢体绕「根→末端」连线旋转——即只有根关节（肩/髋）产生真正的局部旋转，肘/膝、腕/踝的局部旋转不变。这正是解析双骨 IK 的天然产物。

### 关键认识

`smpl_edit/ik_solver.js` 的 `solveTwoBoneIK({root, mid, end, target, pole})` **本身就是极向量解算器**：`pole` 参数决定弯折平面朝哪侧。现状是 `ik_controller.js` 用 `cross(hinge, dir)` 从冻结参考姿态**自动推导** `pole`。

因此本设计**不新增解算逻辑**，只做两件事：

1. 给已有的 `pole` 通道接一个**人控入口**（可拖的柄）。
2. 把柄位置**逐帧存储**。

## 2. 设计决策（已确认）

| 维度 | 决策 |
|---|---|
| 激活模型 | **跟随 IK 选中肢体**——IK 开启且选中某末端关节（腕 20/21 或踝 7/8）时，自动显示该肢体的极向量柄 |
| 存储语义 | **稀疏覆盖**——仅手动拖过的肢体在该帧写入 pole；未动过的链键不存在 = 沿用现有自动推导。「复制上一帧」连带稀疏继承 |
| 坐标系 | **世界绝对位置** `[x, y, z]`（符合设计师 Maya 心智模型；脆弱性由解算层投影兜底，见 §5） |
| 柄共存 | **双柄同显**——选中肢体时同时出现「末端目标柄」（现有 IK handle）+「极向量柄」（新增） |
| 拖柄语义 | **末端锁定、仅旋转平面**——末端不动、弯折角不变，仅根关节旋转 |

### 选型路线

- **路线 A（采纳）**：扩展 IK 控制器，pole 柄复用现有 `solveTwoBoneIK`。内核完全复用，label/pcd 自动同获；新增面极小；与现有 IK 撤销/守卫/synchook 体系一致。
- 路线 B（否决）：独立 pole 插件自带解算——要复制冻结参考/解算/guard 接线，两套解算易发散，违背「IK 核心完全复用」。
- 路线 C（否决）：pole 仅作下次求解偏好、不实时改姿态——与「实时旋转平面」诉求冲突。

## 3. 架构与数据模型

**新增 1 文件，改动 3 内核文件（app.js 力争 0 改动）：**

- **新建** `smpl_edit/pole_handle.js`——镜像 `ik_handle.js`：translate-only `TransformControls` + 一个**可见小球**（区别色，便于点选）。接口 `attach(pos) / detach() / isEngaged() / isDragging()`，回调 `onStart / onDrag(worldPos) / onEnd`。
- **改** `ik_controller.js`——加 pole 拖拽生命周期（`beginPoleDrag` / `setUserPole`），并让普通 IK 求解优先消费存储的 pole。
- **改** `ik_plugin.js`——选中末端肢体时同时挂两个柄；接线存储；pole 柄经 `ctx.registerGuard()` 注册进现有守卫体系。
- **改** `coco_document.js`——`EDITABLE` 集合加 `'pole_vectors'`。
- **改** `annotation_store.js`——`addFromPrevious` 稀疏拷贝 `pole_vectors`。

### 数据模型（player_0.json 每帧 annotation 新增字段）

```js
pole_vectors: {
  L_Arm: [x, y, z],   // 世界绝对位置；键缺失 = 沿用自动推导（现状行为）
  R_Arm: [x, y, z],
  L_Leg: [x, y, z],
  R_Leg: [x, y, z],
}
```

- 链名复用 `ik_chains.js` 的 `L_Arm / R_Arm / L_Leg / R_Leg`。
- **只有用户拖过的肢体才写入对应键**；没拖过的键根本不存在 → 求解时走原自动 hinge 推导。
- 整个字段为空 `{}` 或缺失时，行为与今天完全一致（**向后兼容，老数据零迁移**）。

## 4. 交互与拖柄解算语义

### 激活模型（跟随 IK 选中肢体）

IK 开启 + 点选某末端关节（腕 20/21 或踝 7/8）→ `ik_plugin` 的 syncHook 触发时同时挂两个柄：

- **末端目标柄**（现有 `ik_handle`）：拖它 = 移动腕/踝去哪。
- **极向量柄**（新 `pole_handle`，可见小球）：拖它 = 控制肘/膝朝哪弯。

切到另一肢体 → 旧柄 detach、新柄按该肢体 pole 数据 attach。IK 关闭 / 切到 Pose/Root/Bbox 模式 → 两柄全 detach。

### 极向量柄初始位置

选中肢体时：

- 该帧该链**已有存储 pole** → 柄放在存储的世界位置。
- 否则放在「自动推导方向」的可视化位置，即 `chainRoot + autoBendDir * L`（L 取上臂/大腿骨长量级，让小球落在肘/膝外侧合理处）。

柄一出现就在直觉位置，用户拖动即转为人控。

### 拖极向量柄的解算（末端锁定、仅旋转平面）

1. `onStart` → `ikController.beginPoleDrag(chain)`：冻结当前**末端世界位置**为 target、冻结骨长。
2. `onDrag(poleWorld)` → `poleDir = norm(poleWorld − chainRoot)`，投影到垂直于（根→末端）连线得到 `bend`，调 `solveTwoBoneIK({root, mid, end, target: 冻结末端, pole: bend})`。
3. 结果：末端不动、弯折角不变，整条肢体绕「根-末连线」转 → **只有根关节（肩/髋）局部旋转在变**，肘/膝、腕/踝局部旋转不变。解析双骨解算天然产物，无需额外约束。
4. `onEnd` → `store.applyFields({...rot.toAxisAngle(), pole_vectors: {...existing, [chain]: poleWorld}})`，一次 commit 进撤销栈。

### 两柄联动

拖末端目标柄时（普通 IK），`solveTo` 读该链存储的 pole：有则用人控方向，无则自动推导。于是「先拖末端、再拖极向量」与「先设极向量、再拖末端」都收敛到同一可预测姿态。

### 可见性细节

极向量柄小球用区别色（如青色）与末端柄区分；小球本身可点选拖动，不只靠 TransformControls 箭头。

## 5. 鲁棒性矩阵（各操作顺序）

**核心原则**：存储的 pole 只用于派生弯折方向 `bend`，而 `bend` **始终被重新投影到当前（根→末端）连线的垂直面**——`solveTwoBoneIK` 内部已做此投影（`ik_solver.js:47`）。即使存的世界点因 root 移动而失位，投影后方向通常仍合理。

**两层退化兜底**（pole 几乎与连线共线时）：
- 控制器层（`ik_controller.js:89`）：用户 pole 投影退化 → 落该链的参考弯曲侧 `ref.perp0`（即原自动 hinge 推导方向），与现状行为一致。
- 解算器层（`ik_solver.js:48-50`）：传入 pole 投影后仍退化 → 落 Y 轴、再 X 轴投影，保证不产生 NaN。

世界坐标的脆弱性由这两层投影/兜底吸收。

| # | 操作顺序 | 风险 | 处理 |
|---|---------|------|------|
| 1 | 拖 pole → 换帧 → 回来 | 柄位置丢失 | 该帧已存 pole，回来按存储重挂；无存储帧落自动位置 |
| 2 | 拖 pole → root 平移 | 世界点不跟随肢体，柄悬空 | 求解用投影后方向仍跟肢体走，姿态不乱；柄视觉滞后，再拖即修正 |
| 3 | 拖 pole → 改 beta（骨长变） | 末端/根位置变，柄错位 | 同 #2：投影兜底；柄重挂旧世界点 |
| 4 | 拖 pole → 撤销 | pole 与姿态须同回退 | onEnd 时 pole_vectors 与 root_rota/body_pose 在**同一次 applyFields** 写入，单条 undo 整体回退 |
| 5 | 拖末端目标 → 已存 pole | 用谁的弯折方向 | solveTo 读存储 pole；有则人控，无则自动 |
| 6 | 「复制上一帧」 | pole 是否继承 | `addFromPrevious` 稀疏拷贝：上一帧有的链键才拷，无则不写 |
| 7 | pole 柄与末端柄拖拽冲突 | 两 TransformControls 同时响应 | 复用现有 dragGuards/engageGuards：一柄 engaged 时禁另一柄；OrbitControls 也被现有 guard 冻结 |
| 8 | IK 关闭时存的 pole | 残留数据 | 数据保留在 json（无害）；IK 再开按存储重挂。关 IK 只 detach，不删数据 |
| 9 | 无 SMPL 的帧（仅 bbox/空） | 柄无处可挂 | syncHook 早返回 false，柄不挂（与现有 IK 行为一致） |
| 10 | pole 与连线共线（退化） | 投影为零向量 | 解算器已有 fallback：bend 退化时落 Y 轴再 X 轴投影（`ik_solver.js`），不 NaN |
| 11 | 播放中（isPlaying） | 逐帧重挂抖动 | 复用 `isPlaying()` 守卫：播放时不挂柄 |
| 12 | 直接拖 pole 但该肢体从没 IK 过 | 无冻结参考 | beginPoleDrag 自己冻结，不依赖末端柄先拖过；target 取当前末端世界位置 |

### 关键不变式

- pole_vectors 与姿态字段**同事务写入**（保证 #4 撤销原子性）。
- 求解永远以「当前根/末端」为准、pole 仅供方向，且方向必经垂直投影（保证 #2/#3/#10 不崩）。
- 柄挂载完全由 syncUI/syncHook 状态驱动，无独立生命周期（保证 #1/#8/#9/#11 与现有体系一致）。

## 6. 两 app 接线与测试策略

### 接线（内核复用，app 几乎零改动）

- **`ik_plugin.js`**：内部新建 `PoleHandle`，与现有 `IKHandle` 并列。已持有全部 ctx（scene/camera/canvas/controls/getStore），无需 app 传新东西。
- **`label/src/app.js` 与 `pcd_label/src/app.js`**：`installIK(...)` 调用处**不变**。需确认 `showFrame()` 末尾的 `syncUI()` 已触发 syncHook 重挂柄（现状如此）。
- 存储经 `coco_document` / `annotation_store`（两 app 共用）。save 路径（label `saveJson`、pcd `serialize→saveAnnotation`）**无需改**：pole_vectors 是用户编辑字段，drag 时已写入 doc，序列化自动带出。

净结果：**新建 1 文件，改 3 内核文件，app.js 力争 0 改动**（实现时验证 syncUI 确实覆盖；若不覆盖则两 app 各加一行）。

### 测试策略

遵循 CLAUDE.md：纯逻辑单测（`node --test`），three.js/WebGL/DOM 在浏览器验。

纯逻辑单测（`smpl_edit/tests/` 新增 `*.test.js`）：

1. **pole 解算语义**：给定 root/mid/end/target=当前末端 + 一个 pole 方向，验证 `solveTwoBoneIK` 返回 end 仍等于 target（末端锁定）、mid 落在 pole 指示侧。
2. **末端锁定不变式**：拖 pole 前后，验证肘/膝、腕/踝**局部四元数不变**，仅根关节局部旋转变（核心诉求，单测钉死）。
3. **退化 fallback**：pole 与连线共线 → 不产 NaN，落自动 hinge。
4. **存储往返**：`coco_document` 写入稀疏 `pole_vectors` → serialize → 重载，未编辑链键不出现；`addFromPrevious` 稀疏继承正确。
5. **撤销原子性**：一次 pole 拖拽 commit，undo 后 pole_vectors 与 body_pose/root_rota 同时回退。

浏览器手验（不可单测）：两柄同屏、点选拖动、切肢体重挂、root 平移后柄行为、播放中不挂。

## 7. 范围边界

- **仅** 4 条肢体链（双臂双腿）的极向量。不含其他关节。
- 不改 IK 求解算法本身；不改末端目标柄行为；不改非 IK 编辑模式。
- 不做 pole 柄的世界→相对坐标迁移（已确认用世界绝对坐标 + 投影兜底）。
