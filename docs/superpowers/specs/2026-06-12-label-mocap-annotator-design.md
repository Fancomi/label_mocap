# SMPL 标注器 (label_mocap annotator) — 设计文档

- 日期: 2026-06-12
- 状态: 设计已与用户逐节确认,待评审
- 范围: 在现有 `smpl_viewer` / `smpl_web_viewer` 查看器之外,新增一个 SMPL 数据**标注器**子系统 (`label/`),支持增强的数据加载、增删改标注、IO。

## 1. 背景与目标

现有 `smpl_viewer` 是只读查看器:严格要求图像帧与数据帧一一对应,缺一即报错;只能展示 root pos/rot,不能编辑。

本次目标是构建**标注器**:在保持查看器能力的基础上,允许增、删、改图像帧中的 SMPL 数据,并增强数据加载的鲁棒性与功能性。

### 非目标 (v1 明确不做)

- 多人标注 (v1 只标单人 `player_0`;通过加载多个 json 间接支持多人,json 结构不写死单人)
- IK 拖拽端点解算 (留 v2,但旋转内核为其预留接口)
- 2D 关键点的手动逐点编辑 (keypoints 不手动编辑,只随 3D 投影更新)
- 旋转 (portrait / N×90° 图像旋转) 状态下的标注 (只读)
- SMPLX / SKEL / MHR 等其他骨骼系统 (架构预留,不实现)
- "先框 bbox 再调 API 解析人体" 的交互 (架构预留,不实现)

### 工程化原则

- 单一可信源 (single source of truth):旋转用四元数、标注用 AnnotationStore。
- 单向数据流:加载 → Store → (驱动 / 编辑 / IO),编辑回写 Store 再广播刷新。
- 模块边界清晰:每个单元职责单一、可独立测试。
- 不硬编码:源旋转格式、骨骼类型、单/多人,均通过声明属性或数据结构预留扩展点。

## 2. 总体架构

```
label_mocap/
├── smpl_core/                    # 新增:从两个 viewer 抽取的中立 SMPL 内核
│   ├── lbs.js, math3d.js         #   forwardSmpl / 轴角↔矩阵 等
│   ├── smpl_model.js             #   模型常量加载
│   ├── smpl_worker.js            #   驱动 worker
│   └── rotations.js              #   新增:四元数↔欧拉↔轴角↔矩阵 互转
├── smpl_web_viewer/              # 现有,改 import 指向 smpl_core
├── smpl_viewer/                  # 现有,改 import 指向 smpl_core
└── label/                        # 新增:标注器
    ├── index.html
    ├── src/
    │   ├── app.js                # 协调器:加载→渲染→编辑→IO
    │   ├── io/
    │   │   ├── coco_document.js  # COCO json 保真读/改/回写
    │   │   ├── source_loader.js  # 鲁棒加载:图像序列/视频/缺图/缺数据/部分帧
    │   │   └── pose_format.js    # 磁盘旋转格式(轴角)↔ 四元数 hub
    │   ├── scene/
    │   │   ├── scene.js          # three 场景 + mesh/关节/bbox 绘制
    │   │   └── camera_modes.js    # 移植清理后的 2D/3D 相机
    │   ├── edit/
    │   │   ├── annotation_store.js # 单一可信源 + 增删改 + undo 事务
    │   │   ├── rotation_state.js   # 旋转唯一源头(四元数)+ 多视图派生
    │   │   ├── root_handle.js      # root pos/rot 的 2D/3D 拖拽手柄
    │   │   ├── pose_gizmo.js       # 关节旋转环 gizmo + 欧拉数值/滑条
    │   │   ├── bbox_edit.js        # bbox 四点拖拽 + 从 mesh 投影
    │   │   ├── beta_panel.js       # 10 beta 滑条
    │   │   └── occlusion.js        # 关节可见性(深度图比较)
    │   └── ui/                     # 面板、保存/reset、状态栏
    └── tests/
```

### 数据流(单向)

```
COCO json ──load──▶ AnnotationStore(每帧一条可选标注)
                         │
        ┌────────────────┼────────────────────┐
        ▼                ▼                      ▼
   驱动(forwardSmpl)  编辑交互               IO(save 回写COCO)
        │            (gizmo/拖拽/数值)
        ▼                │
     场景渲染 ◀── store.commit(变更) ──┘
```

`AnnotationStore` 是唯一可信源。所有编辑通过其 `set/add/delete` 改,提交后广播事件,场景与面板订阅刷新。旋转的三/四种格式互转集中在 `rotation_state.js` + `rotations.js`,不散落到 UI。

### 共享内核抽取

将 `lbs.js` / `math3d.js` / `smpl_model.js` / `smpl_worker.js` 从 `smpl_web_viewer/src/smpl/` 抽到顶层 `smpl_core/`,两个 viewer 与 label 共同 import。现有测试覆盖驱动逻辑,抽取后更新 import 路径并跑全套测试确认无回归。

## 3. 旋转模型(唯一源头 + 多视图)

旋转是最易出 bug 的部分。内存中**唯一源头是四元数**,每个被驱动的旋转单元各一个:

```
RotationState (内存唯一源)
  root_q:      Quaternion          # root 朝向
  joint_q[21]: Quaternion[]        # 21 个 body 关节各自局部旋转
```

各视图都是四元数的读/写投影,任一处编辑 → 转四元数 → 写源头 → 广播 → 其他视图重新派生:

| 视图 | 方向 | 用途 |
|------|------|------|
| 欧拉角 (固定顺序 XYZ) | 双向 | 数值框、每轴滑条、gizmo 拖拽的可编辑视图 |
| 轴角 | 双向 | COCO 磁盘读入(轴角→四元数)/ 写出(四元数→轴角) |
| 矩阵 (mat3) | 只读 | 驱动 `forwardSmpl` |

### 防跳数(欧拉草稿)

欧拉角视图持有"用户正在编辑的那组欧拉值"作为本地草稿。只要四元数没有被别处改动,就保留该草稿,避免在 ±180° / 90° 等价解之间来回转换时数值跳变。一旦四元数被外部改动(切帧、延续上一帧、reset),草稿失效,从四元数重新派生。

### 源格式可插拔

`pose_format.js` 负责"磁盘格式 ↔ 四元数"。COCO 读入时记录 `pose_format: "axis_angle"`(当前数据即轴角)。将来若出现欧拉角源文件,只新增一个 decoder/encoder,源头(四元数)与编辑层(欧拉视图)均不改动。

### 边界

- betas 不走旋转 hub,单独 10 维数组。
- root_pos (平移) 不走旋转 hub,单独 3 维。
- SMPL pose 本身只有旋转、无关节平移/骨长,天然满足"无损标注:只能改 rot"。

## 4. 数据加载鲁棒性

以**帧索引为主轴**对齐,背景与数据各自可缺。

### 四种组合

| 背景 | 数据 | 行为 |
|------|------|------|
| 图像序列/视频 | 完整 | 正常标注 |
| 图像序列/视频 | 无 | 每帧空标注,可"增"创建 |
| 无 | 完整 | 纯色底 + mesh,3D 校验 |
| 图像序列/视频 | 部分帧有 | 有数据帧正常,无数据帧空(可增) |

### 统一帧模型

加载后构建 `frames[]`,每项:

```
{ index, image: File | videoTime | null, annotation: Annotation | null }
```

- **背景源** (`source_loader.js`):图像序列按文件名排序映射 index;视频按 `index → time = index/fps` seek;两者可整体为 null。背景源支持 HTML5 `<video>` (mp4/webm) 与图像序列两种。
- **数据源**:COCO `annotations[]` 按 `image_id` 落到对应 index;未匹配 index → `annotation: null`。
- **帧总数** = max(背景帧数, 数据最大 index+1);两者皆无 → 报"无可加载内容"。
- **极简交互**:加载入口仍是一个"选择目录/文件"按钮,内部自动判定有图/视频/数据,不增加模式选择按钮。

### portrait / 90° 旋转锁定

加载时检测数据是否为 portrait(竖拍 / 需 N×90° 图像旋转)。若是:**进入只读查看模式,禁用所有编辑**,提示"该数据需要旋转,标注器仅支持查看;请用其他软件将图像与数据转正后再提交标注"。三维旋转(root/pose 朝向)不受此限制,始终可标注。

## 5. 增删改交互

单人 `player_0`,增删 = 0↔1。所有编辑遵循事务模型:**操作开始**记录 before 快照 → 拖拽中实时改 → **操作结束**(mouseup)把 (before→after) 作为**一个** undo 单元提交;中途 Esc 回滚到 before。

### 删

当前帧 `annotation = null`,从 COCO `annotations[]` 移除该条(`images[]` 占位保留)。场景隐藏 mesh/handle,该帧留空。

### 增 (两种方式各一按钮)

- **T-pose 居中(默认值)**:root_q / joint_q 全单位,betas 全 0,root_pos 用固定默认深度(`[0, 0, -4]`)。
- **延续上一帧**:拷贝前一个非空帧的完整标注(root/pose/betas/bbox)。

### 改

见第 6 节四类编辑。

### 撤销 (undo)

AnnotationStore 维护 undo 栈,单元粒度是"一次完整编辑操作"(一次拖拽 = 一个单元),Ctrl+Z 回退到该操作**起点**值,而非上一动画帧。仅作用于当前会话。

## 6. 四类编辑交互

### 6.1 Root (pos + rot)

- **pos**:选中 root 出现三轴平移手柄(箭头)。
  - 3D 模式:拖箭头沿对应世界轴平移。
  - 2D 模式:拖动在图像平面内平移(屏幕 x/y → 相机平面);深度(沿视线)用**单独的深度手柄 / 滚轮**。
  - 数值框同步可输入。
- **rot**:三轴旋转环 gizmo(与关节共用 6.2 的 gizmo 组件),欧拉数值框同步。

### 6.2 Pose (每关节旋转) — 核心

- 点击关节点选中 → 该关节出现**三轴旋转环 gizmo**(类 Blender 旋转工具),拖环绕局部轴旋转。
- 侧栏同步显示该关节**欧拉角 (XYZ) 数值框 + 每轴滑条**,与 gizmo 双向同步。
- gizmo 与数值都只改"该关节四元数",写回唯一源头。
- 2D / 3D 模式都可用:gizmo 朝向跟随当前相机,拖拽量按屏幕投影换算为绕轴角度。
- **无损约束**:只能改 rot,SMPL pose 无关节平移/骨长,天然满足。
- v2 IK 预留:`rotation_state.js` 暴露"设定某关节朝向"接口,未来 IK 求解器写入即可,不改源头结构。

### 6.3 2D bbox (新增项)

- **读+显示**:从 COCO `bbox:[x, y, w, h]` 读,在 2D 模式画矩形(可 toggle)。
- **编辑**:拖四角/四边调整(控制四个点)。
- **从 mesh 投影自动算**:"自动 bbox"按钮 → 当前 mesh 全顶点用相机内参投影到图像 → 取 min/max 包围盒 → 替换当前 bbox。
- 仅在非旋转、2D 模式下编辑。

### 6.4 Beta (体型)

- 侧栏 10 个滑条(范围 ±5),实时驱动 `blendShape` 重算 mesh(驱动已支持 betas)。
- 数值框同步;reset 归零。

## 7. 派生字段:keypoints 与 occlusion

这两个字段不手动编辑,由 3D 状态自动派生,使保存的 2D 标注与 3D mesh 一致。

### 7.1 keypoints (52 slot)

- COCO `keypoints` 为 52 个点 ×(x, y, conf) = 156。
- SMPL 驱动产出 24 个关节(沿用 `smpl_viewer` 已验证的 24 关节读取约定,即正确映射)。
- **2D 对齐显示**:读入时按原值显示;3D 调整后,把 24 个 SMPL 关节投影到图像更新对应的 24 个 slot,**其余 slot 置 0**(conf=0)。
- **保存**:写出 3D 投影后的 keypoints(24 个有效 slot + 其余置 0)。

### 7.2 occlution_joint (关节可见性)

高效且兼容性最高的方案:**WebGL 深度图比较**。

- 每帧本就渲染 mesh。额外取一遍深度(复用主渲染深度或离屏渲染一次)。
- 把每个关节点投影到屏幕,比较其深度 vs 该像素存储的 mesh 深度(加 epsilon)。被遮挡 → occluded。
- 一次渲染 + 一次 `readPixels` 批量判定所有关节,开销极低。
- 写回 `occlution_joint`(沿用现有 52 长度数组语义,对应 24 关节 slot 填可见性,其余保持/置默认)。

## 8. IO 与保存

### Save (回写 COCO,保真)

- 序列化 AnnotationStore 回原始 COCO 结构,**只改编辑过的字段**:
  - `bbox`
  - `root_pos`
  - `root_rota` (四元数 → 轴角)
  - `body_pose` (四元数 → 轴角)
  - `betas`
  - `keypoints` (3D 投影派生)
  - `occlution_joint` (深度比较派生)
- 其余字段(`id` / `segmentation` / `right_hand_pose` / `left_hand_pose` / `p3d` / `category_id` / `area` / `iscrowd`)**原样保留**。
- **删除的帧**:从 `annotations[]` 移除条目,`images[]` 占位保留。
- **新增的帧**:新建 annotation 条目,未编辑的保留字段填合理默认(hand_pose / segmentation / p3d 等置空或 0)。
- 浏览器内触发下载新的 `player_0.json`,**不覆盖原文件**(避免误删)。
- 背景为视频/图像时 save 只写 json(已禁止旋转标注,坐标即正向,无需重编码视频)。

### Reset

按下后**立即重新加载当前硬盘上的 json**(而非内存最初快照),丢弃所有未保存编辑,清空 undo 栈。

## 9. 扩展性预留(不实现)

- **A. 其他骨骼 (SMPLX/SKEL/MHR)**:旋转源头按"单元数组"组织(root + N 关节),驱动模型通过 `smpl_model` 抽象加载;增加骨骼类型 = 新模型常量 + 新关节数,不改 Store/旋转内核。
- **B. 多人**:AnnotationStore 以"人"为集合元素(v1 只含 player_0),COCO 读写已是 `annotations[]` 列表;多人 = 加载多个 json / 多个 player,场景管理另行设计,数据层不写死单人。
- **C. 先框 bbox 再调 API**:bbox 编辑已独立成 `bbox_edit.js`;未来"框完调 API 解析"= 在 bbox 提交后挂一个 async 解析步骤,写回 Store,不改 bbox 编辑本身。

## 10. 测试策略

- **旋转内核**:四元数↔欧拉↔轴角↔矩阵 round-trip 数值测试;欧拉草稿防跳数测试。
- **加载鲁棒性**:四种组合(图/视频 × 有/无/部分数据)的 `frames[]` 构建测试;portrait 锁定测试。
- **AnnotationStore**:增/删/改/undo 事务边界测试(一次拖拽 = 一个 undo)。
- **IO 保真**:load → save round-trip,确认未编辑字段逐字节保留;删除/新增帧的 annotations/images 结构正确。
- **bbox 投影**:已知 mesh + 内参 → 期望包围盒。
- **现有 viewer**:抽取 smpl_core 后跑全套现有 JS/Python 测试,确认零回归。


