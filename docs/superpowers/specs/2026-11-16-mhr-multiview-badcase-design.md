# MHR(sam-3d-body) + 双视角对齐标注 —— 设计 v2

分支：`feat/mhr-multiview`。目标流程：sam-3d-body 结果的 bad case 修复。

## 已定的决策(2026-11-16 用户确认)

- **全 Web 运行时**：与 SMPL 一致，MHR 前向在浏览器 JS 里算，部署 Pages / 静态服务器给多用户用。Python 只做离线资产导出与对照测试。
- **不做 MHR↔SMPL 转换**(至少不在页面里)。
- **人体模型适配层**：统一 BodyModel 接口，SMPL 先包进去。
- **修正范围**：体型、身体姿态、整体位姿常开；手默认关闭(可开)；表情不开放。
- **数据格式**：贴近现有 SMPL 规范(COCO 风格 `player_N.json`)。

## MHR 模型：已拿到并验证

- 来源：GitHub release `facebookresearch/MHR` v1.0.1 `assets.zip`(199MB 压缩，Apache 2.0)。本地放在仓库外：`../mhr_assets/v1.0.1/assets/`，离线 Python 环境 `../mhr_assets/.venv`(py3.12 + torch + `mhr`)。
- 用 TorchScript `mhr_model.pt`(LOD1，自包含)，不依赖 pymomentum。
- 实测结构(LOD1)：18439 顶点、36874 面、127 关节；`model_params` 204 维 = root 平移 3 + root 旋转 3 + 姿态 130 + 缩放 68；`identity` 45；表情 72。单位厘米，Y 上，静止姿态 root(骨盆)在 (0, 92.4, 0)。
- 前向流程：`joint_params = PT(889×249,368 个非零) · [model_params, 0₄₅]` → 每关节 `t = jp.t + offset`、`q = prerot · eulerXYZ(jp.r)`、`s = 2^jp.s` → 沿父链复合相似变换 → 静止网格 = base + identity·blend(+ 表情) + 姿态修正 → LBS(51337 个权重项，含缩放)。
- 姿态修正：特征 = 125 个关节的 eulerXYZ → 旋转矩阵前两列(对角减 1)，750 维 → 稀疏层(53136 非零) → ReLU(3000) → 线性层(3000 → V×3)。幅度可达 12cm。
- **但交付数据的生产几何没开姿态修正**(数据包 `MHR_PARAMETER_LAYOUT.json`：`correctives: Disabled for parity`)。实测：官方 MHR v1.0.1 TorchScript 在关闭修正、表情为零时，回放 `mhr_model_params + shape + pred_cam_t_m`，与包内 `vertices_camera_m` 的差 ≤ 0.0002cm(orb1、zcam2 各抽 3 帧)；开启修正则差 4cm。所以 **Web 端不做姿态修正**，与数据管线一致。
- `tools/mhr/mhr_reference.py`：独立 numpy 复刻，与 TorchScript 对比顶点误差 0.00006cm。JS 移植以它为逐行对照。

### Web 资产预算(沿用 `.meta.json + .bin` 格式，现有 `smpl_model.js` 加载器直接用)

| 数组 | 大小 |
|---|---|
| base_shape + faces + skeleton + PT(稀疏) | ~0.7MB |
| identity 45 个 blendshape | 10MB |
| 蒙皮 51337 项 | 0.6MB |
| 姿态修正、表情 | **不打包**(数据管线都没用) |

合计约 11MB，比 SMPL 的 19MB 还小。必须作为普通文件提交(不能走 LFS)，附带 MHR 的 LICENSE。逐帧计算是 127 关节 FK + 5 万项蒙皮，拖拽时实时可行。

## 数据格式：MHR 版 `player_N.json`

原则：文档结构、帧身份(图像在列表中的位置)、`bbox`、`root_pos/root_rota` 语义与 SMPL 版一致；人体参数用**新键名**，不复用 `body_pose/betas`。这样旧的 SMPL 查看器读到 MHR 文件时，只会判定为「无 SMPL」，不会把 130 维当 63 维去算。

```jsonc
{
  "info": { "body_model": "mhr", "body_model_version": "mhr-1.0.1-lod1" },
  "images": [ /* 同现有：id, file_name, cam_K, width, height ...(双视角见下节) */ ],
  "annotations": [{
    "id": 0, "image_id": 0, "bbox": [x, y, w, h],          // 同 SMPL
    "root_pos":  [3],    // 米。MHR root 关节(骨盆)的位置，同 SMPL 语义
    "root_rota": [3],    // 轴角。整体朝向，绕骨盆旋转静止姿态，同 SMPL 语义
    "mhr_pose":  [130],  // model_params[6:136]：身体 + 手关节角(弧度) + 6 个柔性长度
    "mhr_scale": [68],   // model_params[136:204]：骨长缩放
    "mhr_shape": [45],   // identity：20 身体 + 20 头 + 5 手
    "mhr_expr":  [72]    // 可选。原样保留，不编辑、不渲染
  }]
}
```

- 有无 MHR 的判断键：`mhr_pose`(对应 SMPL 的 `body_pose`)。
- **世界系 = orb1 原生相机系，换成我们的 GL 约定**(`F = diag(1,−1,−1)` 作用于数据包的公共系 `orb1_color_xyz_m`)。单视角 SMPL 文件里「相机在原点」的约定因此不变，orb1 就是那台相机。
- 竖屏转正(orb1 顺时针 90°、zcam2 逆时针 90°)只作视图旋转，不写进数据。这符合 CLAUDE.md「N×90° 只能是视图」的规则。
- 由数据包某一视角 c 的一行导入(行向量公式按列向量重写)：
  - `M_c = F·R_native_from_commonᵀ·R_native_from_upright`
  - `m_c = −F·R_native_from_commonᵀ·t_native_from_common`
  - `A = M_c·F`
  - `root_rota = axisAngle(A · Rz·Ry·Rx(mp[3:6]))`
  - `root_pos = A·(0, 0.924, 0) + M_c·pred_cam_t_m + m_c`
  - `mhr_pose = mp[6:136]`，`mhr_scale = mp[136:204]`，`mhr_shape = shape`
- 反向：`mp[3:6] = eulerXYZ(rotmat(root_rota))`；`mp[0:3] = 0`；世界顶点 = MHR(mp, shape)/100 − (0, 0.924, 0) + `root_pos`。
- **实测**：两路相机各抽 4 帧，按上述公式导入再回放，与「包内顶点经外参转到世界系」的差 ≤ 0.0015cm(float32 精度)。
- 数据包说 `[3:6]` 的「存储次序为 rz,ry,rx」，那只是网络输出的标签。rig 实际按 PT 把 `mp[3], mp[4], mp[5]` 当作 root 的 rx, ry, rz，旋转为 Rz·Ry·Rx。已实测 root 全局四元数 = eulerXYZ(mp[3:6])，以 PT 为准。
- 手已经解码进 204 维，直接取，不做 hand/scale PCA。数据包明确禁止用旧的 raw 字段覆盖。
- 转换器写成**纯 JS 模块**(node 单元测试)。npz 在浏览器里不好读，所以先由离线 Python 把数据包的参数数组(不含顶点)导成 JSON，网页导入 JSON。

## 编辑映射

- **整体位姿**：沿用 `root_handle`(`root_pos/root_rota`)，不改。
- **身体姿态**：每个 MHR 关节的局部旋转 = prerotation · eulerXYZ(PT 行 · params)。实测每个可编辑关节都有系数为 1 的直驱参数：
  - 肩、髋、锁骨、颈、头：3 自由度
  - 腕：2 自由度(ry, rz)；前臂扭转单独由 `lowarm_twist` 控制
  - 肘、膝：1 自由度(只有 bend)
  - 脊柱 4 节：各有 3 个 `_flexible` 直驱参数，另有跨节耦合的 twist/lean/bend
- 手柄拖出目标局部四元数后，对该关节的直驱参数(1–3 个)做小规模最小二乘(高斯-牛顿)，其余参数不动。肘、膝这类 1 自由度关节，拖拽会自动投影到弯曲轴上。twist 辅助关节由 PT 自动跟随。这是纯函数，可以单元测试。
- 关节按钮网格换成 MHR 的约 23 个身体控制关节；手的约 40 个关节在手开关打开后才出现。
- **体型**：`mhr_shape` 滑条(身体 20 常显，头 20 折叠，手 5 跟随手开关)；`mhr_scale` 按语义分组(脊柱、臂长、腿长等)折叠显示。双视角能约束骨长，所以缩放值得开放。
- **表情**：不出现在 UI 上，`mhr_expr` 原样回写。

## 双视角

- 人体存在**世界系**(见上：orb1 原生相机系，GL 约定)。单视角文件不变：没有 `cameras` 时，世界系 = 相机系，行为与现在一致。
- 文档加 `cameras`，`images[]` 加 `views`。一个 image = 主相机 orb1 的一帧(30fps，1050 帧)，帧身份仍然是位置。

```jsonc
"cameras": [
  { "id": "orb1",  "cam_K": {...}, "width": 1280, "height": 720, "R": [9], "t": [3],
    "view_rotation_deg": 90,  "video": "20261102-173745_orb1.mp4",  "fps": 30 },
  { "id": "zcam2", ..., "view_rotation_deg": -90, "video": "20261102-173745_zcam2.mp4", "fps": 60 }
],  // R,t：OpenCV native←common(= 数据包原样)，单位米；cam_K = K_native
"images": [{ "id": 0, "views": { "orb1": 0, "zcam2": null } }],   // 值 = 该相机视频的 decode index
"annotations": [{ ..., "bboxes": { "orb1": [4], "zcam2": [4] },
                  "source": { "camera": "orb1", "decode_index": 0, "effective_state": "raw_unoptimized" } }]
```

- 渲染视角 i：`x_gl = F·(R_i·F·X_world + t_i)`。F 是绕 X 轴 180° 的旋转(行列式为 +1)，不会出现镜像问题。

### 转正 = 数据里的显示配置(2026-11-16 用户确认)

- 原始视频都是横着录的(orb1 需顺时针 90°，zcam2 需逆时针 90°)。`cameras[].view_rotation_deg` 是**下发数据时写定的显示配置**：转换器从数据包的 `fixed_clockwise_rotation_deg` 写入，标注员页面上没有旋转按钮，打开即是转正画面。
- 存储仍是原生(未旋转)：视频不重编码，`cam_K/width/height/R/t` 是原生参数，`bboxes` 存原生像素。CLAUDE.md「数据旋转禁止」的规则不受影响，旧的竖拍只读拦截(`isPortrait`)对带 `cameras` 的文档不适用。
- 实现：`smpl_edit/camera_rig.js` 把旋转折进视图相机(`K_view = P·K·R_rotᵀ`，`R_view = R_rot·R`)。下游渲染、投影、bbox 派生只看视图相机，和普通单相机完全一样；只有背景视频纹理按同一角度旋转显示，bbox 在存取时做原生↔视图像素换算。
- 已验证：视图内参与数据包 `upright.K` 一致；「投影到视图」= 「原生投影再旋转像素」，误差 < 1e-6px；四种角度下 bbox 往返无损。
- 新增 `CameraRig`(`smpl_edit/`，纯逻辑)：世界↔各相机变换、投影、bbox 派生。`label/src/scene/projection.js` 退化为它的单相机特例。
- **视频**：两路都是 H.264、恒定帧率、无 B 帧，PTS 步长固定(orb1 每帧 512、zcam2 每帧 256，time_base 1/15360)。所以 `decode_index / fps` 就能精确 seek，现有 `VideoSource` 可直接用。
- **配对**：用数据包的 `pairs_orb1_zcam2.csv`，不自己按帧率重算。1045 帧有配对(时差恒为 −1.2ms)，其中 1030 帧两路都有人体。orb1 前 5 帧在侧机覆盖范围外，末尾 15 帧(1035–1049)人物缺席。zcam2 是 60fps，只用配对到的那一半帧。
- **初始化**：默认用 orb1 的预测(它就在公共系里)，按帧可以切换成「采用 zcam2 结果」。实测两路预测转到世界系后：
  - 多数帧根节点相距 0.1–0.2m，投影后中位差 10–30px
  - 第 605 帧相距 1.19m，在 zcam2 视角里差 206px。这正是要修的 bad case
- UI：主区两个并排图像视口，共享一个人体、一个 store。在任一视口拖手柄，另一视口实时刷新。多视口沿用 `pcd_label` 的 `viewport_manager`。

## 里程碑

- **M1** BodyModel 接口 + SMPL 实现(纯重构，`npm run test:web` 全绿)。
- **M2** MHR Web 资产导出器(`tools/mhr/`) + JS 前向(无姿态修正)；用数据包的真实帧做 node 测试的固定样例。
- **M3** 数据包 → JSON 的离线导出 + JS 导入器 + CameraRig + 双视角只读叠加。
- **M4** MHR 编辑(关节参数求解、体型面板、手开关) + 双视角编辑 + 保存。

M1 与 M3 互不依赖，可以并行。

### 进度(2026-11-16)

已完成(纯逻辑 + 测试，未接 UI)：
- `smpl_core/mhr.js`：JS MHR 前向。对官方 TorchScript 误差 ≤ 6e-4cm，换姿态一次约 0.35ms(体型缓存时)。
- `smpl_core/body_model.js`：BodyModel 接口，`createSmplBody`(包住 `forwardSmpl`，结果逐位相同) / `createMhrBody`；`BODY_SCHEMAS` 供文档层使用。
- `CocoDocument` / `AnnotationStore` 按 `info.body_model` 切换字段契约。旧 SMPL 文件(无 `info.body_model`)行为不变；未知模型直接报错。
- `smpl_edit/camera_rig.js`：多相机 + 转正配置。
- `tools/mhr/`：Web 资产导出、测试样例生成、numpy 参考前向、数据包转换器(`convert_sam3d_bundle.py`)。
- 端到端：数据包 → 转换器 → JS 前向 → 世界系，与包内几何差 ≤ 0.0015cm，两个视角重投影差 ≤ 0.003px。

下一步：label 接入 BodyModel(场景骨骼表、关节按钮网格、derived/occlusion 的 24 关节写死处)，再做双视口。

### label 接入(2026-11-16)

- 写死的骨架改为 BodyModel 配置：`displayJoints`、`bones`、`poseJoints/poseLabels`(关节按钮)、`angleReadouts`、`keypointJoints/keypointSlots`、`ikSkeleton`、`canEditPose`、`shapeEditor`、`cloudInference`。`scene.js`、`panels.js`、`derived.js`、`occlusion_raycast.js`、IK 插件、`app.js` 都不再出现 21/24/52 或 SMPL 关节索引。
- 人体模型按 `info.body_model` 自动选择并按需加载资产；转正、内参、外参位姿、视频文件、帧率、帧→解码序号都来自 `cameras[]` / `images[].views`(`label/src/io/view_config.js`)。
- 派生 keypoints/遮挡改为以数据相机为准(单视角 = 原点 + 当前 K；多相机 = cameras[0] 原生像素)。以前遮挡用的是保存那一刻的视图相机，在 3D 视角下保存会算错。
- MHR 当前可用：整体位姿(移动/旋转/深度)、显示、播放、保存。暂时禁用(配置项)：姿态 tab(关节参数求解未做)、体型 tab(MHR 体型面板未做)、云端(只出 SMPL)；多相机数据暂禁用框 tab(逐视角 `bboxes` 的原生↔视图换算未接入框编辑层)。
- 浏览器实测(Chrome headless，OPFS 模拟「打开目录」)：MHR 数据第 606 帧转正画面与人体叠加正确；SMPL 旧数据 21 个关节按钮、姿态手柄、关节角读数正常。

数据集目录布局(与 SMPL diving 布局一致，`convert_sam3d_bundle.py --dataset` 产出)：

```
RING/label_mhr/20261102-173745/
  20261102-173745_orb1.mp4    20261102-173745_zcam2.mp4    (硬链接原视频)
  json_results/player_0/player_0.json                      (主标注)
  json_results/sam3d_zcam2_pred.json                       (侧机预测,不会被当成人物)
```

### 编辑与双视角(2026-11-16，M4 完成)

- **MHR 拖关节**：`smpl_edit/mhr_pose_state.js`(与 `RotationState` 同接口，`smpl_edit/pose_state.js` 按模型创建)。手柄给出目标局部四元数，只在该关节的直驱参数上做高斯-牛顿：3 自由度关节精确命中，肘/膝只动 `*_bend`。不可编辑的欧拉轴在面板上只读。姿态 tab 26 个关节(含前臂扭转、踝、脚趾)。
- **体型 tab**：按 `body.shapeGroups` 生成。MHR：身体体型 20、骨长缩放 13 常显；头部体型、柔性长度折叠；表情、眼部缩放不出现。
- **手部开关**(姿态 tab 顶部，仅 MHR)：默认关；打开后多 32 个手指关节和手部体型/缩放两组。只改显示与可编辑范围，不改数据。
- **双视角**：主区右侧副视角(`label/src/scene/side_view.js`，只读，可缩放平移、双击复位)，主视角拖拽时实时跟随；「⇄ 主/副视角互换」把手柄换到另一台相机。副视角标签显示「标定未验收」。
- **逐帧采用侧机预测**：本帧状态栏「⇄ 采用 zcam2 预测」，一个 undo 单元；`source` 记为 `{camera:'zcam2', …, adopted:true}`。状态栏显示每帧来源与 `effective_state`。
- **逐视角派生量**：见下节「派生量 = 帧定稿时单帧计算」。
- 浏览器实测第 606 帧：orb1 预测在 zcam2 画面偏到运动员左侧；采用 zcam2 预测后 zcam2 贴合、orb1 偏移，正是要人工修的 bad case。保存后 `bboxes` 与离线 Python 投影一致。

### 派生量 = 帧定稿时单帧计算(2026-11-16 用户决定)

派生量(2D 关键点、遮挡、多相机逐视角框)是给 sam-3d-body 训练用的标签，两个视角各算一份。

- **时机**：`AnnotationStore.onCommitted` —— 每个 undo 单元结束(拖拽/面板松手、新建、复制、采用侧机预测、撤销)时，只算该帧，结果写回文档缓存(`setDerived`，不进 undo、不算改动)。保存只序列化：实测 0.09s(以前保存时逐帧重算，MHR 47s → 去掉遮挡后仍 6s)。
- **计算**：`label/src/edit/frame_derive.js#deriveFrame`(纯函数，无 three)。遮挡改为纯 JS 射线-三角形、命中即停(`derived.js#occlusionFromMesh`，与原 three Raycaster 正面判定一致)。MHR 一帧两视角约 26ms。
- **格式**：多相机 `per_view: { [cameraId]: { bbox, keypoints, occlution_joint } }`(原生像素)；顶层 `bbox/keypoints/occlution_joint` = `cameras[0]`，与单视角格式兼容。某相机本帧无画面则无该项。单视角 SMPL 仍只写顶层 `keypoints/occlution_joint`，bbox 是人画的。
- **MHR 关键点槽位**固定为含手指的 65 个关节，不随「手部」显示开关变化。
- **批量**：页面不做整段补算；`node tools/mhr/derive_dataset.mjs <player_0.json>` 离线跑同一份代码(1035 帧约 29s)。
- 行为变化(SMPL 也一样)：未编辑过的帧保存时不再补算派生量；改相机内参不会回溯更新已定稿帧。

## 数据包已回答的问题(`sam3d-body-173745`，`calibration/EXTRINSICS_zh.md`)

1. 外参：`p_native = R_native_from_common · p_common + t`，OpenCV，米，矩阵行优先存储。公共系是 orb1 原生光学系(Y 下)，**不是重力对齐的世界**，3D 视图的「上方向」要另选(同 `pcd_label` 的仅相机上轴)。
2. 结果格式：每个相机一个 npz，权威输入是 `mhr_model_params[204] + shape[45] + pred_cam_t_m[3]`，几何在各自的转正相机系里。两路是**独立预测、未融合**。
3. 同步：两路时钟有固定偏移(侧机 −0.1488s)，已经给出配对表。物理曝光同步未认证。

## 风险与注意

- 侧机内外参是「诊断候选」(`camera_calibration_accepted=false`)，畸变假定为零。如果双视角怎么调都对不齐，先怀疑标定，不是人体。UI 上要能看出这一点(例如显示两视角的重投影差)。
- 3150 帧里只有 52 帧经过联合优化，`effective_state` 要显示出来，方便定位哪些帧是原始预测。
- 70 关键点的映射(`keypoint_mapping.bin`)不在 MHR 公开资产里。第一期派生 keypoints 用 127 骨架；需要 70 点时，可以从包内的 `keypoints_camera_m` 反解稀疏映射。
- 原始 PNG 在 E: 盘，不在本机；直接用 mp4。`orb1.avi`(ffv1)与 mp4 帧数相同，浏览器不支持 ffv1，忽略。


## 页面拆分(2026-11-16 用户反馈)

- 多视角修复独立成新页面 **`/mhr_label/`**(主页卡片「🎥 多视角 MHR 修复」)。`/label/` 回到单视角 SMPL 标注器原样,打开多视角数据时提示改用 `/mhr_label/`。两页共用 `smpl_core` / `smpl_edit` / `label/src/scene|ui|io|edit` 的纯逻辑与场景组件。
- 入口只有一个:「📂 打开多视角数据集」= 选数据集根目录。读 `json_results/player_0/player_0.json`,它的 `cameras[]` 决定视角、每个视角的视频文件、转正角度;`images[].views` 决定帧对应。页面不选视频、不选图像。缺文件/单视角数据给出明确报错(`mhr_label/src/dataset.js`)。
- 界面:两个视角按 `cameras[]` 顺序固定左右,蓝框 = 编辑视角,另一个视角右上角「✎ 在 X 编辑」切换(位置不变)。每个视角标签显示相机名、转正角度、「标定未验收」。去掉了单视角才有的东西:内参编辑、框 tab、云端、多人物、IK。
- 视角选择由转换器 `--cameras zcam1,zcam2` 决定(顺序 = 左右,第一个 = 帧时间轴)。交付包没有的相机用 `--calibration` 补标定(模板 `tools/mhr/extra_calibration.example.json`);配对按 clock_map 求最近曝光(半帧内),对 orb1/zcam2 与交付包 `pairs_orb1_zcam2.csv` 逐帧一致。

**zcam1 现状**:交付包 `sam3d-body-173745` 只有 orb1、zcam2 的标定和结果,zcam1 只有原视频(1920×1080、60fps、2100 帧,与 zcam2 同起点 PTS)。zcam1 ↔ 公共系的内外参、时钟偏移、zcam1 的 sam-3d-body 结果都没有,需要用户提供后才能生成 zcam1/zcam2 数据集。

### 页面按模型划分(2026-11-16 用户决定)

- 将来 SMPL 也可能多视角、MHR 也可能单视角,所以**页面差分是人体模型,不是视角数**:`/label/` = SMPL 标注器,`/mhr_label/` = MHR 标注器(原 `mv_label` 改名)。
- `/mhr_label/` 支持 1..N 个相机:编辑视角 1 个,其余视角各一块只读画面;单视角数据就只有编辑视角。校验按 `info.body_model === 'mhr'`(`mhr_label/src/dataset.js#checkMhrDoc`)。
- `/label/` 打开 MHR 数据时引导到 `/mhr_label/`;SMPL 多视角(cameras ≥ 2)暂提示不支持,将来在 `/label/` 内实现。
- 已验证:`convert_sam3d_bundle.py --cameras zcam2` 生成的单视角 MHR 数据集(2100 帧)通过校验,视图配置正确。

### 分屏与设备配对(2026-11-17 用户反馈)

- **设备配对**:多视角应同一设备族(orb 配 orb、zcam 配 zcam)。交付包只标定了 orb1 与 zcam2(上游 `pairs_orb1_zcam2.csv`、`original-side-alignment-v2.json` 就是这一对),所以之前生成了混配数据。转换器现在 `--cameras` 必填,混用设备族默认报错(`--allow-mixed-devices` 才放行)。`RING/label_mhr/20261102-173745` 是旧的 orb1+zcam2 混配测试集;`RING/label_mhr/20261102-173745_zcam2` 为 zcam2 单视角集。zcam1/zcam2 集仍等 zcam1 标定。
- **副视角白屏**:旧副视角在该相机本帧无画面时(如 zcam2 的前 5 帧)清掉贴图但保留背景平面 → 纯白。现在无画面时隐藏平面并在视图标签写「本帧无画面」;`LabelScene` 同步修正(无底图不显示平面)。
- **分屏**:`mhr_label/src/view_hub.js` 一块 canvas、一个 renderer、共享场景分区渲染(`layout.js` 纯逻辑 + 测试)。
  - A(默认):左 3D 自由视角(含各相机视锥与近处小底图),右侧各相机对齐视频
  - B:各相机对齐视频平铺(纯二维)
  - C:聚焦一个相机;视图左上角切换相机,A/B 下每个对齐视图有「⛶」直接进 C
  - 点一下视图 = 设为当前(蓝框);手柄、关节拾取只在当前视图。对齐视图滚轮缩放 / 拖动平移 / 双击复位 / Alt+滚轮沿该相机视线调远近;F 居中 3D 视角。

### zcam1 候选标定(2026-11-17)

交付包没有 zcam1 标定。`tools/mhr/estimate_camera_from_body.py` 用 YOLO-pose 在 orb1+zcam2 上检测运动员 2D 关键点、按交付包候选标定三角化,再对 zcam1 做 PnP(RANSAC + 帧级剔除)。结果 `RING/zcam1_calibration_candidate.json`:204/386 帧可用,中位重投影 6.9px、p90 14.3px。焦距不可观测(1000–1300 误差几乎相同),给定 fx=1100;畸变假定零;时钟沿用 zcam2(同起点 PTS)。属诊断候选,`camera_calibration_accepted=false`。
数据集 `RING/label_mhr/20261102-173745_zcam12`(zcam1+zcam2,2100 帧,每帧用 zcam2 预测初始化)。拿到正式 zcam1 标定后重新跑 `convert_sam3d_bundle.py --calibration` 即可替换。

### 机位与修复(2026-11-17)

- **机位事实**:20261102 目录里每段只有 orb1(正面 Orbbec)、zcam1、zcam2,没有 orb2。估出的 zcam1 光心在 orb1 系 (0.10, −0.05, 0.02)m,即 **zcam1 与 orb1 同一正面机位**,zcam2 是侧面。交付包的 orb1+zcam2 = 正面 + 侧面。
- **正面不贴合的原因**:zcam12 数据集每帧用 zcam2(侧面)预测初始化,侧面单目预测在正面视角里偏差大(中位 64px);orb1 预测在 zcam1 画面里中位 20px。转换器加 `--init`(初始化预测源,可不在 `--cameras` 里),zcam12 现按 `--init orb1,zcam2` 重新生成(orb1 缺的 39 帧回退 zcam2),并写出 `sam3d_orb1_pred.json` 供逐帧采用。旧 json 备份在 /tmp。
- **3D 视角**:`info.scene = { up, ground_height_m }` 由转换器从人体估计(头−骨盆主轴 ≈ 竖直,与相机转正后的「上」夹角 2°;地面 = 最低关节 0.5 分位)。3D 视角以人体 + 其正下方地面网格取景,斜 50° 俯视;F 重新取景。
- **遮挡顺序**:3D 视角里各相机的小底图写深度,近处遮挡远处。
- **播放延迟**:旧实现每帧对每路视频 seek,1080p H.264 seek 跟不上。现在播放 = 视频原生播放,人体帧号取主相机视频的 currentTime;其他视频漂移 > 2 帧才纠正。暂停/拖动时每台相机只保留最新一次 seek,不排队。

### 两视角刚体融合(2026-11-17,用户:侧面对齐变差)

只用 orb1(正面)预测初始化后,正面贴合但侧面变差:zcam2 里骨盆投影与侧面预测相差中位 39px、p90 157px。转换器现默认对初始化人体做**整体刚体融合**(`fuse_rigid`:绕骨盆转 + 平移,姿态/体型不动,Huber 高斯-牛顿,转角 ≤30°、平移 ≤1m 否则放弃),每个视角的 2D 依据 = 光心离它最近的那台相机的预测在该视角的投影(zcam1 ← orb1,zcam2 ← zcam2)。zcam12 重新生成:1994/2100 帧融合,zcam1 中位 6px / p90 14px,zcam2 中位 13px / p90 30px。`source.fused_to` 记录各视角残差,页面状态栏显示。`--no-fuse` 关闭。前一版 json 备份在 /tmp/mhr_probe/zcam12_json_v2。

### zcam1 焦距改为实测(2026-11-17)

zcam1 与 orb1 同机位,两图背景近似纯旋转:SIFT 匹配求单应 H,取使 K1⁻¹·H·K0 最接近旋转阵的 f1。4 个时刻分别得 1134/1140/1136/1137(单应重投影 1.5px,两机相对转 3.4°),f1 = 1136(此前给定 1100)。`estimate_camera_from_body.py --colocated orb1` 自动完成。zcam12 用新标定重建:相对独立 YOLO 检测,融合版 zcam1 中位 22px、zcam2 22px。手指关节显示尺寸 `jointScale` = 0.35(关节球与选中手柄)。

### 关节选择面板与撤销(2026-11-17)

- `smpl_edit/joint_figure.js`:人形面板(SVG,同 kpt_label 人体图,面向屏幕)+ 分组按钮(躯干/左臂/右臂/左腿/右腿/左手/右手)。布局由人体模型静止姿态算出;MHR 手部开启后多「左手」「右手」面板(腕→中指为上,拇指朝外侧);与其他关节重合的点(wrist_twist)挪开。SMPL(/label/)与 MHR(/mhr_label/)共用。点人形里的根关节 = 整体模式。
- `jointScale`:手指与 `*_twist` 关节 0.35。
- mhr_label 撤销:Ctrl/⌘+Z 在焦点位于滑块/按钮时也生效(此前被输入焦点挡掉),仅在文本/数字框里打字时留给输入框;撤销/保存按钮移到左栏顶部;无可撤销时提示。

### 足部关节、人形去拥挤、快捷键统一(2026-11-17)

- MHR 只显示可调节关节(有直驱参数)与根关节;`pinky0` 等不可调节的不再画。`l/r_subtalar`(足内外翻,rx/rz)、`l/r_transversetarsal`(足中部,rx)加入姿态关节(左/右腿组各 7 个)。训练标签关节集仍为 65 个,不随显示变化。
- 人形图:身体按正面略俯视投影,短骨链(脚、手指)按父→子方向推开到最小间距,测试保证任意两点不重叠。
- 快捷键统一为 `smpl_edit/shortcuts.js` 一张表,label / pcd_label / mhr_label 共用,提示面板由表生成:Ctrl/⌘+Z 撤销 · 空格 播放 · ← → 上/下一帧(新增)· [ ] 上/下一有标注帧 · F 居中当前人物(3D,保持朝向,同 SMPL)· R 重置当前视图。焦点在滑块/按钮上快捷键照常生效,只在文本/数字框里打字时让给输入框。mhr_label 的 F 改为 SMPL 语义(不再改视角方向);原先的「人体 + 地面」默认取景改由 R 完成。label 的 R = 复位 2D 缩放/平移。

### 关节限位、足部、IK 现状(2026-11-17)

- MHR rig 带参数限位(TorchScript `parameter_limits`,198 项,已导出到 web 资产 `limit_param/min/max`)。真正区间(min<max)如膝 0…160°、肘 −29…115°、踝屈伸 ±57°、脚趾 −40…17°;另有 30 个 min==max 的「锁住」项,全是 `*_flexible` 柔性/修正自由度,sam-3d-body 输出 100% 帧都在用,不当硬限位。
- 编辑器:`MhrPoseState` 默认遵守区间限位(高斯-牛顿每步投影回范围;已越界的数据不拉回,只禁止更越界),姿态 tab「遵守关节限位」可关;面板显示该关节可动轴与范围。
- 足部:foot 与 talocrural 同位置(踝),轴不同 —— foot = 小腿扭转(rx)+ 足 ry(柔性);talocrural = 踝屈伸(rz)+ rx(柔性);subtalar = 足内外翻;transversetarsal = 足中部;ball = 脚趾。姿态按钮改中文名、由近及远排序;人形新增左脚/右脚侧视面板,身体图只画到踝。
- IK:只有 /label/(SMPL)有 IK 插件;/mhr_label/ 尚未接 IK,限位因此也只作用于关节旋转手柄与欧拉面板。

### 受限轴锁定与 MHR IK(2026-11-17)

- 关节旋转手柄:只出 rig 允许的旋转环(`TransformHandle.setAxes`),受限关节(可动轴 < 3,如肘、膝、腕、踝)强制自身轴(`setSpaceOverride('local')`),姿态 tab 的「世界轴」按钮禁用。3 自由度关节(肩、髋、颈…)恢复世界/自身两种参考系与全部环。
- IK:mhr_label 装上同一个 `installIK` 插件(多视图:相机/NDC/手柄可见性随当前视图)。链 = 肩-肘-腕、髋-膝-踝(`ik_chains.js#resolveChains`)。中间关节是真铰链(`chain.flex`:弯曲轴 + 屈曲方向来自 rig 限位),IK 用它当铰链轴,上段旋转同时把铰链带到新弯曲平面(SMPL 链不受影响)。结果经 MhrPoseState 投影 + 限位。实测真实帧上拖腕/踝到可达目标:中位 0.1cm、p90 0.2cm。
