# SMPL Web Viewer 设计

日期: 2026-06-10
状态: 待用户审阅

## 目标

新建一个纯 Web runtime 的 SMPL 观察器, 与现有 `smpl_viewer/` 平级, 目录为 `smpl_web_viewer/`。现有 `smpl_viewer/` 继续作为 Python server + Three.js 版本独立演进; 新目录不影响旧代码, 后续只在必要时合并已经验证过的相机、UI 或数据处理逻辑。

本期目标是证明浏览器可以独立处理 SMPL 参数:

1. 运行时只加载本地静态资产: SMPL 模型常量、逐帧 SMPL 参数 JSON、背景图片序列或视频、Three.js/vendor JS。
2. 运行时不依赖 Python, 不请求 Python server, 不加载逐帧 mesh。
3. SMPL forward 在浏览器内完成: 从 `root_rota/root_pos/body_pose/betas` 生成 24 关键点和 6890 顶点 mesh。
4. 图形学交给 Web: Three.js 负责 mesh、关键点、背景、相机对齐、播放。
5. 第一版使用 CPU TypedArray + Web Worker, 不引入 TensorFlow.js、ONNX Runtime 或 WebGPU。目标是所有现代浏览器可跑, 数学路径可审计, 结果可与 Python 版逐点对齐。

## 非目标

- 不在运行时使用 `torch`, `pickle`, `opencv`, `flask` 或任意 Python 代码。
- 不把逐帧 mesh/verts/joints 作为运行时数据格式。
- 不把 TensorFlow.js、ONNX Runtime Web、WebGPU compute 作为第一版依赖。
- 不做 SMPL 参数编辑器; 本期仍是观察器。
- 不做多人、多模型性别切换、纹理贴图或标注保存。

## 数据边界

允许有一次性离线转换器。转换器可以使用 Python 读取现有资产, 但转换后的 Web runtime 只读普通静态文件。

### 模型常量资产

输入:

- `smpl_viewer/_data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl`

导出到新目录:

- `smpl_web_viewer/public/models/smpl_neutral.meta.json`
- `smpl_web_viewer/public/models/smpl_neutral.f32.bin`
- `smpl_web_viewer/public/models/smpl_neutral.i32.bin`

模型常量包括:

- `v_template` `(6890,3)`
- `shapedirs` `(6890,3,10)`
- `posedirs` `(207,6890*3)` 或等价布局
- `J_regressor` `(24,6890)`
- `weights` `(6890,24)`
- `faces` `(13776,3)`
- `parents` `(24,)`

这些是 SMPL 固定参数, 不是序列结果, 因此允许运行时加载。

### 序列参数资产

样例数据:

- `/Users/penghaotian/Downloads/20260609/a_famale_224/a/a1/pose_files/a1.json`
- `/Users/penghaotian/Downloads/20260609/a_famale_224/a/a2/pose_files/a2.json`
- `/Users/penghaotian/Downloads/20260609/a_famale_224/a/a3/pose_files/a3.json`
- `/Users/penghaotian/Downloads/20260609/a_famale_224/a/a4/pose_files/a4.json`

这些 JSON 已包含 `records[]`, 每帧含:

- `frame`
- `root_pos` `(3,)`
- `root_rota` `(3,)`
- `body_pose` `(63,)`, 即 21 个 axis-angle body joints
- `betas` `(10,)`

Web runtime 的规范序列格式为。下面示例省略了长数组内容, 实际 `body_pose` 必须是 63 个数, `betas` 必须是 10 个数。

```jsonc
{
  "schema": "smpl-web-sequence-v1",
  "name": "a_famale_224/a1",
  "fps": 30,
  "image": {
    "type": "image_sequence",
    "baseUrl": "./images/a1/",
    "pattern": "%04d.jpg",
    "width": 1920,
    "height": 1080
  },
  "camera": {
    "fx": 1850,
    "fy": 1850,
    "cx": 960,
    "cy": 540
  },
  "frames": [
    {
      "frame": 0,
      "root_pos": [0, 0, -4],
      "root_rota": [0, 0, 0],
      "body_pose": [/* 63 axis-angle numbers */],
      "betas": [/* 10 shape numbers */]
    }
  ]
}
```

可以保留转换器把原始 `pose_files/*.json` 标准化为这个格式。标准化不会写入 mesh 或 joints。

背景可以是:

- `image_sequence`: 样例目录当前可用。
- `video`: 后续数据提供视频时使用同一播放控制接口。

## 文件布局

```text
smpl_web_viewer/
├── README.md
├── index.html
├── src/
│   ├── app.js
│   ├── viewer/
│   │   ├── scene.js
│   │   ├── camera_modes.js
│   │   ├── background.js
│   │   └── playback.js
│   ├── smpl/
│   │   ├── smpl_model.js
│   │   ├── smpl_worker.js
│   │   ├── lbs.js
│   │   └── math3d.js
│   └── data/
│       ├── sequence_loader.js
│       └── sample_manifest.js
├── tools/
│   ├── export_smpl_model.py
│   ├── convert_sequence.py
│   └── make_sample_assets.py
├── public/
│   ├── models/
│   ├── samples/
│   └── vendor/
└── tests/
    ├── smpl_math.test.js
    ├── smpl_forward.test.js
    └── fixtures/
```

第一版可以不用 npm 构建。`index.html` 通过 ES modules 直接加载本地 JS, `public/vendor/` 复用或复制现有 `smpl_viewer/vendor/three.module.js` 和 `OrbitControls.js`。这样离线环境只要能启动静态文件服务即可运行。

## SMPL Forward

浏览器内实现标准 LBS 路径, 对齐 `smpl_viewer/_smpl_lib/lbs.py`:

1. `v_shaped = v_template + blend_shapes(betas, shapedirs)`
2. `J = vertices2joints(J_regressor, v_shaped)`
3. 将 24 个 axis-angle 转为 rotation matrix:
   - joint 0 使用 `root_rota`
   - joints 1-21 使用 `body_pose`
   - joints 22-23 补零
4. `pose_feature = rot_mats[1:] - I`
5. `pose_offsets = pose_feature @ posedirs`
6. `v_posed = v_shaped + pose_offsets`
7. 沿 `parents` 做 kinematic chain, 得到 `J_transformed` 和每个 joint 的 relative transform `A`
8. 对每个顶点做 linear blend skinning:
   - `T_v = sum_j weights[v,j] * A[j]`
   - `verts[v] = T_v * [v_posed[v], 1]`
9. 加 `root_pos` 平移, 输出源坐标系 vertices 和 24 joints。

### CPU 性能策略

- SMPL forward 放在 `smpl_worker.js`, 避免阻塞主线程。
- 数据结构使用 `Float32Array` / `Int32Array`, 不创建 per-vertex 对象。
- 模型常量加载后常驻 Worker。
- `betas` 通常整段相同; 缓存 `v_shaped` 和 rest joints, 仅 pose 变化时更新 pose blend 和 skinning。
- 帧缓存采用小窗口, 例如当前帧前后各 30 帧。播放时预计算下一批。
- 主线程和 Worker 之间用 transferable `ArrayBuffer` 传递输出, 避免拷贝。
- 第一版优先正确性; 若单帧 CPU forward 过慢, 再优化为分块、稀疏 J_regressor、预转置 posedirs/weights 或 WebAssembly。

## Viewer

复用现有对齐数学:

- 源坐标系: `Y+ = up`, `-Z = depth`, 相机原点看 `-Z`。
- 投影公式: `u = fx * X / (-Z) + cx`, `v = fy * (-Y) / (-Z) + cy`。
- Three.js 2D 对齐模式使用 `PerspectiveCamera` + `setViewOffset` 表达主点偏移。

功能:

- 加载模型常量。
- 加载一个或多个 actor 序列, 例如 `a1..a4`。
- 渲染 mesh wireframe/solid toggle、24 关键点和骨骼。
- 背景支持图片序列; 视频接口预留。
- 帧滑块、播放/暂停、速度、actor 切换。
- 显示 Worker forward 耗时、渲染 FPS、缓存命中。

UI 保持工具型, 不做 landing page。第一屏就是 viewer。

## 转换器

### `export_smpl_model.py`

职责:

- 读取现有 pkl。
- 将 scipy sparse `J_regressor` 转 dense 或压缩稀疏格式。
- 将数组统一转 little-endian `float32` / `int32`。
- 写入 `.meta.json` 描述每段 buffer 的 offset、shape、dtype。
- 写入 `.f32.bin` 和 `.i32.bin`。

转换器可以依赖 Python、numpy、scipy, 但运行时不依赖。

### `convert_sequence.py`

职责:

- 读取样例 `pose_files/*.json`。
- 保留每帧 SMPL 参数。
- 补齐 `body_pose` 到 23 body joints 所需的 69 维内部格式时, 只在 Web forward 内部补零; 导出的序列仍保留原始 63 维。
- 写入规范 `sequence.json`。
- 复制或引用背景图片序列路径。

### `make_sample_assets.py`

职责:

- 为 `/Users/penghaotian/Downloads/20260609/a_famale_224` 生成本地可打开样例目录。
- 默认生成 `a1..a4` 四个 actor 的 manifest。
- 不生成逐帧 mesh。

## 验证

### 数学单测

用 Node 或浏览器测试 runner 验证:

- axis-angle 到 rotation matrix。
- vertices2joints。
- batch rigid transform。
- LBS 在极简 toy skeleton 上输出可预期。

不要求 npm 作为运行时依赖; 如果引入测试工具, 只作为开发依赖。

### Python 对齐基准

允许用 Python 旧实现生成少量 fixture:

- `tests/fixtures/frame_0000_python_verts.f32.bin`
- `tests/fixtures/frame_0000_python_joints.f32.bin`

这些 fixture 只用于测试 Web forward 正确性, 不进入 runtime sample。

误差门槛:

- joints 最大误差 `< 1e-4 m`
- vertices 平均误差 `< 1e-4 m`
- vertices 最大误差初期可放宽到 `< 5e-4 m`, 若 TypedArray 顺序完全一致再收紧。

### 浏览器验收

- 在无 Python 应用服务的本地静态 HTTP 服务下打开 `smpl_web_viewer/index.html`。
- 加载样例 `a1`。
- Worker 输出 mesh, Three.js 正常播放。
- 2D 对齐模式下 mesh 落在背景图相同位置。
- 断网后刷新仍可加载本地 vendor 和 sample assets。

## 风险

1. **SMPL pkl 许可证和分发边界**: 仓库已经通过 LFS 合入资产。Web 导出的模型常量仍是同一资产的派生形式, 需要沿用同样的访问和分发边界。
2. **CPU 性能**: 6890 顶点 × 24 transforms 每帧可接受, 但 pose blend 的矩阵乘可能较重。Worker、缓存和预转置是第一轮优化点。
3. **稀疏 J_regressor**: 直接 dense 简单但浪费。第一版可以 dense 以减少复杂度; 若模型资产过大, 改 CSR。
4. **数值差异**: JS Math 与 torch float32 顺序不同可能造成小误差。实现中所有累加尽量写入 Float32Array, 测试门槛按实际误差校准。
5. **样例图片路径**: 浏览器不能直接读取任意本机绝对路径。样例制作脚本需要把图片复制到 `public/samples/` 或要求从样例根目录启动静态服务。

## 决策

- 新目录: `smpl_web_viewer/`
- 第一版 forward: CPU TypedArray + Web Worker
- 不使用 TensorFlow.js / ONNX Runtime Web / WebGPU
- 不依赖网络; vendor JS 本地加载
- 允许离线 Python 转换器; 不允许运行时 Python
- 运行时序列 JSON 只包含 SMPL 参数, 不包含 mesh

## 成功标准

1. `smpl_web_viewer/` 可以独立启动静态 viewer。
2. 首次加载模型常量和样例序列后, 浏览器 Worker 生成 mesh 和 joints。
3. 样例 `a_famale_224` 至少一个 actor 可以正常播放并对齐背景。
4. Web forward 与 Python fixture 数值误差在门槛内。
5. 旧 `smpl_viewer/` 未被破坏, 后续可继续独立更新。
