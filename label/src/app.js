// label/src/app.js — M2: load, render, navigate, annotate (add/del/undo + display toggles).
import { loadModel } from '../../smpl_core/smpl_model.js';
import { BODY_ASSETS, createBody } from '../../smpl_core/body_model.js';
import { viewConfigOf } from './io/view_config.js';
import { CocoDocument } from '../../smpl_edit/coco_document.js';
import { bodyBounds, focusTarget } from '../../smpl_edit/framing.js';
import { assertHasContent, isPortrait } from './io/source_loader.js';
import { orderedImageNames, basename } from './io/image_order.js';
import { AnnotationStore } from '../../smpl_edit/annotation_store.js';
import { deriveFrame } from './edit/frame_derive.js';
import { createPoseState } from '../../smpl_edit/pose_state.js';
import { JointFigure } from '../../smpl_edit/joint_figure.js';
import { UIController } from '../../smpl_edit/ui_controller.js';
import { JointPicker } from '../../smpl_edit/joint_picker.js';
import { installRecorder } from '../../smpl_render/recorder.js';
import { CameraModes } from '../../smpl_render/camera_modes.js';
import { LabelScene } from './scene/scene.js';
import { Panels } from './ui/panels.js';
import { RootHandle } from '../../smpl_edit/root_handle.js';
import { GizmoSpace } from '../../smpl_edit/gizmo_space.js';
import { mountSpaceToggles } from '../../smpl_edit/space_toggle.js';
import { jointWorldQuat } from '../../smpl_edit/gizmo_frame.js';
import { PoseGizmo } from '../../smpl_edit/pose_gizmo.js';
import { installIK } from '../../smpl_edit/ik_plugin.js';
import { installGvhmr } from './gvhmr_plugin.js';
import { projectBboxFromMesh } from './edit/bbox_edit.js';
import { BboxOverlay } from './edit/bbox_overlay.js';
import { fsAccessSupported, pickDirectory, DirSource, videoOpenSupported, pickVideoFile, jsonOpenSupported, pickJsonFile } from './io/dir_source.js';
import { isCocoDoc } from './io/anno_validate.js';
import { VideoSource } from './io/video_source.js';
import { AnnoTimeline } from '../../smpl_edit/anno_timeline.js';
import { PersonPanel } from '../../smpl_edit/person_panel.js';
import { findMarked, countMarked, markedSummary } from '../../smpl_edit/frame_marks.js';
import { personLabel, inferPrimaryPath } from '../../smpl_edit/person_files.js';
import { loadPersonSet, addEmptyPerson, renumberPerson, savePersonSet, parsePersonId } from '../../smpl_edit/person_io.js';
import { bindShortcuts, shortcutHintHtml } from '../../smpl_edit/shortcuts.js';
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };

// Load a body model asset once, showing a download progress bar (SMPL ~19MB,
// MHR ~11MB, so first load over the network is noticeable). The overlay hides on finish.
async function loadModelWithProgress(url) {
  const box = $('loading'); const bar = $('loading-bar'); const txt = $('loading-text');
  if (box) box.hidden = false;
  try {
    return await loadModel(url, {
      onProgress: ({ loaded, total }) => {
        if (!bar) return;
        if (total > 0) {
          const pct = Math.min(100, Math.round((loaded / total) * 100));
          bar.style.width = `${pct}%`;
          if (txt) txt.textContent = `加载模型… ${pct}%`;
        } else if (txt) {
          txt.textContent = `加载模型… ${(loaded / 1048576).toFixed(1)} MB`;
        }
      },
    });
  } finally {
    if (box) box.hidden = true;
  }
}

const MODELS_DIR = new URL('../../smpl_web_viewer/public/models/', import.meta.url);
// 人体模型按数据集 info.body_model 选择(缺省 smpl),资产按名缓存;body = 当前 BodyModel。
// 关节数/骨骼/关节按钮/keypoints 槽位等全部来自 body 的配置,本文件不写死任何骨架。
const modelCache = new Map();
let body = null;
let scene = null, cam = null, store = null;
// 多相机/转正显示配置(来自数据 cameras[],下发时写定);单视角旧数据为 null。
// 多视角数据(cameras ≥ 2)不在本页标注,打开时引导到 /mhr_label/。
let viewCfg = null;
let images = new Map();      // index -> File
// 多人物:persons 持有全部人物(各自 store/undo),store 恒指向当前人物的 store。
// personSrc = 本次数据源的人物装载参数({ paths, primaryPath, readJson, fallbackRaw }),重置时原样重读。
let persons = null, personSrc = null;
let timeline = null, personPanel = null, personPanelKey = '';
let dirSource = null;
let videoSource = null;
let readOnly = false;
let textureLoader = null;
let currentTexture = null;
let playing = false;
let fps = 24;
let lastTick = 0;
let acc = 0;
let rotation = null;
let ui = null;
let jointPicker = null;
let jointGridButtons = [];   // = jointFigure.buttons()(数组身份不变,IK 插件持有引用)
let jointFigure = null;
let lastVertices = null;
let lastJoints = null;
let lastWorldRot = null;
let panels = null;
// 所有 SMPL 编辑手柄(整体/关节/IK)共用的参考系:世界轴 / 自身轴。
const gizmoSpace = new GizmoSpace();
mountSpaceToggles(gizmoSpace);
let rootHandle = null;
let poseGizmo = null;
let bboxOverlay = null;
let syncUI = null;
// 通用扩展点:插件(如 IK / 云端推理)通过 install 时注入。本体不出现任何插件专有名字。
//  - syncHooks:syncUI 末尾依次调用,任一返回 true 表示该插件接管了当前交互;
//  - dragGuards:模式/标签切换前聚合 isDragging() 拦截;
//  - engageGuards:相机锁 / 画布拾取聚合 isEngaged() 拦截;
//  - busyGuards:聚合 fn() —— 任一为 true 时本体禁用编辑入口(如 Ctrl+Z),供「忙态」插件用;
//  - pluginTabs:插件注册的额外 tab(mode → {label, panel}),并入 tabs/tabpanel 渲染。
let syncHooks = [];
let dragGuards = [];
let engageGuards = [];
let busyGuards = [];
let pluginTabs = [];
const handleScalers = [];   // 插件手柄(IK)的视图缩放补偿
let drawArmed = false;   // 「新建框」按钮按下后置真:允许在画布上拖出一个新框,画一次即复位
const isBusy = () => busyGuards.some((fn) => fn());
// ── 视图-模式互斥的单一事实源 ───────────────────────────────────────────────
// twoDOnlyModes:这些编辑模式依赖 2D 对齐视角(框交互/bbox 叠加层),3D 下无意义。
// 统一规则(避免散落的特判):
//   1) 3D 时这些 tab 一律 disabled(refreshTabAvailability);
//   2) 切到 3D 时若当前正处于其一,自动跳回安全模式 SAFE_MODE_3D;
//   3) bbox 叠加层仅在「当前模式 ∈ twoDOnlyModes 且视图(目标)为 2D」时显示。
// 'bbox' 是本体的;插件可经 registerTab({ requires2d:true }) 加入(如云端 'cloud')。
const twoDOnlyModes = new Set(['bbox']);
// 由「当前人体模型 / 数据配置」禁用的模式(如无体型参数、云端只出 SMPL、多相机暂无逐视角框)。
let configDisabledModes = new Set();
const SAFE_MODE_3D = 'root';   // 3D 下允许的默认模式(姿势/整体均可,取整体)
const bboxShownNow = () => !!ui && twoDOnlyModes.has(ui.mode);
// 编辑模式列表:本体四个 + 插件注册的额外 tab(registerTab 追加)。UIController 用它校验 setMode。
// 顺序即 tab 顺序;modes[0]('root')是默认进入的模式,需与 index.html 里 .tab.on 一致。
const editorModes = ['root', 'pose', 'bbox', 'beta'];

function isImageName(name) { return /\.(jpe?g|png|bmp)$/i.test(name); }

// 2D viewOffset 假缩放下 TC 的 size 公式不吃 viewOffset,手柄屏幕尺寸不随缩放变。
// 按 1/放大倍数 反向缩放手柄抵消(含「填满」裁剪带来的放大;3D 用真相机,size 公式自适应 → 复位为 1)。
function syncHandleScale() {
  const s = cam ? cam.handleScale() : 1;
  poseGizmo?.setHandleScale(s);
  rootHandle?.setHandleScale(s);
  handleScalers.forEach((fn) => fn(s));
}

// 切 2D/3D 后重排画布:3D 用 fill(填满容器)、2D 用 letterbox(图像比例),由
// scene.resize() 经 intendedMode() 分派。不重排则 canvas 仍是上一模式尺寸 →
// 3D 视野被旧画布框死(与 viewer 模式切换 resize 对齐)。随后刷新 bbox/手柄。
function onModeSwitched() {
  scene.resize();
  if (bboxOverlay) bboxOverlay.render(bboxShownNow() ? (store?.current()?.bbox ?? null) : null);
  syncHandleScale();
  syncViewTools();
}

// 显示旋转(画面 ⟲/⟳):只转视图相机绕光轴的朝向,数据、内参、派生量都按原生像素(docs/CONTRACTS.md §4)。
// 3D 环绕的上方向与地面网格随之转,同点云页的上轴设置。按数据集记在本机浏览器。
let viewRotKey = null;
function restoreViewRotation(coco) {
  const ids = coco.imageIds();
  viewRotKey = 'label:view-rotation:' + JSON.stringify([coco.imageInfo(ids[0])?.file_name ?? '', ids.length, cam.imageW, cam.imageH]);
  let n = 0;
  try { n = Number(localStorage.getItem(viewRotKey)) || 0; } catch { /* 存储被禁用时用 0° */ }
  applyViewRotation(n, { save: false });
}
function applyViewRotation(n, { save = true } = {}) {
  cam.setViewRotation(n);
  scene.setGridFrame(cam.viewRollWorldQuat());
  if (save && viewRotKey) { try { localStorage.setItem(viewRotKey, String(cam.viewRotation())); } catch { /* 只影响本次页面 */ } }
  onModeSwitched();
  syncViewTools();
}
function syncViewTools() {
  if (!cam) return;
  $('view-rot-label').textContent = `${cam.viewRotation() * 90}°`;
  const cover = cam.coverActive();
  $('view-fit').classList.toggle('on', cover);
  $('view-fit').title = cover ? '2D 填满视口(裁掉多出的方向),点击显示全幅' : '2D 显示全幅,点击填满视口';
  $('view-fit').disabled = cam.intendedMode() !== '2d';
}

// 姿态 tab 的关节选择:人形图 + 分组按钮,由 body 配置生成(smpl_edit/joint_figure.js)。
function buildJointGrid() { jointFigure.setBody(body); }

function setPlaying(on) {
  playing = on && store && store.frameCount() > 0;
  if (playing) { poseGizmo?.detach(); rootHandle?.detach(); }
  $('btn-play').textContent = playing ? '⏸ 暂停' : '▶ 播放';
  $('btn-play').classList.toggle('on', playing);
}

// 两条 open 路径(目录/视频 与 本地文件)的公共尾段:校验内容、竖拍 gate、装配
// store/ui/slider/right/model/scene,并显示首帧。调用方各自先准备好 coco/background
// 以及 images(Map)或 videoSource(模块级变量),mountDataset 不触碰它们。
async function mountDataset({ background, hint = {} }) {
  const coco = store.document();
  const ids = coco.imageIds();
  // 「有可标注内容」按全部人物合计:任一人物任一帧有标注即算。
  const dataFrameIndices = ids.map((_, idx) => (persons.list().some((p) => p.store.hasDataAt(idx)) ? idx : -1)).filter((x) => x >= 0);
  assertHasContent({ bgCount: background ? background.count : 0, dataFrameIndices, hint });
  const info = coco.imageInfo(ids[0]);
  await applyDocConfig(coco);
  // 竖拍拦截只针对旧单视角数据;带 cameras(含转正配置)的数据由配置负责显示方向。
  readOnly = !viewCfg && info ? isPortrait(info) : false;
  if (readOnly) setStatus('⚠ 该数据为竖拍/旋转,标注器仅支持查看;请用其他软件转正后再标注');
  ui = new UIController({ readOnly, modes: editorModes });
  if (syncUI) ui.onChange(syncUI);
  drawArmed = false;   // 切换数据集时复位画框武装态,避免残留到新数据
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
  $('slider').value = '0';
  $('right').classList.remove('disabled');
  // 让相机学习本数据集的真实图像尺寸(否则一切按写死的 1920×1080,非该分辨率时
  // 主点 cx/cy 落错像素 → 人体朝左上偏、且相对焦距偏小)。优先用 json 的 width/height,
  // 否则解码首帧/取视频尺寸。cx=W/2、cy=H/2 居中,焦距保持工厂默认(用户可在面板微调)。
  if (viewCfg) {
    // 多相机:视图相机(已含转正)= 标定内参 + 外参位姿,不猜主点。
    cam.configureForImage({ width: viewCfg.width, height: viewCfg.height, ...viewCfg.K });
  } else {
    const dims = await resolveImageDims(info);
    if (dims) cam.configureForImage(dims);
    else cam.resetIntrinsics();
  }
  const pose = viewCfg ? viewCfg.pose : { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
  cam.setViewPose(pose);
  scene.setDataCamera(cam.viewPose(), viewCfg ? viewCfg.rotationDeg : 0);
  restoreViewRotation(coco);
  cam.resetZoom();
  scene.prepareForSequence({ K: cam.K, image_w: cam.imageW, image_h: cam.imageH });
  cam.snapTo('2d');
  scene.resize();
  await showFrame(0);
  if (syncUI) syncUI();
  if (!readOnly) setStatus(`已加载 ${store.frameCount()} 帧 · ${marksSummary()}${personSrc?.skipped?.length ? ` · ⚠ 跳过非标注格式: ${personSrc.skipped.join(', ')}` : ''}`);
}

// 按当前文档装载人体模型与显示配置。人体模型变了才重建场景骨架与关节按钮。
// 页面按人体模型划分:本页只标 SMPL,MHR 数据引导到 /mhr_label/。视角数不是划分依据;
// SMPL 多视角(cameras ≥ 2)将来在本页支持,目前先明确拒绝。
async function applyDocConfig(coco) {
  const name = coco.bodyModelName();
  if (name !== 'smpl') throw new Error(`这是 ${name.toUpperCase()} 数据,请用「MHR 标注器」页面 /mhr_label/ 打开`);
  const cams = coco.cameras();
  if (cams && cams.length > 1) throw new Error(`这是 SMPL 多视角数据(${cams.map((c) => c.id).join(' / ')}),本页暂只支持单视角`);
  if (!body || body.name !== name) {
    if (!modelCache.has(name)) modelCache.set(name, await loadModelWithProgress(new URL(BODY_ASSETS[name], MODELS_DIR)));
    setBody(createBody(name, modelCache.get(name)));
  }
  viewCfg = viewConfigOf({ cameras: cams, images: coco.images() });
  configDisabledModes = new Set([
    ...(body.canEditPose ? [] : ['pose']),
    ...(body.shapeGroups?.length ? [] : ['beta']),
    ...(body.cloudInference ? [] : ['cloud']),
    // 带标定相机的数据:框由人体网格投影派生,不手画;云端只认无外参的单相机。
    ...(viewCfg ? ['bbox', 'cloud'] : []),
  ]);
}

// 换 BodyModel:场景骨架、关节按钮、体型面板一起重建。
function setBody(next) {
  body = next;
  scene.setBody(body);
  buildJointGrid();
  panels?.setBody(body);
}

// 按 personSrc 装载全部人物(player_N 同族文件);一份都没有时 0 号人物用 fallbackRaw()(空帧轴)。
// keepId:重置时尽量留在原人物上。
async function loadPersons(fallbackRaw, keepId = null) {
  const r = await loadPersonSet({ paths: personSrc.getPaths(), primaryPath: personSrc.primaryPath, readJson: personSrc.readJson, fallbackRaw });
  persons = r.persons; personSrc.skipped = r.skipped;
  watchStores();
  if (keepId != null && persons.has(keepId)) persons.select(keepId);
  store = persons.current().store;
  personPanelKey = '';
}

const synthDocFromNames = (names) => ({ images: names.map((nm, i) => ({ id: i, file_name: nm })), annotations: [], categories: [] });
const synthDocFromCount = (n) => ({ images: Array.from({ length: n }, (_, i) => ({ id: i })), annotations: [], categories: [] });

// 解析数据集首帧的真实像素尺寸。来源优先级:json images[0].width/height →
// 解码首帧图像 File → videoSource 尺寸。拿不到返回 null(回退工厂默认)。
async function resolveImageDims(info) {
  if (info && Number.isFinite(info.width) && Number.isFinite(info.height)
      && info.width > 0 && info.height > 0) {
    return { width: info.width, height: info.height };
  }
  if (videoSource && videoSource.width > 0) {
    return { width: videoSource.width, height: videoSource.height };
  }
  const file = images.get(0);
  if (file) {
    try { return await decodeImageDims(file); } catch (_) { /* fall through */ }
  }
  return null;
}

// 用 createImageBitmap 读 File 的自然像素尺寸(不渲染、不占显存)。
async function decodeImageDims(file) {
  const bmp = await createImageBitmap(file);
  const dims = { width: bmp.width, height: bmp.height };
  bmp.close();
  return dims;
}

async function openFiles(fileList) {
  dirSource = null;
  videoSource?.dispose();
  videoSource = null;
  images = new Map();
  const files = Array.from(fileList ?? []);
  const byPath = new Map(files.map((f) => [f.webkitRelativePath || f.name, f]));
  const jsonPaths = [...byPath.keys()].filter((p) => /\.json$/i.test(p));
  // 主标注:player_0.json > 由任一 player_N 推出的 0 号 > 任意 json;都没有则保存时下载 player_0.json。
  const primaryPath = jsonPaths.find((p) => basename(p) === 'player_0.json') ?? inferPrimaryPath(jsonPaths) ?? jsonPaths[0] ?? 'player_0.json';
  personSrc = {
    getPaths: () => jsonPaths, primaryPath,
    readJson: async (p) => { const f = byPath.get(p); return f ? JSON.parse(await f.text()) : null; },
    writeJson: async (p, obj) => { downloadJson(basename(p), obj); return `${basename(p)}(已下载)`; },
    removeFile: null,   // 内存 FileList 无法删盘:保存时提示用户手动删
  };
  const imageFiles = files.filter((f) => isImageName(f.name));
  // basename -> File lookup (no positional ordering; ordering comes from
  // orderedImageNames so the background follows the json's images[] order).
  const byName = new Map(imageFiles.map((f) => [basename(f.name), f]));
  const availableNames = imageFiles.map((f) => f.name);

  // data-less: synthesize images[] from a NUMERIC sort of the image files so
  // imageIds()/positions line up with the background ordering below.
  await loadPersons(() => synthDocFromNames(orderedImageNames({ cocoImages: [], availableNames })));

  // Authoritative frame ordering: follows json images[] when file_names exist,
  // else the numeric-sorted synthesized order. Match each frame's background by
  // basename rather than by sorted position.
  const names = orderedImageNames({ cocoImages: store.document().images(), availableNames });
  names.forEach((nm, i) => images.set(i, byName.get(basename(nm)) ?? null));
  const bgCount = names.length;
  const background = bgCount ? { kind: 'image_sequence', count: bgCount } : null;

  const hasManifest = files.some((f) => basename(f.webkitRelativePath || f.name) === 'manifest.json');
  await mountDataset({ background, hint: { hasManifest } });
}

async function openFromDirSource(opts = {}) {
  images = new Map();
  if (videoSource) { videoSource.dispose(); videoSource = null; }
  const cls = dirSource.classification;
  const src = dirSource;
  // 主标注路径:已有 json > 由任一 player_N 推出的 0 号 > 新建时的写入路径。其余人物同族 player_N。
  personSrc = {
    getPaths: () => src.paths,
    primaryPath: cls.jsonPath ?? inferPrimaryPath(src.paths) ?? cls.writeJsonPath,
    readJson: (p) => src.readJsonAt(p),
    writeJson: (p, obj) => src.writeFile(p, JSON.stringify(obj, null, 2)),
    removeFile: (p) => src.removeFile(p),
  };

  const availableNames = cls.imagePaths ?? [];
  let bgCount = 0;
  let backgroundKind = 'image_sequence';
  if (!availableNames.length && cls.videoPath) {
    let videoFile = await dirSource.videoFile();
    if (!videoFile && opts.videoFileOverride) videoFile = opts.videoFileOverride;
    if (videoFile) {
      videoSource = await new VideoSource(videoFile, { fps }).ready();
      bgCount = videoSource.frameCount();
    }
    backgroundKind = 'video';
  }
  // data-less: synthesize images[] from a NUMERIC sort so positions line up(视频则按帧数)。
  await loadPersons(() => (availableNames.length
    ? synthDocFromNames(orderedImageNames({ cocoImages: [], availableNames }))
    : synthDocFromCount(bgCount)));
  // 带单个标定相机的数据:视频与帧率由 cameras[0] 指定。
  const cams = store.document().cameras();
  if (cams?.length === 1 && cams[0].video && !availableNames.length) {
    const f = await dirSource.readFile(cams[0].video);
    if (!f) throw new Error(`数据指定的视频不存在: ${cams[0].video}`);
    videoSource?.dispose();
    videoSource = await new VideoSource(f, { fps: cams[0].fps > 0 ? cams[0].fps : fps }).ready();
    bgCount = store.frameCount();
    backgroundKind = 'video';
  }
  if (availableNames.length) {
    // Authoritative ordering: json images[] when file_names exist, else numeric
    // sort. Match each frame's background file by basename, not by position.
    const names = orderedImageNames({ cocoImages: store.document().images(), availableNames });
    for (let i = 0; i < names.length; i++) images.set(i, await dirSource.imageFileByName(names[i]));
    bgCount = names.length;
  }
  const background = bgCount ? { kind: backgroundKind, count: bgCount } : null;

  await mountDataset({ background, hint: { hasManifest: !!cls.hasManifest } });
}

async function openDirectoryData() {
  const h = await pickDirectory();
  dirSource = new DirSource(h);
  await dirSource.scan();
  await openFromDirSource();
}

async function openVideoData() {
  const v = await pickVideoFile();
  setStatus('请选择该视频所在的文件夹(用于读写标注)');
  const parent = await pickDirectory();
  dirSource = new DirSource(parent);
  await dirSource.scan({ videoName: v.name });
  await openFromDirSource({ videoFileOverride: v });
}

// 前向输入 = 标注里该模型的全部参数键,旋转部分以姿态编辑状态(四元数权威)为准。
function bodyFields(a) {
  const f = {};
  for (const k of body.fieldKeys) f[k] = a[k];
  return f;
}
function buildFrame() {
  return { ...bodyFields(store.current()), ...rotation.toAxisAngle() };
}

function applyAnnotation() {
  if (!rotation || !store.current()) return;
  const out = body.forward(buildFrame(), { worldRot: true });
  lastVertices = out.vertices;
  lastJoints = out.joints;
  lastWorldRot = out.worldRot;
  rootHandle?.syncFromState(); poseGizmo?.syncFromState();
  scene.updateMesh(out.vertices, out.joints);
  const r = body.rootJoint * 3;
  cam.set3DFollowTarget(new THREE.Vector3(out.joints[r], out.joints[r + 1], out.joints[r + 2]));
  scene.setFollowCenter(lastJoints ? (bodyBounds(lastJoints)?.center ?? null) : null);
  if (panels) panels.syncFromState();
  if (bboxOverlay) bboxOverlay.render(store.current()?.bbox ?? null);
  refreshMarks();   // 拖拽中改动 → 人物列表的未保存标记(*)即时更新(掩码按 revision 缓存,开销很小)
}

// 有/无标注条 + 人物列表:掩码按 store.revision 缓存,逐帧调用只是重画一条 canvas。
function refreshMarks() {
  if (!persons || !store) return;
  const curId = persons.currentId();
  const list = persons.list();
  timeline?.setData({
    n: store.frameCount(), current: store.currentFrame(),
    rows: list.map((p) => ({ mask: p.store.annotatedMask(), active: p.id === curId, label: personLabel(p.id) })),
  });
  const rows = list.map((p) => ({ id: p.id, count: countMarked(p.store.annotatedMask()), dirty: persons.dirty(p) }));
  const key = JSON.stringify([curId, rows]);
  if (key !== personPanelKey) { personPanelKey = key; personPanel?.render(rows, curId); }
}

function marksSummary() {
  return markedSummary(persons.list().map((p) => ({ label: personLabel(p.id), count: countMarked(p.store.annotatedMask()) })));
}

function renderAnnoActions() {
  refreshMarks();
  const host = $('anno-actions'); if (!host) return;
  const has = store && store.hasData();
  const hasB = store && store.hasBbox();
  const hasS = store && store.hasSmpl();
  const who = persons && persons.size() > 1 ? `${personLabel(persons.currentId())} ` : '';
  const B = body ? body.name.toUpperCase() : '人体';
  $('anno-state').textContent = !store ? '—'
    : (hasB && hasS) ? `✅ ${who}框 + ${B}`
    : hasS ? `🧍 ${who}已有 ${B}`
    : hasB ? `📦 ${who}仅框选(可云端推理)`
    : `— ${who}本帧无标注`;
  host.innerHTML = '';
  if (!store || ui?.readOnly) return;
  const row = document.createElement('div'); row.className = 'row'; host.appendChild(row);
  const mk = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; row.appendChild(b); };
  if (has) {
    mk('🗑 删除本帧标注', '', () => { store.deleteCurrent(); showFrame(store.currentFrame()); });
  } else {
    mk('＋ 新建:T-pose', 'primary', () => { store.addTpose(); showFrame(store.currentFrame()); });
    mk('＋ 复制上一帧', '', () => { store.addFromPrevious(); showFrame(store.currentFrame()); });
  }
}

async function showFrame(i) {
  store.setFrame(i);
  $('slider').value = String(i);
  timeline?.setCurrent(i);
  $('frame-info').textContent = `${i + 1} / ${store.frameCount()}`; // 1-based 显示;内部仍 0-based(对齐不变)
  const a = store.current();
  if (a && store.hasSmpl()) {
    rotation = createPoseState(body, a);
    applyAnnotation();
    scene.setPersonVisible(true);
  } else {
    rotation = null;
    lastVertices = null;
    lastJoints = null;
    lastWorldRot = null;
    scene.setPersonVisible(false);
    if (panels) panels.syncFromState();
    if (bboxOverlay) bboxOverlay.render(a && store.hasBbox() ? a.bbox : null);
  }
  renderAnnoActions();
  if (videoSource) {
    const di = viewCfg ? viewCfg.decodeIndex(i) : i;   // 帧位置 → 该相机视频解码序号
    if (di == null) scene.setBackgroundTexture(null);
    else { await videoSource.seek(di); scene.setBackgroundTexture(videoSource.texture); }
  } else {
    const file = images.get(i);
    if (file) {
      const url = URL.createObjectURL(file);
      textureLoader ||= new THREE.TextureLoader();
      textureLoader.load(url, (tex) => {
        URL.revokeObjectURL(url);
        if (currentTexture) currentTexture.dispose();
        currentTexture = tex;
        scene.setBackgroundTexture(tex);
      });
    }
  }
  // Re-sync ALL visuals (gizmos, panels, bbox, highlight, anno-actions) to the
  // restored state. This is the single source of truth for visual sync and is
  // what makes Undo / frame navigation move the editing primitives, not just
  // the mesh. State-driven only — does NOT pause playback (see syncUI).
  if (syncUI) syncUI();
}

// 派生量(2D 关键点 / 遮挡 / 多相机逐视角框)在帧「定稿」时单帧计算并缓存进文档(见 frame_derive.js),
// 保存只序列化。定稿事件可能连发(撤销连按),合并到下一个宏任务里算;保存前 flush。
const watchedStores = new WeakSet();
const pendingDerive = new Map();   // store → Set(imageId)
let deriveTimer = null;

function watchStores() {
  for (const p of persons?.list() ?? []) {
    if (watchedStores.has(p.store)) continue;
    watchedStores.add(p.store);
    const s = p.store;
    s.onCommitted((id) => {
      if (!pendingDerive.has(s)) pendingDerive.set(s, new Set());
      pendingDerive.get(s).add(id);
      deriveTimer ??= setTimeout(flushDerived, 0);
    });
  }
}

// 派生量以文档主相机 cameras[0] 为准,与用户此刻选哪个主视角、是否在 3D 环绕无关。
function derivationViews(doc) {
  const cams = doc.cameras();
  if (!cams) return [{ cameraId: null, project: cam.K, camPos: [0, 0, 0] }];
  return cams.map((c) => ({ cameraId: c.id, cfg: viewConfigOf({ cameras: cams, images: doc.images() }, c.id) }));
}

function flushDerived() {
  clearTimeout(deriveTimer); deriveTimer = null;
  for (const [s, ids] of pendingDerive) {
    const doc = s.document();
    const views = derivationViews(doc);
    const order = doc.imageIds();
    for (const id of ids) {
      const a = doc.getAnnotation(id);
      if (!a || !doc.hasSmpl(id)) continue;   // 仅 bbox 帧:无人体,无派生量
      const out = body.forward(bodyFields(a));
      s.setDerived(id, deriveFrame(body, out, views, order.indexOf(id)));
    }
  }
  pendingDerive.clear();
}

function downloadJson(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  URL.revokeObjectURL(url);
}

// 保存:当前人物 + 所有有未保存修改的人物各写回自己的文件(player_N 同族),并删掉已删除人物的文件。
// 原地写回（已具抗只读重建）；写入仍抛异常时把当前人物退回下载，避免标注丢失。
async function saveJson() {
  if (!persons || !body) return;
  flushDerived();
  try {
    const { written, removed } = await savePersonSet(persons, {
      serialize: (s) => s.document().serialize(),
      writeJson: personSrc.writeJson,
      removeFile: personSrc.removeFile,
    });
    const rmNote = removed.length ? (personSrc.removeFile ? ` · 已删除 ${removed.join(', ')}` : ` · ⚠ 请手动删除 ${removed.join(', ')}`) : '';
    setStatus(`${dirSource ? '已保存' : '⚠ 当前浏览器不支持原地保存,已下载'} ${written.join(', ')}${rmNote}${dirSource ? '' : ' — 请手动覆盖回数据目录(原地保存请用 Chrome/Edge)'}`);
  } catch (e) {
    console.warn('原地保存失败，退回下载：', e);
    const p = persons.current();
    downloadJson(basename(p.path), p.store.document().serialize());
    setStatus(`⚠ 原地保存失败（${e?.name || e}），改为下载 ${basename(p.path)} — 请手动覆盖回数据目录`);
  }
  personPanelKey = ''; refreshMarks();
}

// 手动加载标注 JSON：整份替换【当前人物】的标注，保存仍写回该人物的文件。
// 需先打开数据（store 存在）；保留当前帧。
async function loadAnnotationJson(file) {
  if (!store) { setStatus('请先打开数据（目录/视频）'); return; }
  const raw = JSON.parse(await file.text());
  if (!isCocoDoc(raw)) { setStatus('该文件不是 SMPL 标注（COCO）格式，未加载'); return; }
  const at = store.currentFrame();   // 新 store 从 0 帧起，先记住当前帧再重建以保留
  const p = persons.replaceStore(persons.currentId(), new AnnotationStore(new CocoDocument(raw)));
  watchStores();
  store = p.store;
  await applyDocConfig(store.document());
  ui = new UIController({ readOnly, modes: editorModes });
  if (syncUI) ui.onChange(syncUI);
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
  await showFrame(Math.min(at, store.frameCount() - 1));
  setStatus(`已加载标注 JSON（${file.name}）到 ${personLabel(p.id)} — 保存写回 ${p.path}`);
}

// 重置:丢弃全部人物的未保存修改(含新建/改号/删除),从同源重读;源里没有 json 时 = 清空(空帧轴沿用当前)。
// 不复用 mountDataset:本函数语义是"重读同源并保留当前帧",不应重置相机
// (snapTo/resize/prepareForSequence)或跳回第 0 帧,故保留独立装配。
async function resetFromDisk() {
  if (!store || !personSrc) return;
  if (persons.anyDirty() && !window.confirm('丢弃所有人物的未保存修改(含新建/改号/删除),重新读取?')) return;
  const at = store.currentFrame();
  const base = store.document().serialize();
  await loadPersons(() => ({ images: base.images ?? [], annotations: [], categories: base.categories ?? [] }), persons.currentId());
  ui = new UIController({ readOnly, modes: editorModes });
  if (syncUI) ui.onChange(syncUI);
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
  await showFrame(Math.min(at, store.frameCount() - 1));
  setStatus(`已重置 · ${marksSummary()}`);
}

const isDragging = () => dragGuards.some((g) => g.isDragging());

// 切换/新建/改号/删除人物后的公共收尾:store 指向新的当前人物,停在原帧重绘。
async function afterPersonChange(msg) {
  const at = store.currentFrame();
  store = persons.current().store;
  store.setFrame(Math.min(at, store.frameCount() - 1));
  drawArmed = false;
  if (ui?.mode === 'pose') ui.clearSelection();   // 关节选择不跨人物沿用
  await showFrame(store.currentFrame());
  if (msg) setStatus(msg);
}

function selectPerson(id) {
  if (!persons || isDragging() || isBusy()) return;
  persons.select(id, store.currentFrame());
  afterPersonChange(`当前人物: ${personLabel(id)}`);
}

function addPerson() {
  if (!persons || isDragging() || isBusy()) return;
  if (ui?.readOnly) { setStatus('只读数据不可增删改人物'); return; }
  const p = addEmptyPerson(persons, personSrc.primaryPath, store.currentFrame());
  watchStores();
  afterPersonChange(`已新建 ${personLabel(p.id)}(未保存,将写入 ${p.path})`);
}

function renumberCurrent(id) {
  if (!persons || isDragging() || isBusy()) return;
  if (ui?.readOnly) { setStatus('只读数据不可增删改人物'); return; }
  const text = window.prompt(`把 ${personLabel(id)} 改为几号?(文件名随之改为 player_N)`, String(persons.nextId()));
  if (text == null) return;
  try {
    const n = parsePersonId(text, persons);
    const p = renumberPerson(persons, personSrc.primaryPath, id, n);
    afterPersonChange(`已改号 ${personLabel(id)} → ${personLabel(n)}(保存后写入 ${p.path})`);
  } catch (e) { setStatus(String(e.message ?? e)); }
}

function removePerson(id) {
  if (!persons || isDragging() || isBusy()) return;
  if (ui?.readOnly) { setStatus('只读数据不可增删改人物'); return; }
  if (!window.confirm(`删除 ${personLabel(id)}?\n其标注文件将在「保存」时删除;保存前可「重置」反悔。`)) return;
  try { persons.remove(id); } catch (e) { setStatus(String(e.message ?? e)); return; }
  afterPersonChange(`已删除 ${personLabel(id)}(保存后生效)`);
}

// 上/下一个有标注帧(当前人物;口径同 hasData:框或 SMPL)。
function jumpMarked(dir) {
  if (!store) return;
  setPlaying(false);
  const j = findMarked(store.annotatedMask(), store.currentFrame(), dir);
  if (j < 0) { setStatus(dir > 0 ? '后面没有已标注帧' : '前面没有已标注帧'); return; }
  showFrame(j);
}

function boot() {
  scene = new LabelScene($('c'));
  cam = new CameraModes({ canvas: $('c'), meta: { K: { fx: 1850, fy: 1850, cx: 960, cy: 540 }, image_w: 1920, image_h: 1080 } });
  scene.setCamera(cam);
  cam.onSettled = () => onModeSwitched();   // 2D↔3D 动画结束:画布按目标模式重排(2D 留边/填满),框与手柄重画
  $('btn-open').addEventListener('click', (e) => {
    if (!fsAccessSupported()) { $('dir-input').click(); return; }
    e.stopPropagation();
    const m = $('open-menu'); m.hidden = !m.hidden;
  });
  // Click anywhere outside closes the popup menu.
  document.addEventListener('click', (e) => {
    const m = $('open-menu');
    if (!m || m.hidden) return;
    if (!e.target.closest('.menu-anchor')) m.hidden = true;
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const m = $('open-menu'); if (m) m.hidden = true; } });
  // 加载失败:除提示外把场景复位成「明确空白」,避免半初始化的黑屏被当成卡死。
  const onLoadError = (e) => {
    if (e?.name === 'AbortError') return;
    setStatus(String(e?.message ?? e));
    if (scene) { scene.setBackgroundTexture(null); scene.setPersonVisible(false); }
    $('right').classList.add('disabled');
  };
  $('open-dir').addEventListener('click', () => {
    $('open-menu').hidden = true;
    openDirectoryData().catch(onLoadError);
  });
  $('open-video').addEventListener('click', () => {
    $('open-menu').hidden = true;
    if (!videoOpenSupported()) { setStatus('当前浏览器不支持打开视频文件,请用 Chrome/Edge'); return; }
    openVideoData().catch(onLoadError);
  });
  $('open-json').addEventListener('click', () => {
    $('open-menu').hidden = true;
    if (!store) { setStatus('请先打开数据（目录/视频）'); return; }
    if (jsonOpenSupported()) {
      pickJsonFile().then((f) => loadAnnotationJson(f)).catch(onLoadError);
    } else { $('json-input').click(); }
  });
  $('json-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0]; if (f) loadAnnotationJson(f).catch(onLoadError);
    e.target.value = '';
  });
  $('dir-input').addEventListener('change', (e) => openFiles(e.target.files).catch(onLoadError));
  $('btn-2d').addEventListener('click', () => { if (dragGuards.some((g) => g.isDragging())) return; cam.switchTo('2d'); $('btn-2d').classList.add('on'); $('btn-3d').classList.remove('on'); onModeSwitched(); refreshTabAvailability(); if (syncUI) syncUI(); });
  $('btn-3d').addEventListener('click', () => { if (dragGuards.some((g) => g.isDragging())) return; cam.switchTo('3d'); $('btn-3d').classList.add('on'); $('btn-2d').classList.remove('on'); leave2dOnlyModeIfNeeded(); onModeSwitched(); refreshTabAvailability(); if (syncUI) syncUI(); });
  $('slider').addEventListener('input', (e) => { if (!store) return; setPlaying(false); showFrame(+e.target.value); });
  $('btn-prev').addEventListener('click', () => { if (!store) return; setPlaying(false); showFrame(Math.max(0, store.currentFrame() - 1)); });
  $('btn-next').addEventListener('click', () => { if (!store) return; setPlaying(false); showFrame(Math.min(store.frameCount() - 1, store.currentFrame() + 1)); });
  $('btn-play').addEventListener('click', () => { if (store) setPlaying(!playing); });
  $('speed').addEventListener('input', (e) => { fps = +e.target.value; $('speed-val').textContent = `${fps} fps`; });
  // 有/无标注条(点/拖跳帧)+ 上/下一有标注帧;人物面板(切换/新建/改号/删除)。
  timeline = new AnnoTimeline({
    host: $('anno-timeline'),
    onSeek: (i) => { if (!store) return; setPlaying(false); showFrame(i); },
    onJump: jumpMarked,
  });
  personPanel = new PersonPanel({ host: $('person-panel'), onSelect: selectPerson, onAdd: addPerson, onRenumber: renumberCurrent, onRemove: removePerson });
  window.addEventListener('beforeunload', (e) => { if (persons?.anyDirty()) { e.preventDefault(); e.returnValue = ''; } });

  $('btn-undo').addEventListener('click', () => { if (store) { store.undo(); showFrame(store.currentFrame()); } });
  // 快捷键:与 pcd_label / mhr_label 同一张表(smpl_edit/shortcuts.js)。
  const shortcutActions = {
    undo: () => { store.undo(); showFrame(store.currentFrame()); },
    play: () => setPlaying(!playing),
    prevFrame: () => $('btn-prev').click(),
    nextFrame: () => $('btn-next').click(),
    prevMarked: () => jumpMarked(-1),
    nextMarked: () => jumpMarked(+1),
    focus: () => {
      const who = persons ? personLabel(persons.currentId()) : '人物';
      const sel = ui?.mode === 'pose' && ui.selectedJoint != null ? body.poseJoints[ui.selectedJoint] : null;
      const t = focusTarget(lastJoints, sel, sel == null ? 1 : body.jointScale(sel));
      if (!t) { setStatus(`本帧 ${who} 无人体，无可居中`); return; }
      const what = t.kind === 'joint' ? `${who} 的 ${body.poseLabels[ui.selectedJoint]}` : who;
      setStatus(cam.focusOn(t.center, t.radius) ? `已居中 ${what}` : '2D 对齐视角不居中，切到 3D 后按 F');
    },
    reset: () => {
      if (cam.mode !== '2d') { setStatus('3D 视角按 F 居中;R 复位 2D 对齐视角的缩放/平移'); return; }
      cam.resetZoom(); syncHandleScale();
      if (bboxOverlay) bboxOverlay.render(bboxShownNow() ? (store?.current()?.bbox ?? null) : null);
      setStatus(cam.coverActive() ? '已复位 2D 缩放/平移(填满视口)' : '已复位 2D 缩放/平移');
    },
  };
  bindShortcuts({ actions: shortcutActions, enabled: (a) => !!store && !isBusy() && (a === 'play' || a === 'undo' || !isDragging()) });
  document.querySelector('#kbd-hint .kbd-hint-body').innerHTML = shortcutHintHtml(shortcutActions, ['2D:滚轮缩放 · 空白处拖动平移 · <b>Alt+滚轮</b> 调深度']);
  $('kbd-hint-toggle').addEventListener('click', () => {
    const min = $('kbd-hint').classList.toggle('min');
    $('kbd-hint-toggle').textContent = min ? '▸' : '▾';
  });

  const toggle = (id, key) => $(id).addEventListener('click', () => {
    const on = !$(id).classList.contains('on');
    $(id).classList.toggle('on', on);
    scene.setFlag(key, on);
  });
  toggle('t-mesh', 'mesh'); toggle('t-points', 'points'); toggle('t-bones', 'bones');
  toggle('t-grid', 'grid'); toggle('t-axes', 'axes'); toggle('t-bg', 'bg');
  $('mesh-opacity').addEventListener('input', (e) => scene.setMeshOpacity(+e.target.value));

  // --- Task 8: panels, gizmos, tabs, joint grid, canvas picking ---
  jointFigure = new JointFigure({
    figureHost: $('joint-figure'), gridHost: $('joint-grid'),
    onSelectPose: (k) => { setPlaying(false); ui && ui.selectJoint(k); },
    onPick: (j) => { if (!ui) return; setPlaying(false); if (j === body.rootJoint) ui.setMode('root'); else ui.selectJoint(body.poseJoints.indexOf(j)); },
  });
  jointGridButtons = jointFigure.buttons();
  panels = new Panels({
    getRotation: () => rotation,
    getStore: () => store,
    getCam: () => cam,
    getUI: () => ui,
    getLastJoints: () => lastJoints,
    getBody: () => body,
    onEdit: applyAnnotation,
  });

  // Tab buttons. bindTab 既用于本体四个静态 tab,也用于插件 registerTab 动态追加的 tab。
  const bindTab = (btn) => btn.addEventListener('click', () => {
    if (btn.disabled) return;
    if (dragGuards.some((g) => g.isDragging())) return;
    // Switching into an editing tab pauses playback (user-initiated edit entry).
    if (btn.dataset.mode === 'root' || btn.dataset.mode === 'pose') setPlaying(false);
    if (ui) ui.setMode(btn.dataset.mode);
  });
  document.querySelectorAll('#tabs .tab').forEach(bindTab);

  // 插件 tab 注册扩展点:追加一个互斥编辑 tab(标签按钮 + 面板),并入 editorModes/
  // tabs/tabpanel 渲染。requires2d:true 表示该 tab 依赖 2D 视角(并入 twoDOnlyModes,
  // 享受统一互斥规则:3D 禁用 + 自动跳离 + bbox 显示门控)。返回 { remove } 供卸载。
  function registerTab({ mode, label, buildPanel, requires2d = false }) {
    editorModes.push(mode);
    if (requires2d) twoDOnlyModes.add(mode);
    const btn = document.createElement('button');
    btn.className = 'tab'; btn.dataset.mode = mode; btn.textContent = label;
    $('tabs').appendChild(btn);
    bindTab(btn);
    const panel = document.createElement('section');
    panel.className = 'tabpanel'; panel.dataset.mode = mode; panel.hidden = true;
    $('right').appendChild(panel);
    if (buildPanel) buildPanel(panel);
    pluginTabs.push({ mode, btn, panel });
    return { remove() {
      const i = editorModes.indexOf(mode); if (i >= 0) editorModes.splice(i, 1);
      twoDOnlyModes.delete(mode);
      btn.remove(); panel.remove();
      pluginTabs = pluginTabs.filter((t) => t.mode !== mode);
    } };
  }

  jointPicker = new JointPicker({
    canvas: $('c'),
    camera: cam.camera,
    getJointMeshes: () => scene.jointMeshes(),
    // 拾取到骨架关节 j:根关节 → 整体模式;姿态关节 → 选中对应按钮(姿态 tab 可用时)。
    onPick: (j) => {
      setPlaying(false);
      if (j === body.rootJoint) { ui.setMode('root'); return; }
      const k = body.poseJoints.indexOf(j);
      if (k >= 0 && !configDisabledModes.has('pose')) ui.selectJoint(k);
    },
    // 点人体网格 = 调整整体;点人体以外 = 取消调整(收起手柄,视角自由拖动)。见 docs/CONTRACTS.md。
    getBodyMesh: () => scene.meshObject(),
    onPickBody: () => { setPlaying(false); ui.setMode('root'); },
    onMiss: () => ui?.release(),
    canPick: () => !engageGuards.some((g) => g.isEngaged()),
  });

  rootHandle = new RootHandle({
    scene: scene.threeScene(),
    camera: cam.camera,
    canvas: $('c'),
    getStore: () => store,
    getRotation: () => rotation,
    onEdit: applyAnnotation,
    space: gizmoSpace,
  });
  poseGizmo = new PoseGizmo({
    scene: scene.threeScene(),
    camera: cam.camera,
    canvas: $('c'),
    getRotation: () => rotation,
    getStore: () => store,
    onEdit: applyAnnotation,
    space: gizmoSpace,
  });
  bboxOverlay = new BboxOverlay({
    stageEl: $('stage'),
    canvasEl: $('c'),
    getCam: () => cam,
    getStore: () => store,
    getBboxVisible: () => bboxShownNow(),
    // 画框入口由「新建框」按钮显式开启(drawArmed),避免空画布误触;画一次即关闭。
    getCanDraw: () => drawArmed && !!store && ui?.mode === 'bbox' && cam?.mode === '2d'
      && !ui?.readOnly && !store.hasBbox(),
    onEdit: () => { drawArmed = false; applyAnnotation(); if (syncUI) syncUI(); },
  });

  // 本体两个编辑基元并入通用守卫聚合(插件会各自再 push 自己的手柄)。
  dragGuards.push(poseGizmo, rootHandle);
  engageGuards.push(poseGizmo, rootHandle);
  dragGuards.push(bboxOverlay);
  engageGuards.push(bboxOverlay);

  // ui.onChange fires whenever mode/joint changes → sync tabs, panels, gizmos.
  // 3D 视角下禁用所有「2D-only」tab(框/云端等);单一规则,新插件 tab 自动纳入。
  function refreshTabAvailability() {
    const is3d = cam.intendedMode() === '3d';
    document.querySelectorAll('#tabs .tab').forEach((b) => {
      b.disabled = configDisabledModes.has(b.dataset.mode) || (twoDOnlyModes.has(b.dataset.mode) && is3d);
    });
  }

  // 切到 3D 时,若当前正处于某个 2D-only 模式,自动跳回 3D 下安全模式(避免停在
  // 一个已禁用且无意义的 tab)。在 cam.switchTo('3d') 之后、syncUI 之前调用。
  function leave2dOnlyModeIfNeeded() {
    if (ui && twoDOnlyModes.has(ui.mode)) { drawArmed = false; ui.setMode(SAFE_MODE_3D); }
  }

  syncUI = () => {
    if (!ui) return;
    if (configDisabledModes.has(ui.mode)) { drawArmed = false; ui.setMode('root'); return; }   // setMode 触发 onChange → 重入 syncUI
    refreshTabAvailability();
    document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('on', b.dataset.mode === ui.mode));
    document.querySelectorAll('.tabpanel').forEach((p) => { p.hidden = p.dataset.mode !== ui.mode; });
    jointGridButtons.forEach((b, j) => b.classList.toggle('on', ui.mode === 'pose' && ui.selectedJoint === j));
    jointFigure.setSelected(ui.mode === 'root' ? body?.rootJoint : ui.mode === 'pose' && ui.selectedJoint != null ? body.poseJoints[ui.selectedJoint] : null);
    $('sel-joint').textContent = ui.selectedJoint == null ? '未选择关节' : `已选择: ${body.poseLabels[ui.selectedJoint]}`;
    const prb = $('pose-rot-block'); if (prb) prb.hidden = !(ui.mode === 'pose' && ui.selectedJoint != null);
    scene.setSelectedJoint(ui.mode === 'pose' && ui.selectedJoint != null ? body.poseJoints[ui.selectedJoint] : -1);
    if (jointPicker) jointPicker.setEnabled(ui.mode === 'pose' || ui.mode === 'root');

    // Exactly one interaction at a time. Gizmo attach is STATE-DRIVEN and safe
    // to run every frame (incl. undo/showFrame): it never pauses playback.
    // Pausing playback on edit-entry is handled by user-action handlers
    // (joint grid / picker / tab / root sub-mode), not here.
    // 先让扩展插件(如 IK)有机会接管当前交互;任一 hook 返回 true 即接管,
    // 本体不再挂自己的 gizmo,只 detach。否则维持原 pose / root / 兜底逻辑。
    let claimed = false;
    for (const h of syncHooks) { if (h()) claimed = true; }
    if (claimed) {
      poseGizmo.detach();
      rootHandle.detach();
    } else if (!playing && ui.mode === 'pose' && ui.selectedJoint != null && rotation && lastWorldRot) {
      const j = ui.selectedJoint;                 // 姿态按钮序号 = 姿态编辑状态的关节序号
      const sj = body.poseJoints[j];              // 对应骨架关节
      const qParentWorld = jointWorldQuat(lastWorldRot, body.parents[sj]);
      poseGizmo.attach(j, scene.jointWorldPosition(sj), qParentWorld);
      rootHandle.detach();
    } else if (!playing && ui.mode === 'root' && !ui.released && store && store.current()) {
      rootHandle.attach(store.current().root_pos);
      poseGizmo.detach();
    } else {
      poseGizmo.detach();
      rootHandle.detach();
    }
    bboxOverlay.render(bboxShownNow() ? (store?.current()?.bbox ?? null) : null);
    syncHandleScale(); // gizmo 刚 attach 后按当前 2D 缩放校正手柄大小(3D 复位为 1)
    renderAnnoActions();
    panels.syncFromState();
  };

  // Root translate/rotate sub-mode buttons (inside the root tabpanel).
  $('root-translate').addEventListener('click', () => {
    setPlaying(false);
    if (ui?.released) ui.setMode('root'); rootHandle.setMode('translate');
    $('root-translate').classList.add('on');
    $('root-rotate').classList.remove('on');
    if (syncUI) syncUI();
  });
  $('root-rotate').addEventListener('click', () => {
    setPlaying(false);
    if (ui?.released) ui.setMode('root'); rootHandle.setMode('rotate');
    $('root-rotate').classList.add('on');
    $('root-translate').classList.remove('on');
    if (syncUI) syncUI();
  });

  // 从当前帧已渲染的人体网格投影出一个紧框,写入 bbox(一个 undo 单元)。
  // 供「⌖ 从人体投影」按钮与云端纯图推理后自动补框复用。需先有 SMPL(lastVertices)。
  function autoBboxFromMesh() {
    if (!store || !store.current() || ui?.readOnly || !lastVertices) return false;
    store.beginEdit();
    store.applyFields({ bbox: projectBboxFromMesh(lastVertices, cam.K) });
    store.commitEdit();
    panels.syncFromState();
    if (bboxOverlay) bboxOverlay.render(bboxShownNow() ? (store.current()?.bbox ?? null) : null);
    return true;
  }

  $('btn-bbox-auto').addEventListener('click', autoBboxFromMesh);

  // 「新建框」:武装画框态(仅当前帧无框时有意义),用户随后在画布上拖出一个框。
  $('btn-bbox-new').addEventListener('click', () => {
    if (!store || ui?.readOnly) return;
    if (store.hasBbox()) { setStatus('本帧已有框,可拖四角调整'); return; }
    if (cam.mode !== '2d') { cam.switchTo('2d'); $('btn-2d').classList.add('on'); $('btn-3d').classList.remove('on'); refreshTabAvailability(); }
    setPlaying(false);
    drawArmed = true;
    setStatus('在画面上拖出一个方框');
    if (syncUI) syncUI();
  });

  // 2D 滚轮:裸滚轮 = 以光标为中心缩放视图(viewOffset,不改内外参/数据);
  // Cmd(Mac)/Ctrl(其他)+ 滚轮 = 调 root 深度(整体/移动模式,低频,让位给缩放)。
  // 3D 模式不拦截滚轮(留给 OrbitControls dolly)。全平台:deltaY + deltaMode 归一化。
  let wheelTimer = null;
  $('c').addEventListener('wheel', (e) => {
    if (!cam || cam.mode !== '2d') return;
    // Z 深度统一用 Alt+滚轮(跨平台一致)。双指张合/滚轮(mac 带 ctrl/meta、win 纯 deltaY)
    // 一律走画面缩放,不再被 ctrl/meta 误判为深度调节。
    const depthMod = e.altKey;
    const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1);
    const dy = e.deltaY * unit;

    if (!depthMod) {
      // 先算归一化光标位置并判越界:在 letterbox 黑边滚轮时直接 return,
      // 不 preventDefault,放行页面滚动(避免吞掉滚动却不缩放)。
      const rect = $('c').getBoundingClientRect();
      const u = (e.clientX - rect.left) / rect.width;
      const v = (e.clientY - rect.top) / rect.height;
      if (u < 0 || u > 1 || v < 0 || v > 1) return; // 光标在 letterbox 黑边,放行页面滚动
      e.preventDefault();
      const factor = Math.exp(-dy * 0.0015); // 上滚放大、下滚缩小
      cam.zoomAt(u, v, factor);
      syncHandleScale(); // 2D viewOffset 假缩放下,手柄按 1/zoom 反向缩放保持屏幕大小恒定
      if (bboxOverlay) bboxOverlay.render(store?.current()?.bbox ?? null);
      return;
    }

    // depthMod 分支:2D 下用户已按 Alt,先 preventDefault 吞掉浏览器默认行为,
    // 再判是否满足 root 深度调节条件;不满足则 return(但已阻止默认缩放)。
    e.preventDefault();
    if (!store || !store.current() || ui?.readOnly) return;
    if (!(ui.mode === 'root' && $('root-translate').classList.contains('on'))) return;
    const a = store.current();
    const pos = (a.root_pos || [0, 0, 0]).slice();
    pos[2] += (dy > 0 ? 1 : -1) * 0.05;
    if (wheelTimer === null) store.beginEdit();
    store.applyFields({ root_pos: pos });
    applyAnnotation();
    if (rootHandle) rootHandle.attach(pos);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { store.commitEdit(); wheelTimer = null; }, 250);
  }, { passive: false });

  // 2D 空白拖拽 = 平移视图。命中手柄(engageGuards 任一 engaged)让位手柄;
  // 纯点击(位移<4px)不平移,让 jointPicker 的空白点选(取消选中)正常触发。
  let panStart = null, panning = false;
  $('c').addEventListener('pointerdown', (e) => {
    if (!cam || cam.mode !== '2d' || engageGuards.some((g) => g.isEngaged())) { panStart = null; return; }
    panStart = { x: e.clientX, y: e.clientY, id: e.pointerId }; panning = false;
  });
  $('c').addEventListener('pointermove', (e) => {
    if (!panStart) return;
    const rect = $('c').getBoundingClientRect();
    if (!panning && Math.hypot(e.clientX - panStart.x, e.clientY - panStart.y) > 4) {
      panning = true; $('c').setPointerCapture(panStart.id);
    }
    if (!panning) return;
    const du = (e.clientX - panStart.x) / rect.width;
    const dv = (e.clientY - panStart.y) / rect.height;
    panStart.x = e.clientX; panStart.y = e.clientY;
    cam.panByCanvas(du, dv);
    if (bboxOverlay) bboxOverlay.render(store?.current()?.bbox ?? null);
  });
  const endPan = (e) => { if (panning) { try { $('c').releasePointerCapture(e.pointerId); } catch (_) {} } panStart = null; panning = false; };
  $('c').addEventListener('pointerup', endPan);
  $('c').addEventListener('pointercancel', endPan);

  // Save / Reset (#btn-save / #btn-reset) — Task 10.
  $('btn-save').addEventListener('click', () => saveJson().catch((e) => setStatus(String(e))));
  $('btn-reset').addEventListener('click', () => resetFromDisk().catch((e) => setStatus(String(e))));

  window.addEventListener('resize', () => onModeSwitched());
  $('view-rot-ccw').addEventListener('click', () => { if (store && !isDragging()) applyViewRotation(cam.viewRotation() - 1); });
  $('view-rot-cw').addEventListener('click', () => { if (store && !isDragging()) applyViewRotation(cam.viewRotation() + 1); });
  $('view-fit').addEventListener('click', () => {
    if (!store || cam.intendedMode() !== '2d') return;
    cam.setFitMode(cam.coverActive() ? 'contain' : 'cover');
    onModeSwitched();
  });

  // 安装 IK 插件(可插拔):本体只此一行,通过 ctx 注入扩展点;
  // 置 IK_ENABLED=false(或删此块)即彻底拆除 IK,本体不受影响。
  // 必须在 jointGridButtons 构造之后、syncUI 定义之后、首帧 loop 之前。
  const renderHooks = new Set();
  const IK_ENABLED = true;
  if (IK_ENABLED) {
    installIK({
      scene, camera: cam.camera, canvas: $('c'), controls: cam.controls,
      getMode: () => cam.mode, getStore: () => store, getRotation: () => rotation,
      getLastJoints: () => lastJoints, getLastWorldRot: () => lastWorldRot,
      getUI: () => ui, getParents: () => body && body.parents, isPlaying: () => playing,
      getSkeleton: () => body?.ikSkeleton ?? null,
      onEdit: applyAnnotation, jointGridButtons, setStatus,
      requestSync: () => { if (syncUI) syncUI(); },
      toggleButton: $('ik-toggle'),
      gizmoSpace,
      registerSyncHook: (fn) => syncHooks.push(fn),
      registerRenderHook: (fn) => { renderHooks.add(fn); return () => renderHooks.delete(fn); },
      registerGuard: (g) => { dragGuards.push(g); engageGuards.push(g); },
      registerHandleScale: (fn) => handleScalers.push(fn),
    });
  }

  // 安装云端 GVHMR 推理插件(可插拔):本体只此一行,DOM(独立 tab + 进度浮层)与
  // 逻辑全由插件自建;通过 ctx 注入扩展点。置 GVHMR_ENABLED=false 即彻底拆除,本体不受影响。
  const GVHMR_ENABLED = true;
  if (GVHMR_ENABLED) {
    installGvhmr({
      getCam: () => cam, getStore: () => store, getUI: () => ui,
      getVideoEl: () => (videoSource ? videoSource.videoEl : null),
      getCurrentImageFile: () => images.get(store.currentFrame()) ?? null,
      getCurrentFileName: () => {
        const file = videoSource ? null : images.get(store.currentFrame());
        return file ? file.name : `frame_${store.currentFrame()}.jpg`;
      },
      setStatus, setPlaying, showFrame,
      // 云端纯图推理(无框输入)落地后,从新人体投影一个紧框,使框立即可视/可用。
      projectBboxFromMesh: () => autoBboxFromMesh(),
      requestSync: () => { if (syncUI) syncUI(); },
      registerTab,
      registerSyncHook: (fn) => syncHooks.push(fn),
      registerGuard: (g) => { dragGuards.push(g); engageGuards.push(g); },
      registerBusyGuard: (fn) => busyGuards.push(fn),
    });
  }

  // 录制视图区(左下角 ●):停止后下载视频。
  const recorder = installRecorder({ canvas: $('c'), frame: $('stage'), name: 'label', corner: 'bottom-left' });
  function loop(now) {
    if (playing && store && store.frameCount() > 0) {
      acc += now - lastTick;
      const interval = 1000 / fps;
      if (acc >= interval) {
        acc %= interval;
        const next = (store.currentFrame() + 1) % store.frameCount();
        showFrame(next);
      }
    }
    lastTick = now;
    const gizmoBusy = engageGuards.some((g) => g.isEngaged());
    if (cam) cam.controls.enabled = (cam.mode === '3d') && !gizmoBusy;
    for (const hook of renderHooks) hook();
    if (cam?.isAnimating()) syncHandleScale();   // 切换动画中手柄的屏幕大小随投影连续变化
    scene.render();   // scene.render() calls cam.update() internally
    recorder?.afterRender();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame((now) => { lastTick = now; loop(now); });
}
boot();
