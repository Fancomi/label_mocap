# 跨页面契约

本文件记录 `label/`(SMPL)、`pcd_label/`(SMPL 点云)、`mhr_label/`(MHR)共同遵守的约定。改动这些行为时,三个页面一起改,并更新本文件。设计过程与数据核对见 `docs/superpowers/specs/2026-11-16-mhr-multiview-badcase-design.md`。

## 1. 页面划分

- 页面按**人体模型**划分,不按视角数:`/label/` = SMPL,`/mhr_label/` = MHR。两者将来都可能有单视角、多视角。
- 数据里 `info.body_model` 决定模型(缺省 `smpl`)。打开另一模型的数据时给出明确提示并指向正确页面;未知模型直接报错,不当成 SMPL。
- 页面只做逐帧编辑。整段批量计算、格式转换、标定估计都在离线工具里做(`tools/mhr/`),不在页面里做。页面上任何需要数秒的操作都视为设计问题。

## 2. 共享内核与扩展点

- `smpl_core/body_model.js#BodyModel`:页面只认这个接口。关节数、骨骼表、显示关节、姿态按钮、关节角读数、关键点关节与槽位、体型分组、IK 链、关节显示尺寸(`jointScale`)都来自模型配置,页面代码里不写死任何骨架索引或数量。
- 姿态编辑状态:`smpl_edit/pose_state.js#createPoseState`。四元数权威,欧拉角只是视图。SMPL = `RotationState`;MHR = `MhrPoseState`(只解该关节的直驱参数,受限关节自动投影到可动轴,默认遵守 rig 限位)。
- 标注文档:`CocoDocument` 只改动被编辑的字段,其余字段(如 `mhr_expr`、`source`)原样保留。字段契约按模型切换(`BODY_SCHEMAS`)。
- 插件(IK 等)只经扩展点接入:`registerSyncHook`、`registerGuard`、`registerCameraConsumer`、`registerHandleObjects`、`registerHandleScale`、`ndcMapper`、`poseJointOf`。

## 3. 数据格式

- COCO 风格 `json_results/player_N/player_N.json`;帧身份 = `images[]` 中的**位置**,不是 `image_id` 的值。
- 共同语义:`root_pos` = 根关节(骨盆)世界位置(米);`root_rota` = 整体朝向(轴角),绕骨盆旋转。世界系 Y 上、−Z 深度(GL)。
- SMPL:`body_pose[63]`、`betas[10]`,有无人体看 `body_pose` 键。MHR:`mhr_pose[130]`、`mhr_scale[68]`、`mhr_shape[45]`,可选 `mhr_expr[72]`(只保留不编辑),有无人体看 `mhr_pose` 键。
- 标定相机:`cameras[]`,每项 `{ id, width, height, cam_K, R, t, view_rotation_deg, video, fps, calibration_accepted }`。`R,t` 为 OpenCV「原生相机 ← 公共系」,米;`width/height/cam_K` 为原生像素。`images[i].views[cameraId]` = 该相机视频的解码序号,`null` = 该相机本帧无画面。
- `source`:该帧人体来自哪台相机的预测 `{ camera, decode_index, effective_state, adopted?, fused_to? }`。
- 其他视角的独立预测:`json_results/sam3d_<cameraId>_pred.json`,同格式,不会被当成人物加载。

## 4. 显示旋转

- 竖屏/转正只是**显示配置**:`cameras[].view_rotation_deg`(顺时针,90 的倍数),由离线转换写入,标注员页面上不能改。
- 存储永远是原生方向:视频不重编码,内外参、框、关键点都按原生像素。旋转只折进「视图相机」(`smpl_edit/camera_rig.js`)和背景贴图。
- 没有 `cameras[]` 的旧单视角竖拍数据仍按只读处理。

## 5. 派生量(训练标签)

- 关键点、遮挡、逐视角框在**帧定稿时单帧计算**:每个 undo 单元结束(拖拽/面板松手、新建、复制、采用预测、撤销)触发一次,只算该帧,结果写回文档缓存,不进 undo、不算改动。保存只序列化。
- 以数据相机为准(单视角 = 原点 + 当前内参;多相机 = 每台相机原生像素),与用户当时的 3D 环绕视角无关。
- 多相机格式:`per_view: { [cameraId]: { bbox, keypoints, occlution_joint } }`;顶层 `bbox/keypoints/occlution_joint` = `cameras[0]`,与单视角格式兼容。本帧无画面的相机不写。
- 关键点槽位由模型固定(SMPL 52;MHR 65,含手指),不随显示开关变化。
- 整段补算:`node tools/mhr/derive_dataset.mjs <player_0.json>`,与页面同一份代码。

## 6. 交互

**点选**(`JointPicker`,三页一致):
- 点中关节 → 调整该关节(姿势);点中根关节或人体网格 → 调整整体;点人体以外 → 取消调整(`UIController.release()`):不挂任何手柄,视角可自由拖动。再点关节、人体、tab 或「移动/旋转」恢复。
- 按下后移动超过 4px 视为拖拽,不触发选中或取消。手柄悬停/拖拽中不拾取。

**手柄**(都继承 `TransformHandle`):
- 基准尺寸 `HANDLE_SIZE = 0.6`;2D/对齐视图放大时按 1/zoom 补偿;精细关节(MHR 手指、`*_twist`)再乘 `jointScale`(0.35)。
- 世界轴/自身轴由共享 `GizmoSpace` 决定。受限关节(rig 可动轴 < 3,如肘、膝、腕、踝)只显示可动的旋转环,强制自身轴,世界轴按钮禁用。
- 多视图下手柄只在当前视图显示与响应;点到非当前视图只切换当前视图,吞掉这次按下。

**关节选择面板**(`smpl_edit/joint_figure.js`):人形图(面向屏幕,人物左侧在右)+ 按骨骼配色分组的按钮。SMPL 只有身体;MHR 有身体、左脚、右脚,手部开启后再有左手、右手。布局由静止姿态算出并去拥挤。选择变化时自动切到包含该关节的面板;手动切面板后不会被拉回。

**关节限位**(MHR):rig 区间限位(min < max)默认生效,姿态 tab 可关。已越界的数据不会被拉回,只是不能再往外拖。到达限位时旋转手柄与欧拉滑块/输入框都停在边界(「转不下去」),往回拖立即生效;手柄拖拽时状态栏提示已到限位。手柄拖拽按增量求解(每步增量作用到关节实际朝向),超出限位很远也不会在两端之间跳变。rig 锁定为单点的 `*_flexible` 自由度不当硬限位(sam-3d-body 输出在用)。

**IK**:同一个 `installIK` 插件。SMPL 链按索引;MHR 链 = 肩-肘-腕、髋-膝-踝(末端是踝 `talocrural`,不是小腿扭转)。MHR 中间关节用 rig 的真铰链轴;结果经姿态状态投影并遵守限位。拖末端时,未存人控极向量的极向量柄随动。

**快捷键**(`smpl_edit/shortcuts.js`,提示面板由同一张表生成):

| 键 | 作用 |
|---|---|
| Ctrl/⌘+Z | 撤销 |
| 空格 | 播放 / 暂停 |
| ← / → | 上 / 下一帧 |
| [ / ] | 上 / 下一有标注帧 |
| F | 居中选中的关节;没选关节则居中当前人物(3D,保持视角朝向,一次性) |
| R | 重置当前视图(3D 朝向/取景,2D 缩放/平移) |

焦点在滑块/按钮上时快捷键照常生效;只有在文本/数字框里打字时让给输入框。

F 的目标(`smpl_edit/framing.js#focusTarget`):姿势模式下选中了关节 → 该关节(半径 0.25m × 关节尺寸系数,手指更近);否则 → 当前人物的人体包围。多人页面(label、pcd)的「当前人物」= 最后选定的人物;该人物本帧无标注时,pcd 退到点云,label 提示无可居中。

## 7. 播放与多视图

- 多路视频播放时视频原生播放,人体帧号取主相机视频的当前时间;其他视频漂移超过 2 帧才纠正。暂停/拖动时每台相机只追最新一次 seek,不排队。
- 某相机本帧无画面时隐藏其背景平面并在标签注明,不显示白板。
- MHR 分屏(`mhr_label/src/layout.js`):A = 3D 自由视角 + 各相机对齐视频(默认);B = 对齐视频平铺;C = 聚焦一个相机。3D 视角以人体与地面网格取景(`info.scene` 的上方向与地面高度),近处图像遮挡远处图像。

## 8. 资产与离线工具

- 网页运行时模型放 `smpl_web_viewer/public/models/`,必须是普通文件(Pages 不能服务 LFS 指针)。MHR LOD1 不含姿态修正与表情(与交付数据的生产设置一致),含 rig 限位。
- 数据集不进仓库。多视角配对要求同一机位/设备语义明确;转换器默认拒绝混用设备族,可用 `--init` 指定初始化预测源、默认做两视角刚体融合。缺标定的相机用 `estimate_camera_from_body.py` 估「诊断候选」,同机位时用背景单应测焦距。
