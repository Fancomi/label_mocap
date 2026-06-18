# 2D 视图缩放/平移 设计文档 (2D View Zoom/Pan)

- 日期: 2026-06-18
- 状态: 设计已与用户确认,待评审
- 范围: 在 2D 对齐视角增加纯视图缩放与平移,用于在大图(如 4K)中放大观察小目标。只改"渲染哪一块",不动相机内外参、不动 SMPL 数据。切回 3D 自动复位。

## 1. 背景与目标

4K 大图里待标人物可能很小,用户需要放大看细节并精细标注。要求:
- 放大逼近**原生分辨率**(重新光栅化子区域,而非把已渲染图做插值放大)。
- 是 **2D 视图的缩放**,不改相机位姿、不改内参/外参,**数据零变化**。
- 缩放/平移时所有手柄(gizmo/IK/bbox)正常交互。
- UI(侧栏/按钮)**不随之缩放**。
- 切回 3D 自由视角**自动关闭**,与所有功能不冲突。
- 全平台/浏览器适配(Mac 触控板、Win/Linux 滚轮;Cmd/Ctrl)。

### 非目标
- 3D 视角的缩放(3D 用 OrbitControls dolly,本功能不涉及)。
- 旋转视图、像素级吸附等。

## 2. 核心机制:`camera.setViewOffset` 取景框

three.js `setViewOffset(fullW, fullH, x, y, w, h)` 让透视相机只渲染虚拟传感器 `fullW×fullH` 内的子矩形 `[x,y,x+w,y+h]`,拉伸填满画布。现有 `_applyViewOffset` 已用它做主点偏移:`setViewOffset(imageW, imageH, offX, offY, imageW, imageH)`,其中 `offX=imageW/2−cx`。

缩放/平移 = 把渲染子窗口从「基准窗口」(左上 `(offX,offY)`、尺寸 `imageW×imageH`)缩小并平移:
- 子窗口尺寸 `winW=imageW/z`、`winH=imageH/z`(z=缩放倍数,≥1)。
- 子窗口左上 `(winX,winY)` 由缩放中心与平移决定。
- `setViewOffset(imageW, imageH, winX, winY, winW, winH)`。

**为什么满足要求**:
- 投影矩阵的 fov/aspect、相机 position/quaternion、`this.K`(内参)全部不变 —— viewOffset 只影响投影的"取景裁剪",不进数据链路。SMPL forward / 保存 / bbox 数值零影响。
- WebGL 按子矩形重新光栅化整个场景(mesh + 背景纹理),不是放大已渲染像素 → 接近原生。背景纹理过滤设为 `LinearFilter`,4K 纹理全分辨率在 GPU,放大即放大采样。
- 手柄/拾取都走同一相机投影,缩放后射线检测自动一致,无需特殊处理。
- 只动相机 viewOffset,DOM 侧栏不受影响 → UI 不放大。

## 3. 缩放状态(camera_modes 内)

新增字段:`this._zoom = 1; this._panX = 0; this._panY = 0;`(panX/panY 单位:虚拟传感器像素,基准窗口内偏移)。

新增方法:
- `setZoomPan({ zoom, panX, panY })` — 设状态并重算 viewOffset(clamp z∈[1, 8]、panX/panY 使子窗口不出基准窗口边界)。
- `zoomAt(canvasNormX, canvasNormY, factor)` — 以画布归一化点 (u,v)∈[0,1] 为中心乘 factor 缩放,解出新的 panX/panY 使该点下的图像保持不动。
- `panByCanvas(dxNorm, dyNorm)` — 按画布归一化位移平移子窗口。
- `resetZoom()` — `_zoom=1,_panX=0,_panY=0`,回到基准 viewOffset。
- `getZoom()` — 返回当前 z(供 UI 显示/守卫)。

`_applyViewOffset()` 改为依据 `_zoom/_panX/_panY` 计算子窗口:
```
winW = imageW / z;  winH = imageH / z;
baseX = imageW/2 - cx;  baseY = imageH/2 - cy;   // 主点偏移(基准窗口左上)
winX = clamp(baseX + panX, baseX, baseX + imageW - winW);
winY = clamp(baseY + panY, baseY, baseY + imageH - winH);
camera.setViewOffset(imageW, imageH, winX, winY, winW, winH);
```
缩放中心数学(zoomAt):子窗口把 (0,0)→画布左上、(1,1)→画布右下。光标 (u,v) 下的传感器点 `sx=winX+u·winW`。新 `winW'=winW/factor`(即新 z'=z·factor),要 `winX'+u·winW'=sx` → `winX'=sx−u·winW'`,据此反推 panX'。clamp 后写回。

`snapTo`/`switchTo` 切到 3D 时调 `resetZoom()`(2D 才有缩放)。`resetIntrinsics`/`setIntrinsics` 重算时保留当前 z/pan(viewOffset 重算已含)。

## 4. 交互(app.js,仅 2D 模式生效)

- **裸滚轮 / 触控板双指**:`zoomAt(u, v, factor)`,factor 由 `deltaY` 归一化(`Math.exp(-deltaY*k)`,跨 deltaMode 一致)。2D 下 OrbitControls 禁用,滚轮空闲。
- **空白处拖拽**:`pointerdown` 命中画布但未命中任何手柄(查 engageGuards 都未 engaged)→ 进入平移;`pointermove` 调 `panByCanvas(dxNorm, dyNorm)`;`pointerup` 结束。命中手柄则交给手柄(TransformControls 自己处理),不平移。
- **root 深度改键**:现有"2D + 整体/移动 裸滚轮调 root_pos.z"改为 **Cmd(Mac)/Ctrl(其他)+ 滚轮**;裸滚轮让位给缩放。
- 切到 3D 按钮 / snapTo:`cam.resetZoom()`,3D 不响应缩放/平移。
- 全平台:`wheel` 用 `deltaY` + `deltaMode` 归一化;修饰键 `e.metaKey || e.ctrlKey`;指针用 pointer 事件。

## 5. 屏幕↔图像像素映射统一(关键一致性)

缩放后,bbox overlay 的"屏幕↔图像像素"映射必须把当前子窗口算进去,否则缩放后框错位。把映射抽成 camera_modes 的两个方法,bbox_overlay 与拖拽共用:
- `imageToCanvasNorm(ix, iy) → [u, v]`:图像像素 → 画布归一化(考虑 winX/winY/winW/winH)。
- `canvasNormToImage(u, v) → [ix, iy]`:逆映射。

bbox_overlay 现用 `(ix/imageW)*rect.width` 的线性式改为走这两个方法(经子窗口)。无缩放(z=1)时退化为原式,行为不变。

## 6. 不冲突保证

- 缩放/平移只在 `cam.mode==='2d'`;3D 一律 `resetZoom` 且不监听。
- 平移仅在指针未命中手柄时触发(engageGuards 都未 engaged);手柄拖拽优先。
- 渲染循环已有的 `controls.enabled=(mode==='3d')&&!gizmoBusy` 不变(2D 本就禁 orbit)。
- 数据/内参/外参不变 → 保存、IK、bbox 数值、keypoints 投影全不受影响。

## 7. 测试

纯逻辑(camera_modes 的缩放数学不依赖 three 渲染,可抽成纯函数测):
- 新建 `label/src/scene/view_zoom.js` 暴露纯函数 `computeWindow({imageW,imageH,cx,cy,zoom,panX,panY})→{winX,winY,winW,winH}`、`zoomAtSolve(...)→{panX,panY}`、`clampPan(...)`,camera_modes 调它。
- 测试 `view_zoom.test.js`:z=1 退化为主点偏移基准窗口;z=2 窗口半尺寸;zoomAt 中心点保持不动(图像点 round-trip);pan clamp 不出界;imageToCanvasNorm/canvasNormToImage round-trip。

三 view(camera_modes/app/overlay)的浏览器接线走人工验证。

## 8. 文件清单

- 新增 `label/src/scene/view_zoom.js`(纯函数,测)+ `label/tests/view_zoom.test.js`
- 改 `label/src/scene/camera_modes.js`(缩放状态 + 方法 + `_applyViewOffset` 重算 + 切 3D resetZoom + image↔canvas 映射)
- 改 `label/src/app.js`(2D 滚轮缩放、空白拖拽平移、root 深度改 Cmd/Ctrl+滚轮、切 3D resetZoom)
- 改 `label/src/edit/bbox_overlay.js`(映射改走 camera_modes 方法)
- 背景纹理过滤确认 `LinearFilter`(scene.js,放大不糊成块)
