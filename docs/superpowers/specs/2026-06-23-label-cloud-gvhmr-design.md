# Label 接入云端 GVHMR — 设计文档

日期: 2026-06-23
分支: `label-cloud-gvhmr`
范围: `label/` 标注器(2D 图像/视频)

## 1. 目标与动机

把 SMPL 标注从「Maya → 插件 → 脚本」的多环节流程,彻底搬到 Web 标注器内。本期为 `label/`
新增一个**云端 GVHMR 推理入口**:面向「图像/视频尚未标注或需修改标注」的场景,用户点一下按钮,
浏览器把当前帧图像(可选带 bbox)发给云端 GVHMR 服务,云端计算并返回 Global SMPL,结果更新到
系统人体。

本期连带解决一个既有局限:现有系统只能 **SMPL → 投影出 bbox**,bbox 是 SMPL 的下游;仅有图像、
还没有 SMPL 时无法产生 bbox。本期引入**新建 bbox 交互**(画布拖拽),使 bbox 可独立于 SMPL 存在。

**本期范围(经确认):**

- 仅实现**单帧**云端推理(对「当前显示的这一帧」生效);批量推理留出干净的函数边界,本期不实现。
- 两条链路各一个按钮:`☁ 纯图推理`(链路1,服务端 YOLO 自检)与 `☁ 带框推理`(链路2,带用户 bbox)。
- 云端地址默认 `http://10.52.104.78:8666/gvhmr/infer`,面板上可改。
- 浏览器**直连**云端(不走本地代理)。

## 2. 数据模型: bbox ⊥ SMPL(本期核心内核改动)

**原则: bbox 与 SMPL 完全独立。** 一条 annotation 由两个互不依赖的部分组成:

| 部分 | 字段 | 存在性 |
| --- | --- | --- |
| **bbox** | `bbox` | 可单独存在(画框 / 云端给框 / SMPL 投影填充) |
| **SMPL** | `root_pos` `root_rota` `body_pose` `betas` | 可单独存在 |

四种合法状态: ① 空 ② 仅 bbox ③ 仅 SMPL(投影自动补 bbox) ④ 两者都有。

**SMPL 存在性 = 位姿键是否存在。** 不引入任何附加 flag,不靠「位姿是否全零」猜测(零位姿是合法标注)。
键不存在即没有 SMPL;`serialize()` 对仅 bbox 帧**省略**位姿键。下游已确认能处理键省略。

### 2.1 `smpl_edit/coco_document.js` 改动

当前 `defaultAnnotation(imageId, nextId)` 一次性塞满 bbox + 一套零位姿 SMPL,这是
「只有 bbox 却带假 T-pose」的根因。改为**按需补字段**:

- 拆出 `SMPL_KEYS = ['root_pos','root_rota','body_pose','betas']`。
- `setAnnotation(imageId, fields)` 新建空骨架 annotation 时,**只写恒有的元字段**
  (`id/image_id/category_id/iscrowd/area/segmentation/...`),不预填 bbox,也不预填 SMPL 位姿。
  随后照常按 `EDITABLE` 把 `fields` 里**实际传入**的键写进去。
  → 只传 `{bbox}` 的帧就只有 bbox;只传位姿的帧就只有 SMPL。
- 新增 `hasSmpl(imageId)`: `body_pose` 键存在即为 true(以 `body_pose` 为代表键)。
- 新增 `hasBbox(imageId)`: `bbox` 键存在且非全 0(沿用现有「`[0,0,0,0]` 视为无框」约定)。
- `serialize()`: 维持「只输出存在键」语义。由于不再预填位姿,仅 bbox 帧自然不带位姿键。
  `keypoints`/`occlution_joint` 这类**派生字段**仅在该帧有 SMPL 时于保存阶段补算(见 §5)。

### 2.2 `smpl_edit/annotation_store.js` 改动

- `hasData()` → 保留但语义改为「有 bbox 或有 SMPL」,并新增 `hasSmpl()` / `hasBbox()` 转发到 doc。
- 新增 `setBbox(bbox)`: 走 `_txn`,只 `applyFields({bbox})`,**不碰 SMPL**。供画框 / 云端给框用。
- 新增 `applyCloudResult({bbox, root_pos, root_rota, body_pose, betas})`: 走 `_txn`,一次性覆盖
  云端返回的字段为**一个 undo 单元**。当前帧已有标注时直接覆盖(经确认:直接覆盖,可撤销)。
- `addTpose` / `addFromPrevious` 维持现状(它们显式写位姿,属于状态 ③/④)。

## 3. 画框交互(新建 bbox)

现有 `label/src/edit/bbox_overlay.js` 只能拖动**已有** bbox 的 4 个角。新增「空画布拖拽新建框」手势,
**在 BboxOverlay 内扩展**(经确认:扩展而非新模块,因映射/坐标逻辑已在此):

- 生效条件: `cam.mode === '2d'` 且 `ui.mode === 'bbox'` 且当前帧**无 bbox**(`!hasBbox`)且非只读。
- 手势: 画布 `pointerdown` 记起点 → `pointermove` 实时画矩形(像素 = `canvasNormToImage`)→
  `pointerup` 落框。位移 < 4px 视为点击,不建框。
- 落地: `store.setBbox([x,y,w,h])`(规范化为正的 w/h),一个 undo 单元;随后 `render` + 角点可拖。
- 与既有手势的协调: 新建手势只在「无 bbox」时抢 `pointerdown`;一旦有框,改走现有角点拖拽,
  空白处不再新建(避免误建)。需并入 `engageGuards`,使画框时画布平移/关节拾取让位。

> 注: app.js 中 2D 空白拖拽 = 平移视图(`pointerdown`/`panByCanvas`)。画框手势优先级要高于平移:
> 当处于「Bbox tab + 无框」时,空白拖拽用于画框,不平移。通过 `engageGuards.isEngaged()` 表达。

## 4. 云端 GVHMR 调用

### 4.1 新模块 `label/src/io/gvhmr_client.js`

把**纯逻辑**与**网络 I/O**分离(契合项目「纯逻辑单测、three/DOM 浏览器验证」约定):

纯函数(可单测):
- `buildPayload({imageB64, fileName, bbox})` → 链路1(无 bbox)或链路2(`bbox:[x,y,w,h]`)的请求体对象。
- `parseInferResponse(doc)` → 校验并抽出 `{ann, camK}`:
  `ann = doc.annotations[0]` 的 `{bbox, root_pos, root_rota, body_pose, betas}`;
  `camK = doc.images[0].cam_K`。维度校验(`body_pose.length===63`、`betas.length===10` 等),
  不符则抛带说明的错误。
- `cloudResultToFields(ann)` → 适配成 `AnnotationStore.applyCloudResult` 的字段对象。

I/O 包装(浏览器验证):
- `async function inferGvhmr({endpoint, imageB64, fileName, bbox, signal})`:`fetch` POST JSON,
  `Content-Type: application/json`,超时/取消用 `AbortController`。
  错误归类: HTTP 503 → 「服务繁忙,请稍后重试」;400 → 「请求无效(图像/bbox)」;
  网络错误 → 「无法连接云端,请检查地址/网络」。

### 4.2 取当前帧图像 base64

- 图像序列: `images.get(i)`(File)→ `arrayBuffer` → base64。
- 视频: 当前 `videoSource` 帧 → 离屏 canvas `toBlob`/`toDataURL` → base64。
- 单一来源: 永远取**当前显示帧**,不另存图像副本;base64 用完即弃(内存,见 §6)。

### 4.3 cam_K 处理(经确认的策略)

云端返回的 SMPL 在云端 `cam_K` 下成立。策略: **先采用云端 cam_K**,后续靠位移统一内参。
- 落地时把云端 `cam_K` 写入当前帧 `images[].cam_K`,并 `cam.setIntrinsics(camK)` 使投影对齐。
- 本期到此为止;「构建转换算法、通过位移调整统一内参」是后续迭代,本期只保证**当前帧投影对齐**。
- 唯一数据源: cam_K 的真相在 `images[].cam_K`;`cam.K` 是其运行时镜像(现有机制,沿用)。

## 5. 落地数据流(端到端)

```
[Bbox tab] 空画布拖拽 → store.setBbox()                    (状态②: 仅 bbox)
          ↓
[☁ 带框推理] 取当前帧 img→b64 + 当前 bbox → inferGvhmr(链路2)
[☁ 纯图推理] 取当前帧 img→b64           → inferGvhmr(链路1)
          ↓ 进度浮层(§7)
   parseInferResponse(doc) → {ann, camK}
          ↓
   store.applyCloudResult(cloudResultToFields(ann))        (状态④: 覆盖, 一个 undo 单元)
   images[currentId].cam_K = camK; cam.setIntrinsics(camK)
          ↓
   showFrame(current) → 渲染真实 SMPL + 投影 bbox
```

保存(`saveJson`)阶段维持现有派生逻辑,但**仅对有 SMPL 的帧**补算 `keypoints`/`occlution_joint`;
仅 bbox 帧只输出 bbox,不补派生位姿字段。

## 6. 内存管理

- base64 字符串与 `arrayBuffer` 为局部变量,函数返回即可回收;不缓存图像副本。
- 视频取帧用的离屏 canvas 复用单例或用后即弃,不每帧新建。
- `AbortController` 在请求结束/取消/组件失效时 abort,避免悬挂的 fetch 持有大 body。
- 不引入第二份图像/标注数据源: 图像仍来自 `images`/`videoSource`,标注仍来自 `store`(唯一)。

## 7. 进度与错误 UI

- 点击按钮后弹一个**进度浮层**(模态,覆盖画布):显示「云端推理中…」+ 旋转指示 + `取消` 按钮。
- `取消` → `AbortController.abort()`,关闭浮层,不改数据。
- 成功 → 关浮层,`setStatus('云端推理完成')`,刷新该帧。
- 失败 → 关浮层,`setStatus(归类后的中文错误)`,不改数据(失败安全)。
- 推理期间禁用导航/编辑入口,避免「结果回来时已不在原帧」错配(结果按发起时的帧 id 落地校验)。

## 8. 面板与按钮(`label/index.html` + `label/src/ui/panels.js`)

- Bbox tab 内或右栏新增一组「云端推理」控件:
  - 文本输入框「云端地址」,默认 `http://10.52.104.78:8666/gvhmr/infer`(可改,localStorage 记忆)。
  - 按钮 `☁ 纯图推理`(链路1,始终可用)。
  - 按钮 `☁ 带框推理`(链路2,当前帧**无 bbox 时禁用**)。
- 「✅ 本帧已标注 / — 本帧无标注」状态文案随 §2 拆分更新:
  区分「📦 仅框选」「🧍 已有 SMPL」「✅ 框 + SMPL」「— 空」。

## 9. 模块边界与依赖

| 单元 | 职责 | 依赖 |
| --- | --- | --- |
| `coco_document.js`(改) | bbox⊥SMPL 的存储/序列化;`hasSmpl/hasBbox` | 无(纯数据) |
| `annotation_store.js`(改) | `setBbox` / `applyCloudResult` / 拆分状态查询 | coco_document |
| `gvhmr_client.js`(新) | payload 构造 / 响应解析 / fetch I/O / 错误归类 | 无(纯 fetch) |
| `bbox_overlay.js`(改) | 新增「空画布拖拽新建框」手势 | camera, store |
| `app.js`(改) | 装配按钮/进度浮层/base64 提取/cam_K 落地 | 以上全部 |
| `panels.js` + `index.html`(改) | 云端地址输入 + 两个按钮 + 状态文案 | — |

## 10. 测试

纯逻辑单测(`node --test`):
- `coco_document.test.js`(扩展): 仅 bbox 帧不含位姿键;`hasSmpl/hasBbox` 四种状态;
  `serialize` 省略缺失键;`setAnnotation` 不再自动填位姿。
- `annotation_store.test.js`(扩展): `setBbox` 不动 SMPL;`applyCloudResult` 为单 undo 单元;
  undo 还原到调用前状态。
- `gvhmr_client.test.js`(新): `buildPayload` 链路1/链路2 分支;`parseInferResponse` 正常解析
  + 维度不符抛错 + 缺 annotations 抛错;`cloudResultToFields` 字段映射。

浏览器验证(无单测): 画框手势、进度浮层、fetch 实连云端、cam_K 投影对齐、视频取帧。

## 11. 非目标(本期不做)

- 批量/整段推理(仅留 `inferGvhmr` 函数边界,便于后续循环调用)。
- cam_K 的「位移统一内参」转换算法(本期只做当前帧对齐)。
- 多人(multi-person)推理结果(沿用 v1 单人,取 `annotations[0]`)。
- 本地服务器反向代理(本期浏览器直连)。
