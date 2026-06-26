# 设计：通用 JSON 加载入口 + 修复只读保存

日期：2026-06-26
分支：feat/kpt-label-2d-pose
范围：三个标注器 `label/`、`pcd_label/`、`kpt_label/`

## 背景与问题

本仓库的三个浏览器内 SMPL/关键点标注器，标注的读写依赖 File System Access API
（Chrome/Edge 原地写回目录；其他浏览器退化为下载）。当前存在两个问题：

1. **无法手动指定标注数据加载。** 三个标注器都只在"打开目录/视频"时自动读取同名
   标注文件（`player_0.json` / `kpt_label_project.json`）。一旦自动读取没命中
   （文件名不符、标注在别处、想换一份标注核对），用户无法确认自己的标注数据。

2. **原地保存对只读文件失败。** 在 pcd 打开一个目录后直接点保存，报
   `NoModificationAllowedError: Failed to execute 'createWritable' on
   'FileSystemFileHandle': Cannot write to a read-only file`。即便浏览器已弹出并
   授予"允许网站修改文件"。

### 问题 2 根因（已确认）

复现目录（`.../2026-06-02-16-41-33-800-RS-520-Data`）本身可写（`drwxrwxr-x`），
但目录里已存在的 `player_0.json` 是 **OS 层只读 `-r--r--r--`（0444）**。Chrome 的
File System Access 即使拿到 readwrite 句柄，对一个底层只读的文件调用
`createWritable()` 仍抛 `NoModificationAllowedError`。这不是浏览器授权问题，是磁盘上
文件权限位的问题——很可能此前某次写出把文件置成了只读，或文件来自只读拷贝。

## 目标

- 三个标注器各增加一个"加载标注 JSON"入口，手动指定一份标注文件覆盖当前内存数据。
- 修复原地保存遇到只读目标文件时的写入失败，使保存稳健成功。
- 行为在三个标注器间保持一致。

## 非目标

- 不改 YOLO-pose 训练集导出（`kpt` 的 `export`）逻辑。
- 不改帧序/对齐/数据格式约定（COCO `player_0.json`、`kpt-label/v1`）。
- 不处理被其他进程独占锁定的文件（仅处理 OS 只读位场景）。

## Part A — 修复只读保存

### 写入策略：删重建同名文件（已确认）

改写共用的原地写入逻辑。受影响的两个文件：

- `label/src/io/dir_source.js`：`writableAt()`（被 `saveJson` / `writeFile` 调用）。
  `kpt_label` 复用此模块的 `DirSource.writeFile`，自动跟着修好。
- `pcd_label/src/io/pcd_dir_source.js`：`PcdDirSource.saveAnnotation()`。

新的写入序列（封装成一个可复用的 helper，比如 `createWritableResilient(dir, name)`
或在现有函数内内联，二者择一，实现时定）：

1. 取/建文件句柄 `getFileHandle(name, { create: true })`，调 `createWritable()` 写入。
2. 若抛 `NoModificationAllowedError` 或 `InvalidStateError`：
   - 在所属目录句柄上 `removeEntry(name)` 删掉旧（只读）文件；
   - `getFileHandle(name, { create: true })` 重建新文件（新文件默认可写）；
   - 重新 `createWritable()` 写入。
3. 重建仍失败 → 向上抛出，由 app 层兜底退回"下载"路径。

### 影响与代价

- 重建会丢掉原文件 inode 与权限位；新文件按系统 umask 默认权限（通常 0644），
  反而修好只读。对 JSON 标注文件无副作用。
- `label` 的 `writeFile` 同时用于 kpt 导出 images/labels 等二进制写出；删重建逻辑
  对这些写入同样安全（同名覆盖语义不变）。

### 兜底退回下载

各 app 的 save 路径已有"无 `dirSource` → 下载"分支。本次额外把"原地写入抛异常"
也并入兜底：捕获写入异常后走下载分支，并提示用户原文件只读/无法原地写。

## Part B — 通用 JSON 加载入口

### 前提（已确认）

加载按钮要求**先打开数据**（目录 / 视频 / 图像）。未打开数据时按钮禁用或点击提示
"请先打开数据"。因为加载的标注需要与已打开的背景（图像/点云/视频）按帧序对齐，
且保存目标依赖已打开目录的句柄。

### 入口位置（已确认：并入选择数据入口）

- `label/index.html`：现有 `#open-menu` 下拉加第三项 `📥 加载标注 JSON`。
- `kpt_label/index.html`：现有 `#open-menu` 下拉加 `📥 加载标注 JSON`。
- `pcd_label/index.html`：现为单按钮 `#btn-open`。改造为下拉菜单（"打开序列目录" /
  "加载标注 JSON"），或在 `#btn-open` 旁加一个并列小按钮 `#btn-load-json`。实现时
  取其一，倾向并列小按钮以最小改动 pcd 现有打开逻辑。

### 文件选择机制（已确认：通用 .json 选择器）

`showOpenFilePicker({ types: [{ accept: { 'application/json': ['.json'] } }] })`
选一个 `.json`。不支持 FS Access 的浏览器退回隐藏的
`<input type="file" accept=".json">`。

### 格式校验（已确认：校验，不符拒加）

抽成纯函数，便于单测：

- `isCocoDoc(obj)`：对象是否含 `images` 数组（COCO 结构最小判据，与
  `CocoDocument` 入参契约一致）。用于 `label`、`pcd`。
- `isKptProject(obj)`：`obj.schema === 'kpt-label/v1'`。用于 `kpt`。

校验不通过 → 状态栏提示具体原因（"不是 SMPL 标注（COCO）格式" /
"不是 kpt 工程文件（schema 不符）"），不覆盖当前内存数据。

放置建议：纯校验函数集中到一个小模块（如 `label/src/io/anno_validate.js`，
导出 `isCocoDoc`；kpt 的 `isKptProject` 可放 `kpt_label/src/kpt_store.js` 旁或同模块），
配 `*.test.js`。

### 加载后行为

1. 读取并 `JSON.parse`，跑对应校验；不通过则提示并返回，**不改内存**。
2. 通过则用加载的 JSON **重建 store**，沿用各 app 现有的挂载/重置路径对齐已打开
   背景的帧序与尺寸：
   - `label`：`new AnnotationStore(new CocoDocument(raw))`，参照 `resetFromDisk`
     重建 store + UIController，再 `showFrame(当前帧或0)`。
   - `pcd`：`new AnnotationStore(new CocoDocument(raw))`，参照 `#btn-reset` 逻辑。
   - `kpt`：`KptStore.fromJSON(obj, nkpt)`，参照 `openDirectory` 的续标分支，
     重设 slider.max 并 `loadFrame`。
3. **保存目标**：沿用已打开目录的标准文件名（`player_0.json` /
   `kpt_label_project.json`）原地写回；写入走 Part A 的删重建逻辑；失败退回下载。
   即"手动加载的 JSON 覆盖内存，但保存仍写回目录标准位置"。

### 与默认自动加载的关系

打开目录/视频时维持现状——自动读取同名标注作为默认加载。手动加载按钮点下后覆盖
内存数据。符合"优先级：打开数据时默认加载，后续按钮加载点下则覆盖"。

## 测试

- Part A 删重建逻辑是浏览器 `FileSystemFileHandle` 的 IO 边界，无法单测，按项目约定
  在浏览器内验证（Chrome 打开含只读 `player_0.json` 的目录 → 保存成功）。
- Part B 的格式校验函数为纯逻辑，新增 `anno_validate.test.js`（或并入对应已有测试），
  覆盖：合法 COCO、缺 `images`、合法 kpt 工程、schema 不符、非 JSON/空对象。
- `npm run test:web` 应全绿。

## 验收

1. pcd 打开含只读 `player_0.json` 的目录，点保存 → 成功原地写回，无
   `NoModificationAllowedError`。三个标注器同此行为。
2. 三个标注器在已打开数据后，可通过"加载标注 JSON"入口选一份 JSON：
   - 格式正确 → 覆盖内存并渲染；保存写回目录标准文件名。
   - 格式不符 → 提示拒绝，内存不变。
3. 未打开数据时加载入口禁用或给出"请先打开数据"提示。
4. 不支持 FS Access 的浏览器：加载走 `<input file>`，保存走下载兜底。
