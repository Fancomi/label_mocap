# SMPL Viewer 设计 (diving 数据对齐)

日期: 2026-06-09
作者: 与用户 brainstorm 形成
状态: 待用户审阅

## 目标

在 `label_mocap/` 内做一个 HTML 观察器, 满足:

1. 与 `kps3d/kps3d_viewer.html` 同等的 3D 交互 (拖动旋转 / 滚轮缩放 / 右键平移 / 帧滑块 / 播放).
2. 渲染 SMPL mesh + 24 关键点, kps3d_viewer 是它的功能子集.
3. 相机两种模式, 1 秒 slerp 平滑切换:
   - **3D 模式**: 自由视角看场景, 同时显示一个虚拟相机 frustum, frustum 近端贴当前帧的图像.
   - **2D 模式**: 场景相机移到虚拟相机位置, 看到底图在远处, mesh / 关键点严格对齐到底图上 (始终绘制在底图之前).
4. 切换不是 jump, 是 slerp 1s 过渡, 切回时还原上次姿态.
5. **不用 PnP**, 用写死或读取的内参把 mesh 投影到原图.

终极目标: SMPL 系列动作捕捉标注器. 本期是观察器.

## 总体架构

两层:

- `server.py` (Flask, 常驻): 启动时 `--raw-root` 扫 `dataset/diving/raw/{10m,3m,gd,olympic}/*` 找含 `a1/json_results` 的序列, 加载 PySMPL. HTTP 提供序列列表 / 帧二进制 / 原图.
- `viewer.html` + JS (Three.js): 首页下拉选序列, 加载 meta, 按帧拉数据. **一台 PerspectiveCamera 跨 3D / 2D 模式**.

约束: 所有几何在**源坐标系** (`Y+=up, -Z=depth`, 相机原点看 -Z). 这与 `data_convert/diving_convert.py::load_smpl_params` 一致, `detect_orientation` 决定 portrait. portrait 序列 SMPL 不旋转, 图像也不旋转, 由前端 3D 模式下旋转贴图平面解决方向问题.

## 后端 API

### 启动

```bash
python label_mocap/smpl_viewer/server.py \
  --raw-root /root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw \
  --port 5173
```

### 接口

| 路径 | 返回 |
|---|---|
| `GET /` | `viewer.html` |
| `GET /seqs` | `{seqs:[{src,name,n_frames,portrait}, …]}`, 内存缓存, `?refresh=1` 重扫 |
| `GET /seq/<src>/<name>/meta` | `{n_frames, portrait, K:{fx,fy,cx,cy}, image_w, image_h, faces_url, kp_count}` |
| `GET /seq/<src>/<name>/faces.bin` | `int32 (F,3)` SMPL faces, 全序列共用, 一次性下载 |
| `GET /seq/<src>/<name>/frame/<i>.bin` | `verts (6890,3) float32` + `joints (24,3) float32` + `root_pos (3,) float32`, **源坐标系** |
| `GET /seq/<src>/<name>/img/<i>.jpg` | 原图未旋转 (Flask `send_file`, 自带 ETag) |

### 内参

直接用 `diving_convert.K_CAM`: `fx=fy=1850, cx=960, cy=540`. 图像维度 `image_w/image_h` 由后端 `cv2.imread(images/0000.jpg).shape` 实测后写入 meta, 不在前端写死. portrait 序列与 landscape 序列共享同一组内参 (cx=960, cy=540), 图像未做旋转.

> 待 `alignment_check.py` 第一次跑通时确认: portrait 序列原图实测尺寸是 (H=1080, W=1920) 还是 (H=1920, W=1080). meta 必须返回真值.

### SMPL forward 时机

第一次访问某序列时, 整段 forward 一次, 结果 cache 在 `dict[seq_key] -> {verts, joints, n_frames}` 直至进程退出. 单条 ~50 MB. 仿 PromptHMR 做法: Python 持有 SMPL, 跑 forward, 把 vertices + faces 发出去; 前端只画 mesh.

### 复用 diving_convert.py

在 `diving_convert.py` 加一个 kwarg `coord="src"|"dst"`, `process_diving_sequence(..., coord="src")` 时跳过 `transform_root_and_pose`, 直接 `smpl_forward_batch(smpl, root_rota, body_23, root_pos)` 输出源坐标系顶点. 其它行为不变.

## 前端 · 一台相机贯穿 3D/2D

统一相机: `PerspectiveCamera`. 所有几何挂在源坐标系 group 下 (`Y up, -Z depth`). `scene.up = (0,1,0)`, 相机看 -Z.

### 3D 模式 (默认)

- `OrbitControls`, target = 人物 root joint (每帧追).
- 在源坐标系原点画 frustum 线框 (`LineSegments`), 4 个角射线由 `K, image_w, image_h` 算得.
- 同帧的图作为 `PlaneGeometry + MeshBasicMaterial(map)`, 挂在 frustum **近端** (例 d=1.5m), 尺寸:
  - `planeW = 2 * tan(fov_x/2) * d`
  - `planeH = 2 * tan(fov_y/2) * d`
  - 朝向 +Z 后绕 Y 翻 180°, 让贴图正面朝原点.
  - portrait 序列把这块 plane mesh 绕 -Z 旋 90° CW (旋转的是平面, 不是图像数据).

### 2D 模式

- 相机置于 `(0,0,0)`, look at `(0,0,-1)`, `up=(0,1,0)`.
- `fov_y = 2*atan(image_h/(2*fy)) * 180/π`
- `aspect = image_w / image_h`
- `setViewOffset(image_w, image_h, image_w/2-cx, image_h/2-cy, image_w, image_h)` 处理 cx/cy 主点偏移. diving 中心对称偏移=0, 但保留正确实现以兼容其它源.
- 把贴图平面挪到远处 (`z = -50m`), 尺寸按公式重算覆盖整个 fov; frustum 隐藏.
- Mesh / 关键点 material 设 `depthTest=false, renderOrder=10`, 底图 `renderOrder=0`. 永远画在底图前.
- `OrbitControls.enabled=false`.

### 切换动画

- 切到 2D: `position` lerp + `quaternion` slerp + `fov` 数值线性, 1s. 同步插值贴图平面位置/尺寸. Tween 完成后再禁 controls.
- 切到 3D: 反方向, 先恢复 controls 但锁定, tween 完释放.
- **保留切换前姿态**: 第一次进入 2D 时记下当前 3D 姿态, 之后切回 3D 用记下的值; 同理 2D 也保留. 切换都是从"当前"插值到"上次保存的目标".

### 对齐成立的核心数学

源投影 `u=fx*X/(-Z)+cx, v=fy*(-Y)/(-Z)+cy`
等价于 Three.js perspective 相机看 -Z + `fov_y=2*atan(H/(2fy))` + `setViewOffset(主点偏移)` + 视口宽高比正确.

只要相机参数对了, 2D 模式下 mesh 自动落在底图正确位置. **无需 PnP**.

## 对齐验证 (写交互前)

不写交互, 不切相机模式, 先证明 2D 模式下 SMPL 投影 = 原图位置.

1. **Python 侧 ground truth**: `alignment_check.py` 取一帧, 跑源坐标系 forward, 用 `u=fx*X/(-Z)+cx, v=fy*(-Y)/(-Z)+cy` 把每个顶点投到原图, OpenCV 画绿点保存 `gt_overlay_<frame>.png`.
2. **Three.js 侧**: viewer 加 `?validate=1` 模式, 强制 2D, 不画 OrbitControls / frustum, 只画底图 + mesh wireframe, 截图 `viewer_overlay_<frame>.png` (`renderer.domElement.toDataURL()` 触发下载).
3. **比对**: `cv2.absdiff` 阈值, mesh 边缘偏移 < 2px 算通过.

验证序列: landscape 一条 (`olympic/*`), portrait 一条 (`10m/TiaoShui_a_male_5500_597`). 各取首/中/末 3 帧.

### 验证通过后再做的事 (按顺序, 每个独立可看可测)

1. 3D 模式 `OrbitControls` + 网格 + 三轴
2. 3D 模式画 frustum 和近端贴图平面
3. 24 关键点 + 骨骼连线 (沿用 kps3d_viewer 的 `BONES`)
4. 模式切换 + 1s slerp
5. 序列下拉 + 帧滑块/播放/速度 (沿用 kps3d_viewer UI)
6. 关节角面板 (沿用)

## 组件与文件布局

```
label_mocap/
├── kps3d/                       # 已有
└── smpl_viewer/
    ├── server.py                # Flask: 扫盘 / forward / 帧二进制 / 静态
    ├── alignment_check.py       # 离线生成 gt_overlay_*.png
    ├── viewer.html              # 主页面
    ├── viewer.js                # Three.js 主逻辑
    ├── camera_modes.js          # 一台相机的 3D/2D 状态机 + slerp
    └── README.md                # 启动方式 + 验证流程
```

边界:
- `server.py` 不知道 Three.js. 只给二进制 + JSON.
- `camera_modes.js` 不知道 SMPL. 只接收"我是 3D 还是 2D"两状态, 吐相机参数 + 贴图平面参数.
- `viewer.js` 拼装: 拉数据 → 喂场景 → 调 camera_modes.

复用 `rollout_lidar_mocap_badminton/data_convert/diving_convert.py` 的 `process_diving_sequence`, 加 `coord` kwarg.

## 风险与显式不做

### 风险

1. **portrait 贴图旋转方向**: 物理拍摄 up=-X, 图像 1080×1920 是 1920×1080 旋了的. 第一次试 90° 可能错方向, 由验证步骤 1 发现.
2. **fov_x vs fov_y**: Three.js 用 vertical fov. fov_y 必须用 meta 返回的 image_h (实测后端 imread 得到), 不能想当然. landscape 与 portrait 实测尺寸由验证脚本第一次跑时确定.
3. **6890 顶点 mesh**: `MeshBasicMaterial(wireframe=true)` 性能够; 做实色着色再考虑 BufferGeometry 复用.
4. **SMPL forward 缓存**: 单条 ~50MB, 10+ 条几百 MB. 先不主动淘汰, 必要时 LRU.

### 显式不做 (YAGNI)

- 多人 (diving 全单人).
- 实时编辑 SMPL 参数 (标注器是终极目标, 本期只观察).
- 多源同时对比.
- 服务端推流 / WebSocket. HTTP + 浏览器侧帧缓存够.
- 鉴权 / HTTPS / 生产部署.

## 自测项

- `alignment_check.py` 输出 gt_overlay 与 viewer ?validate=1 截图 absdiff < 2px.
- 帧切换二进制完整: `verts.byteLength === 6890*3*4`.
- 模式切换 3D→2D→3D 后, 相机姿态精确还原 (保存的 quaternion 比对).
- 序列切换无残留 (mesh 顶点数 / faces 重新加载).
