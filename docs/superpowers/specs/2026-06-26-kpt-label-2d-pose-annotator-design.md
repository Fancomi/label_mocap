# 2D 人体关键点 + 框标注工具（kpt_label）设计

日期：2026-06-26
分支：`feat/kpt-label-2d-pose`

## 背景与目标

本仓库已把 3D SMPL 标注（图像对齐 `label/`、点云对齐 `pcd_label/`）做得很好，但 **2D 人体关键点**的标注仍缺一套专属、易用的工具。人体标注的常规流程是「打框 → 关键点 → 三维人体」，前两步目前没有顺手的 Web 工具。

本工具补齐前两步：在浏览器内完成 **2D 人体框 + 关键点**标注，输出**可直接导入 Ultralytics YOLO-pose 训练**的数据集（bbox 检测 + pose 估计）。

### 硬性要求

- 画面与交互**参考现有 `label/` 标注系统**（视口缩放、F 聚焦、R 重置、互斥编辑模式）。
- 框与关键点是**同一个人实体内的两个独立属性**（无先后依赖：可只打框、只打点、或两者任意顺序）。
- 目标格式**完全对齐 Ultralytics YOLO-pose**，且**必须验证能直接导入训练**（bbox / pose）。
- 每个人一套**不重名、有次序、有连线**的关键点，允许缺标（镜头外 / 遮挡）。
- 支持**多人标注**：新建人物、选定已标注人物、删除人物、改框改点。
- 人物面板含**人体图图例**（类 Maya humanIK），选中关节即可打点 / 挪位，规避文本输入。
- 支持**高清图像 30+ 人**标注，需要与 `label/` 同类的视口缩放系统。

## 范围（v1）

- 输入：**图像序列 + 视频**（视频按帧抽取，复用 `label/` 的 video_source）。
- 骨架：**COCO-17**（业界标准、YOLO 生态预训练齐全），但骨架定义**配置驱动**，可扩展，v1 UI 不暴露切换。
- 工作格式：**保真中间 JSON**，**一键导出** YOLO `images/ labels/ + dataset.yaml`。
- 落盘：**目录内存**（Chrome/Edge File System Access，其他浏览器下载）。
- 不做：联动 / 整人平移（单点独立拖动）、骨架切换 UI、自动检测预标注。

## 架构

### 定位

新建 **`kpt_label/`**，与 `label/` `pcd_label/` 平级。**纯 2D、不引入 three.js、不引入 SMPL 内核**。根 `index.html` 增加入口卡片，`package.json` 增加 `serve:kpt`。

### 为什么独立 app、不复用 SMPL 模型

`smpl_edit/coco_document.js` + `annotation_store.js` 是**单人 SMPL 模型**（`_byImageId` 一图一标注，字段为 `body_pose`/`betas`/`root_*`），与本工具「**多人 × (bbox + 17 关键点)**」的模型不匹配。强行复用会污染 SMPL 内核且引入不需要的 three.js 依赖。因此本工具**新建独立的多人标注模型**。

### 复用边界（直接 import，不改原文件）

跨 app 相对 import（同源静态 ES module 可行）：

- `../../label/src/scene/view_zoom.js` — 视口缩放/平移纯数学：`computeWindow` / `zoomAtSolve`（光标锚点缩放）/ `imageToCanvasNorm` / `canvasNormToImage` / `clampPan`。零依赖。
- `../../label/src/io/image_order.js` — 帧排序（COCO `images[]` 顺序优先，否则数字排序）。
- `../../label/src/io/dataset_paths.js` — 目录分类（json/images/video 路径）。
- `../../label/src/io/source_loader.js` — 内容校验 + portrait 只读门。
- `../../label/src/io/dir_source.js` — File System Access 目录读写。
- `../../label/src/io/video_source.js` — 视频帧序列。
- `../../label/src/io/image_bytes.js` — base64 编码。

> 若相对路径过脆，备选是把共享纯模块抽到公共位置——但那是改动现有结构，**v1 先用相对 import，不动现有文件**。

### 渲染方式

不用 three.js。图像作底图，关键点 / 框 / 骨架连线作叠加，坐标统一走 `view_zoom.js` 的 `imageToCanvasNorm` / `canvasNormToImage`。因为没有 three.js 的 `setViewOffset`，缩放直接体现在 canvas 绘制，无需 `label/` 的 `syncHandleScale` 修正——比 `label/` 更简单。

**分层（Canvas 主 + 少量 DOM）**：30+ 人 × 17 点 = 500+ 交互元素，逐个 DOM hit-test 会卡。方案：

- **底图层**：`<canvas>` `drawImage`，按 view_zoom 窗口裁剪缩放。
- **标注层**：同一 canvas 画所有人的框 + 骨架连线 + 关键点圆点。非选中人淡化（低 alpha），选中人高亮加粗。
- **手柄/命中**：命中测试走**最近邻**（canvas 坐标算距离），不铺 500+ DOM。仅当前选中人的点支持拖拽微调。
- 颜色编码：v=2 实心、v=1 空心/叉、v=0 不画。

## 数据模型

### 中间 JSON（保真工作格式）

按图像位置索引，帧身份 = **位置** `image_idx`，非 `image_id` 值（与 `label/` 一致，禁止数据旋转，portrait 只读）。

```js
{
  schema: "kpt-label/v1",
  skeleton: "coco17",                          // 指向 skeleton 配置
  images: [ { file_name, width, height } ],    // 顺序 = 帧序（复用 image_order）
  annotations: [
    { image_idx: 0,
      persons: [
        { id: 1,                               // 图内唯一序号
          bbox: [x, y, w, h] | null,           // 像素；null = 未打框
          keypoints: [ [x, y, v], ... ]        // 固定 17 项；未标 = [0,0,0]
        }
      ]
    }
  ]
}
```

要点：

- **关键点定长 17**，缺标 `[0,0,0]`（v=0），person 内无槽位错位，UI 人体图按索引取色。
- 三态可见性 `v ∈ {0, 1, 2}`：0=未标（不输出坐标）、1=标注但不可见（遮挡/出框）、2=可见。
- **bbox 与 keypoints 互不依赖**：可只框、只点、或都有。
- 导出时无框者用其关键点（v>0）包围盒 + 5% 边距自动补框，边距裁剪到图像内。

### skeleton 配置（配置驱动）

```js
// kpt_label/src/skeleton.js
export const COCO17 = {
  names:   [ 'nose','left_eye','right_eye', ... ,'right_ankle' ],  // 17
  edges:   [ [0,1],[0,2], ... ],            // 骨架连线
  flip_idx:[ 0,2,1,4,3, ... ],              // 左右镜像，导出 yaml 用
  layout:  [ { name:'nose', x:0.5, y:0.08 }, ... ]  // SVG 人体图归一化坐标
};
```

换骨架只改此文件；`names.length` 自动驱动 `kpt_shape: [N, 3]`。

## YOLO-pose 导出

### 目录布局

```
<out>/
  images/{train,val}/<stem>.<ext>     # 软链清单或写出
  labels/{train,val}/<stem>.txt
  dataset.yaml
```

### 每行 label 格式

```
<class> <cx> <cy> <w> <h> <kp1_x> <kp1_y> <kp1_v> ... <kp17_x> <kp17_y> <kp17_v>
```

- 全部归一化到 [0,1]：`cx=cx_px/W`、`cy=cy_px/H`、`w=w_px/W`、`h=h_px/H`、`kp_x=kp_x_px/W`、`kp_y=kp_y_px/H`。
- 每行字段数 = `5 + 17×3 = 56`。
- v=0 的点坐标输出 `0 0 0`。
- 多人 → 多行；一图无人 → 空 txt（背景负样本）。

### dataset.yaml

```yaml
path: <out>
train: images/train
val: images/val          # train/val 划分见下
nc: 1
names: { 0: person }
kpt_shape: [17, 3]
flip_idx: [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15]
```

### train/val 划分

导出时提供选项让用户选择（全部 train / 按比例划分）。默认与最简：可全部入 train，`val` 指向 `train` 以免 ultralytics 报错。

## 交互设计（参考 label/）

### 视口

滚轮按光标锚点缩放（`zoomAtSolve`）、拖拽平移、`F` 聚焦选中人、`R` 重置。30+ 人高清必备。

### 打点（选关节 → 点图）

1. 右侧人物面板 **SVG 人体图**点选一个关节 → 进入「待放置」。
2. 图像上单击 → 放置该点（默认 v=2），自动跳到下一个未标关节（可关）。
3. 已有点：拖动微调；快捷键切 v 2↔1↔0（0 即删除该点）。

### 多人选择（列表 + 画面双向）

- 右侧 **Person 列表**（序号 + 框/点完成度小标），点击选中。
- 画面点击某人框/点也选中（最近邻命中）。
- 列表顶：新建人 / 删除选中人；新建后默认进入打点流程。

### 编辑模式（借 label 互斥 Tab）

- **Bbox 模式**：画/拖框（`bbox_geom` 的画新框 + 拖角）。
- **Pose 模式**：选关节 → 点图打点。
- 针对当前选中人，自由切换，无先后。

### 快捷键

`N` 新建人、`Del` 删人、`Tab` 切下一人、`1/2` 切 Bbox/Pose、`F` 聚焦、`R` 重置、`Z` 撤销。

## 文件结构与能力切割

```
kpt_label/
  index.html              # importmap + 布局骨架
  src/
    app.js                # 装配：IO + 视口 + 渲染 + 事件 + 面板（DOM/canvas 耦合）
    skeleton.js           # ★纯：COCO17 配置
    kpt_store.js          # ★纯：多人模型 + 撤销 + 增删改事务
    yolo_export.js        # ★纯：中间 JSON → YOLO 行 / yaml / 划分
    hit_test.js           # ★纯：canvas 坐标命中 person/joint/bbox 角
    bbox_geom.js          # ★纯：画框 / 拖角 / 点包围盒补齐
    body_diagram.js       # SVG 人体图（数据驱动，轻 DOM）
    render.js             # canvas 绘制：底图 + 框 + 骨架 + 点（分层、淡化/高亮）
  tests/
    kpt_store.test.js
    yolo_export.test.js
    hit_test.test.js
    bbox_geom.test.js
    skeleton.test.js
```

**切割原则**：

- 纯逻辑（★）全部可 CLI 单测（`node --test`）。
- canvas/DOM/事件只在 `app.js` / `render.js` / `body_diagram.js`，浏览器内验证。
- 单一职责：`render.js` 只画不改状态；`kpt_store.js` 只改状态不碰 DOM。

## 测试与验证策略

### 1. CLI 单测（node --test，纯逻辑）

- `yolo_export.test.js`（最关键）：归一化正确、每行字段数 = 56、缺框补齐（点包围盒 + 边距裁剪到图像内）、可见性映射、dataset.yaml 字段（`kpt_shape:[17,3]`、`flip_idx` 长度 17、`names`、`nc:1`、train/val）、多人多行、空图空 txt。
- `kpt_store.test.js`：增删人、选人、改点改框、撤销还原、定长 17 不错位。
- `hit_test.test.js`、`bbox_geom.test.js`、`skeleton.test.js`（校验 `names.length === flip_idx.length`、`edges` 索引合法、`layout` 覆盖全部关节）。

### 2. 真·训练冒烟（小规模先行）

造 2~3 张图、含多人/缺框/缺点的小数据集，`yolo_export` 生成真实数据集，跑：

```bash
yolo pose train data=dataset.yaml model=yolo11n-pose.pt epochs=1 imgsz=320
```

**降级方案**：环境若无 ultralytics/torch，写 stdlib Python 校验脚本（按 ultralytics dataloader 规则逐行校验：列数、范围 [0,1]、yaml 字段），纳入 `npm run test:tools`。实现阶段探测环境后决定，不阻塞设计。

### 3. 浏览器内验证

`npm run serve:kpt` 起静态服务，手动验证：打开目录、缩放 30+ 人不卡、选关节打点、双向选人、导出落盘。测完清理临时数据。

### npm test 集成

新增 `*.test.js` 自动进 `test:web`；Python 校验脚本（若用）进 `test:tools`。

## 已确认决策摘要

| 决策点 | 选择 |
|---|---|
| 骨架 | COCO-17 + 配置可扩展（UI 不暴露切换） |
| app 边界 | 独立新 app `kpt_label/`，纯 2D，不引 three.js/SMPL |
| 工作格式 | 保真中间 JSON，一键导出 YOLO |
| 输入 | 图像序列 + 视频 |
| 框/点关系 | 同一人内两个独立属性，无先后依赖 |
| 可见性 | 三态 v=0/1/2 |
| 打点交互 | 选关节 → 点图 |
| 多人选择 | 列表 + 画面双向联动 |
| 人体图图例 | SVG 示意人体图 |
| 落盘 | 目录内存 + 一键导出 |
| 缺框处理 | 点包围盒 + 5% 边距自动生成 |
| 拖动 | 单点独立拖动 |
| train/val | 导出选项让用户选择 |
