# 3D 点云 SMPL 标注器 设计文档

日期:2026-06-19
状态:已认可,待转实现计划

## 1. 目标

构建一个**纯 Web、可部署到 GitHub Pages、数据完全本地操作**的 3D LiDAR 点云 SMPL
标注工具。脱胎于现有 `label/`(2D 图像 + SMPL 标注器),去掉所有 2D / 相机内参 /
投影 / bbox / 关键点重投影相关内容,改为:在真实 LiDAR 点云 3D 世界里摆放并编辑一个
SMPL 人体,导出标注。无服务端、无后端,页面从公网拉到本地浏览器打开,直接读写本地数据。

与 `label/` 一致的非功能目标:纯静态资源、ES module、three.js、`smpl_core/` 共享内核、
浏览器 File System Access API 读写目录。

## 2. 数据格式(已从产出代码 + 样例反解确认)

产出代码:`lidar_pcap_export_pointcloud_frames.cpp` 的 PNG 序列分支。

每个序列是一个目录(如 `…-RS-520-Data/`),内含:
- `manifest.json`
- `frame_%06d.png`(逐帧)

`manifest.json` 字段(样例实测):
```json
{
  "format": "png-sequence",
  "frame_pattern": "frame_%06d.png",
  "frame_count": 176,
  "fps": 10,
  "point_width": 800,
  "point_height": 780,
  "image_width": 800,
  "image_height": 2340,
  "png_channel_order": "RGB_HIGH_MID_LOW",
  "scale": 1000,
  "center": 256
}
```

**PNG 编码(已手工解码一帧验证)**:
- PNG 尺寸 `point_width × (point_height*3)`,即 `800 × 2340`,RGB888。
- 纵向分 3 个 band,每个 `point_height(780)` 行:band0 = X,band1 = Y,band2 = Z。
- 每像素的 RGB = 一个 24 位无符号整数的高/中/低字节:`encoded = (R<<16)|(G<<8)|B`。
- 解码坐标:`value = encoded / scale - center`(scale=1000, center=256)。
- `encoded == 0` 表示该点无效(空)。
- 像素 `(row, col)` 对应点的线性序 `point_index = row*point_width + col`(与导出端
  `cloudToCompressedFrameBuffer` 的 row-major 一致)。
- 样例实测:单帧有效点约 48 万 / 62.4 万;X∈[0.6,37.6](前向距离)、Y∈[-10.7,10.0]
  (横向)、Z∈[-8.5,6.9](高度)→ 典型 **Z-up / X-front** LiDAR 坐标系。
- **无 intensity 字段**(PNG 只编了 XYZ),故 `lidar_viewer` 的 intensity 配色在本数据上
  不可用;默认配色落到「按高度 Z」(视觉上最接近 intensity 伪彩)。

## 3. 包结构(B 抽公共 + A 新建)

三层:

### 3.1 新增公共包 `smpl_edit/`(B:从 label 抽取)

放真正与 2D / 相机 / 投影无关、纯世界系工作的编辑内核。逐个确认过这些模块只在
three.js 世界坐标里读写关节四元数与位置,对「背景是图片还是点云」无感知:

| 模块 | 原位置 | 改动 |
|---|---|---|
| `rotation_state.js` | label/src/edit | 原样搬(纯四元数,依赖 smpl_core/rotations) |
| `annotation_store.js` | label/src/edit | 原样搬 |
| `coco_document.js` | label/src/io | 原样搬 |
| `gizmo_frame.js` | label/src/edit | 原样搬(纯数学:世界↔局部四元数) |
| `pose_gizmo.js` | label/src/edit | 原样搬(three.js TransformControls,世界系) |
| `root_handle.js` | label/src/edit | 原样搬 |
| `transform_picker.js` | label/src/edit | 原样搬(gizmo 命中收紧) |
| `ik_controller.js` `ik_handle.js` `ik_solver.js` `ik_chains.js` `ik_plugin.js` | label/src/edit | 原样搬(世界系两段 IK,不碰投影) |
| `ui_controller.js` | label/src/ui | 原样搬;`MODES` 收窄见 §6 |
| `joint_picker.js` | label/src/ui | 原样搬(对关节球 raycast,与背景无关) |

公共测试一并迁到 `smpl_edit/tests/`:`rotation_state` `annotation_store`
`coco_document` `gizmo_frame` `ik_solver` `ik_chains` `ik_controller` `ui_controller`。

### 3.2 `label/` 瘦身(A 的反向:改为依赖公共包)

删除 label 内上述模块的本地副本,import 路径改指 `../../smpl_edit/…`。label 只保留它
**特有的 2D 部分**:`scene/scene.js`(背景图/frustum/bg 平面)、`scene/camera_modes.js`
(2D/3D 双模 + 内参)、`scene/projection.js`、`scene/camera_modes` 等、`edit/bbox_edit.js`
`edit/bbox_overlay.js`、`edit/derived.js`(关键点重投影)、`edit/occlusion_raycast.js`、
`io/`(jpg/video/coco 加载)、`ui/panels.js`。`app.js` 的 import 路径相应更新。

重构后**必须**跑 label 全套测试(`node --test label/tests/*.test.js`,迁移后为
`smpl_edit/tests/*` + label 剩余 test)确保零回归,并人工浏览器验证 label 仍正常。

### 3.3 `pcd_label/` 新建(A:全新)

镜像 label 目录结构,只写点云特有模块,大量复用 `smpl_edit/` 与 `smpl_core/`:

```
pcd_label/
  index.html
  src/
    app.js                 装配:复用 smpl_edit 的编辑链路
    io/
      pcd_dir_source.js     目录扫描:读 manifest.json + frame_*.png 序列
      annotation_io.js      读写标注 json(沿用 coco_document)
    scene/
      pcd_scene.js          three.js 场景:点云 + SMPL mesh/joints/bones + grid/axes
      point_cloud.js        PNG→XYZ 解码、配色、抽稀;THREE.Points
      camera_orbit.js       纯自由 orbit 相机(无 2D snap、无内参)
      axis_frame.js         上轴/前轴映射(§5)
    ui/
      panels.js             左只读面板 + 右编辑面板(Pose/Root/Beta,无 Bbox)
      color_controls.js     配色模式选择 + 抽稀滑杆 + 点大小
  tests/
    point_cloud_decode.test.js   PNG 解码 → XYZ 数值(纯逻辑,Node 可跑)
    axis_frame.test.js           上轴/前轴映射矩阵正确性
    pcd_dir_source.test.js       manifest 解析、帧排序
```

## 4. 点云解码 / 配色 / 抽稀

### 4.1 解码(`point_cloud.js`)
- 用 `ImageBitmap` + `OffscreenCanvas`(或 `<canvas>`)`getImageData` 拿 PNG 的 RGBA 像素。
- 按 §2 公式逐像素解出 XYZ;`encoded==0` 跳过。
- 输出一个 `Float32Array(validCount*3)` 的位置缓冲 + 一个标量缓冲(每点的 Z / range /
  原始 XYZ,供配色用)。
- 解码在主线程即可(单帧 ~62 万像素,实测可接受);若卡顿,后续可挪进 Worker(延后)。

### 4.2 配色(全部做成可选,默认对齐 lidar_viewer 风格)
配色模式(下拉/按钮切换),每点算出一个 RGB 写入 `THREE.Points` 的 color 属性:
1. **按高度 Z 伪彩**(默认)—— colormap(jet/turbo/viridis)映射 Z∈[zmin,zmax]。
2. **按距离伪彩** —— colormap 映射 range=√(x²+y²+z²)。
3. **轴向 RGB** —— X→R, Y→G, Z→B 归一化直映。
4. **单一纯色** —— 固定灰/白,点大小可调。

colormap 用查找表实现(纯函数,可单测)。`zmin/zmax`、`rangeMax` 取当前帧实测分位数
(如 2%/98%)避免离群点拉爆色带。

### 4.3 抽稀 / 点大小
- 全量渲染为默认;提供**抽稀滑杆**(比例 100%→…),按固定步长抽取点索引降采样。
- 点大小滑杆(`THREE.PointsMaterial.size`,sizeAttenuation 视情况)。

## 5. 坐标轴映射(上轴 + 前轴切换)

SMPL 在 `smpl_core` 里是 **Y-up**;LiDAR 数据是 Z-up/X-front。需要一个可配置的「数据系→
three.js 显示系」映射,且做完善但易用:

- **上轴选择**:`Z-up` 或 `Y-up`。
- **前轴选择**(随上轴联动):
  - Z-up:`X-front` 或 `Y-front`
  - Y-up:`X-front` 或 `Z-front`
- `axis_frame.js` 据「上轴+前轴」给出一个 3×3 旋转(基变换),把点云坐标变换到 three.js
  的标准显示系(Y-up、相机看 -Z)。SMPL mesh 在 three.js 标准 Y-up 系里正常前向解算,
  与变换后的点云同处一个显示系。
- 默认值:`Z-up / X-front`(样例数据实测朝向)。切换即时重渲染当前帧点云,SMPL 标注
  (root_pos/root_rota 存的是**显示系**下的值)不被破坏 —— 即映射只作用于点云的显示
  变换,SMPL 始终活在 three.js 显示系里。
- 纯函数,可单测(给定轴配置 → 期望基向量)。

## 6. SMPL 标注与编辑

### 6.1 复用 label 的编辑链路(经 `smpl_edit/`)
- **Root 平移 + 旋转**:`RootHandle`(TransformControls translate/rotate)。
- **逐关节姿势**:`PoseGizmo` + 关节球点击(`JointPicker`)+ 解剖学按钮网格。
- **IK 拖拽**:`ik_plugin` 一行安装(末端拖拽两段 IK)。
- **体型 betas**:面板滑杆,写 `annotation.betas`,`forwardSmpl` 重算。

`ui_controller.js` 的 `MODES` 在 pcd 场景收窄为 `['pose','root','beta']`(无 `bbox`)。
若直接复用 label 的 ui_controller,则 pcd 端 UI 不暴露 bbox tab 即可(`MODES` 保留 bbox
不影响,只是不渲染入口);为避免歧义,公共 ui_controller 接受可选 `modes` 参数,
pcd 传 `['pose','root','beta']`。

### 6.2 标注产物(沿用 COCO 结构)
- 复用 `coco_document.js` / `annotation_store.js`。单人(一序列一个标注文档,player_0)。
- 每帧 annotation 写 `root_pos`(显示系米)、`root_rota`(轴角)、`body_pose`(21×3 轴角)、
  `betas`。保留 coco 文档其余字段以无损 round-trip。
- 点云无 2D 关键点/无遮挡/无 bbox,这些字段保持 default(或不写),保存时**不**做关键点
  重投影、**不**算 occlusion(去掉 label 的 `derived`/`occlusion` 调用)。
- `images[]` 与帧序对齐:用 manifest 的 `frame_count` 合成 `images[]`(id = 帧序),
  与 `frame_%06d.png` 一一对应。
- 保存:File System Access 原地写 json 到序列目录(同 label dirSource);不支持时下载
  `player_0.json`。

### 6.3 空帧 / 新建 / 删除
沿用 label 语义:本帧有标注 → 「删除本帧标注」;无标注 → 「新建:T-pose」/「复制上一帧」。

## 7. UI 布局

沿用 label M3 的三栏:
- 左:只读面板(帧号 / 当前模式 / 关节角 / 状态)。
- 中:3D 视口(点云 + SMPL),自由 orbit。
- 右:编辑面板,顶部 Tabs `[Pose / Root / Beta]`(无 Bbox),互斥;关节按钮网格;
  状态驱动的新建/删除按钮;配色控件(模式 + 抽稀 + 点大小);坐标轴控件(上轴/前轴)。
- 顶部工具条:打开目录、播放/暂停/逐帧/滑杆、显示开关(点云/mesh/joints/bones/grid/axes)、
  撤销、保存、IK 开关。

## 8. 加载交互

- 与 label 一致:点「打开」→ 浏览器目录选择器,选中一个序列目录(含 manifest.json +
  frame_*.png)。一次一个序列。
- 扫描目录:读 manifest → 帧数/帧名模式;若目录已有标注 json 则一并读入(可续标)。

## 9. 测试与验证

- 纯逻辑单测(Node `--test`):point_cloud 解码数值、axis_frame 映射、pcd_dir_source
  manifest 解析;迁移后的 smpl_edit 公共测试。
- three.js / WebGL 部分浏览器人工验证。
- **回归**:label 重构后跑全套 label 测试 + 浏览器走查,确保零回归(这是 B 重构的硬门槛)。
- 部署:静态资源,沿用现有 `serve:label` 同款 static_server;GitHub Pages 直接托管。

## 10. 明确不做(YAGNI)

- 不做 2D 视图 / 内参 / 投影 / bbox / 关键点重投影 / occlusion。
- 不做多人(单人 player_0)。
- 不做点云本身的编辑/分割(只读渲染)。
- 解码暂不进 Worker(单帧可接受,延后按需优化)。
- intensity 配色不做(数据无此字段)。

## 11. 风险

- **B 重构回归**:label 正在 M3 收尾,移动其编辑内核有回归风险 → 以「import 路径替换 +
  全套测试 + 浏览器走查」控制,模块本身原样搬不改逻辑。
- **解码性能**:62 万点/帧 × 播放,主线程解码可能掉帧 → 抽稀滑杆兜底,必要时挪 Worker。
- **轴朝向**:样例为 Z-up/X-front 推断,真实数据可能不同 → 上轴/前轴切换覆盖常见组合。
