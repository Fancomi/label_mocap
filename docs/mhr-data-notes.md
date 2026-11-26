# MHR 模型、数据包与标定:实测结论

`mhr_label/` 与 `tools/mhr/` 依据的事实。页面行为约定见 `CONTRACTS.md`。

## MHR 模型(LOD1)

- 来源:`facebookresearch/MHR` v1.0.1 `assets.zip`(Apache 2.0),TorchScript `mhr_model.pt`,不依赖 pymomentum。资产放仓库外(如 `../mhr_assets/v1.0.1/assets/`),离线环境需 torch + `mhr`。
- 结构:18439 顶点、36874 面、127 关节;单位厘米,Y 上,静止骨盆在 (0, 92.4, 0)。
- `model_params[204]` = root 平移 3 + root 旋转 3 + 姿态 130 + 缩放 68;`identity[45]`(20 身体 + 20 头 + 5 手);表情 72。
- 前向:`joint_params = PT · [model_params, 0₄₅]`(PT 稀疏,368 非零)→ 每关节 `t = jp.t + offset`、`q = prerot · eulerXYZ(jp.r)`、`s = 2^jp.s` → 沿父链复合相似变换 → 静止网格 = base + identity·blend → LBS(含缩放)。
- root 旋转:rig 按 PT 把 `mp[3], mp[4], mp[5]` 当 rx, ry, rz,R = Rz·Ry·Rx。数据包标注的「rz,ry,rx 存储次序」只是网络输出标签,以 PT 为准。
- **交付数据没开姿态修正、表情为零**(`MHR_PARAMETER_LAYOUT.json`:`correctives: Disabled for parity`)。官方模型这样回放与包内顶点差 ≤ 0.0002cm;开修正差 4cm。所以 Web 资产不含姿态修正与表情。
- 精度:`tools/mhr/mhr_reference.py`(numpy)与 TorchScript 差 0.00006cm;JS 前向(`smpl_core/mhr.js`)差 ≤ 6e-4cm。
- Web 资产 `mhr_lod1.*` 约 11MB(identity blendshape 占 10MB),必须是普通文件(Pages 不服务 LFS),附 LICENSE。

## 关节自由度与限位

- 直驱参数(系数 1):肩、髋、锁骨、颈、头 3 自由度;腕 2(ry, rz),前臂扭转由 `lowarm_twist` 控制;肘、膝 1(bend);脊柱 4 节各 3 个 `_flexible`,另有跨节耦合的 twist/lean/bend。`*_twist` 辅助关节由 PT 自动跟随。
- rig 自带参数区间(`limit_param/min/max`,弧度)当关节限位用;`*_flexible` 中 min == max 的不当硬限位(sam-3d-body 输出在用)。
- 手已解码进 204 维,直接取,不做 hand/scale PCA。

## 数据包 → `player_N.json`(`tools/mhr/convert_sam3d_bundle.py`)

- 权威输入:每相机一个 npz 的 `mhr_model_params[204] + shape[45] + pred_cam_t_m[3]`,几何在各自转正后的相机系里。两路是独立预测,未融合。
- 外参:`p_native = R_native_from_common · p_common + t`,OpenCV,米,行优先。公共系 = orb1 原生光学系(Y 下),**不是重力对齐的世界**。
- 世界系 = 公共系换 GL 约定,F = diag(1, −1, −1)。由视角 c 的一行导入:
  - `M_c = F·R_native_from_commonᵀ·R_native_from_upright`,`m_c = −F·R_native_from_commonᵀ·t_native_from_common`,`A = M_c·F`
  - `root_rota = axisAngle(A · Rz·Ry·Rx(mp[3:6]))`
  - `root_pos = A·(0, 0.924, 0) + M_c·pred_cam_t_m + m_c`
  - `mhr_pose = mp[6:136]`,`mhr_scale = mp[136:204]`,`mhr_shape = shape`
- 反向:`mp[3:6] = eulerXYZ(rotmat(root_rota))`,`mp[0:3] = 0`;世界顶点 = MHR(mp, shape)/100 − (0, 0.924, 0) + `root_pos`。回放与「包内顶点经外参转到世界系」差 ≤ 0.0015cm。
- 视频:H.264、恒定帧率、无 B 帧,`decode_index / fps` 可精确 seek。配对用数据包的 `pairs_*.csv`,不按帧率重算。
- 默认对初始化人体做两视角刚体融合(`fuse_rigid`:绕骨盆转 + 平移,姿态体型不动;转角 ≤ 30°、平移 ≤ 1m,否则放弃),残差写进 `source.fused_to`。`--no-fuse` 关闭,`--init` 指定初始化预测源。
- `info.scene = { up, ground_height_m }` 由人体估计:头−骨盆主轴 ≈ 竖直,地面 = 最低关节 0.5 分位。

## 机位与标定(20261102 RING 数据)

- 每段只有 orb1(正面 Orbbec)、zcam1、zcam2。zcam1 与 orb1 同一正面机位(光心相距约 0.1m),zcam2 是侧面。设备族不混配:标注用 zcam1 + zcam2。
- 交付包没有 zcam1 标定。`tools/mhr/estimate_camera_from_body.py` 给出诊断候选:YOLO-pose 在 orb1 + zcam2 上三角化 → zcam1 PnP(RANSAC + 帧级剔除);焦距由与 orb1 背景的单应实测(`--colocated orb1`),f = 1136。畸变假定为零,`calibration_accepted = false`。
- 用 zcam2(侧面)单目预测初始化时,正面视角偏差中位 64px;改为 orb1 初始化 + 刚体融合后,相对独立检测 zcam1、zcam2 中位均约 22px。
- 侧机标定也是候选。两视角怎么调都对不齐时,先怀疑标定,再怀疑人体。
- 70 关键点映射(`keypoint_mapping.bin`)不在公开资产里;派生关键点用 127 骨架的固定槽位(65 个,含手指)。
