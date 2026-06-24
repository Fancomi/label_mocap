// label/src/app.js — M2: load, render, navigate, annotate (add/del/undo + display toggles).
import { loadModel } from '../../smpl_core/smpl_model.js';
import { forwardSmpl } from '../../smpl_core/lbs.js';
import { mat3ToQuat } from '../../smpl_core/rotations.js';
import { JOINT_NAMES } from '../../smpl_core/joint_names.js';
import { CocoDocument } from '../../smpl_edit/coco_document.js';
import { assertHasContent, isPortrait } from './io/source_loader.js';
import { orderedImageNames, basename } from './io/image_order.js';
import { AnnotationStore } from '../../smpl_edit/annotation_store.js';
import { reprojectKeypoints } from './edit/derived.js';
import { computeOcclusion } from './edit/occlusion_raycast.js';
import { RotationState } from '../../smpl_edit/rotation_state.js';
import { UIController } from '../../smpl_edit/ui_controller.js';
import { JointPicker } from '../../smpl_edit/joint_picker.js';
import { CameraModes } from './scene/camera_modes.js';
import { LabelScene } from './scene/scene.js';
import { Panels } from './ui/panels.js';
import { RootHandle } from '../../smpl_edit/root_handle.js';
import { PoseGizmo } from '../../smpl_edit/pose_gizmo.js';
import { installIK } from '../../smpl_edit/ik_plugin.js';
import { installGvhmr } from './gvhmr_plugin.js';
import { projectBboxFromMesh } from './edit/bbox_edit.js';
import { BboxOverlay } from './edit/bbox_overlay.js';
import { fsAccessSupported, pickDirectory, DirSource, videoOpenSupported, pickVideoFile } from './io/dir_source.js';
import { VideoSource } from './io/video_source.js';
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };

// Load the SMPL model once, showing a download progress bar (the .bin is ~19MB,
// so first load over the network is noticeable). The overlay hides on finish.
async function loadModelWithProgress() {
  const box = $('loading'); const bar = $('loading-bar'); const txt = $('loading-text');
  if (box) box.hidden = false;
  try {
    return await loadModel(MODEL_URL, {
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

const MODEL_URL = new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url);
let model = null, scene = null, cam = null, store = null;
let images = new Map();      // index -> File
let loadedJsonFile = null;   // raw json File, for Reset-from-disk
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
let jointGridButtons = [];
let lastVertices = null;
let lastJoints = null;
let lastWorldRot = null;
let panels = null;
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
const SAFE_MODE_3D = 'root';   // 3D 下允许的默认模式(姿势/整体均可,取整体)
const bboxShownNow = () => !!ui && twoDOnlyModes.has(ui.mode);
// 编辑模式列表:本体四个 + 插件注册的额外 tab(registerTab 追加)。UIController 用它校验 setMode。
// 顺序即 tab 顺序;modes[0]('root')是默认进入的模式,需与 index.html 里 .tab.on 一致。
const editorModes = ['root', 'pose', 'bbox', 'beta'];

function isJpeg(name) { return /\.(jpe?g)$/i.test(name); }

function setPlaying(on) {
  playing = on && store && store.frameCount() > 0;
  if (playing) { poseGizmo?.detach(); rootHandle?.detach(); }
  $('btn-play').textContent = playing ? '⏸ 暂停' : '▶ 播放';
  $('btn-play').classList.toggle('on', playing);
}

// 两条 open 路径(目录/视频 与 本地文件)的公共尾段:校验内容、竖拍 gate、装配
// store/ui/slider/right/model/scene,并显示首帧。调用方各自先准备好 coco/background
// 以及 images(Map)或 videoSource(模块级变量),mountDataset 不触碰它们。
async function mountDataset({ coco, background }) {
  const ids = coco.imageIds();
  const dataFrameIndices = ids.map((id, idx) => (coco.getAnnotation(id) ? idx : -1)).filter((x) => x >= 0);
  assertHasContent({ bgCount: background ? background.count : 0, dataFrameIndices });
  const info = coco.imageInfo(ids[0]);
  readOnly = info ? isPortrait(info) : false;
  if (readOnly) setStatus('⚠ 该数据为竖拍/旋转,标注器仅支持查看;请用其他软件转正后再标注');
  store = new AnnotationStore(coco);
  ui = new UIController({ readOnly, modes: editorModes });
  if (syncUI) ui.onChange(syncUI);
  drawArmed = false;   // 切换数据集时复位画框武装态,避免残留到新数据
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
  $('slider').value = '0';
  $('right').classList.remove('disabled');
  if (!model) { model = await loadModelWithProgress(); scene.setTopology(model.faces); }
  // 让相机学习本数据集的真实图像尺寸(否则一切按写死的 1920×1080,非该分辨率时
  // 主点 cx/cy 落错像素 → 人体朝左上偏、且相对焦距偏小)。优先用 json 的 width/height,
  // 否则解码首帧/取视频尺寸。cx=W/2、cy=H/2 居中,焦距保持工厂默认(用户可在面板微调)。
  const dims = await resolveImageDims(info);
  if (dims) cam.configureForImage(dims);
  else cam.resetIntrinsics();
  cam.resetZoom();
  scene.prepareForSequence({ K: cam.K, image_w: cam.imageW, image_h: cam.imageH });
  cam.snapTo('2d');
  scene.resize();
  await showFrame(0);
  if (syncUI) syncUI();
}

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
  const jsonFile = files.find((f) => f.name.endsWith('.json'));
  loadedJsonFile = jsonFile ?? null;
  const imageFiles = files.filter((f) => isJpeg(f.name));
  // basename -> File lookup (no positional ordering; ordering comes from
  // orderedImageNames so the background follows the json's images[] order).
  const byName = new Map(imageFiles.map((f) => [basename(f.name), f]));
  const availableNames = imageFiles.map((f) => f.name);

  let coco = null;
  if (jsonFile) {
    coco = new CocoDocument(JSON.parse(await jsonFile.text()));
  }
  if (!coco) {
    // data-less: synthesize images[] from a NUMERIC sort of the image files so
    // imageIds()/positions line up with the background ordering below.
    const names = orderedImageNames({ cocoImages: [], availableNames });
    coco = new CocoDocument({ images: names.map((nm, i) => ({ id: i, file_name: nm })), annotations: [], categories: [] });
  }

  // Authoritative frame ordering: follows json images[] when file_names exist,
  // else the numeric-sorted synthesized order. Match each frame's background by
  // basename rather than by sorted position.
  const names = orderedImageNames({ cocoImages: coco.images(), availableNames });
  names.forEach((nm, i) => images.set(i, byName.get(basename(nm)) ?? null));
  const bgCount = names.length;
  const background = bgCount ? { kind: 'image_sequence', count: bgCount } : null;

  await mountDataset({ coco, background });
}

async function openFromDirSource(opts = {}) {
  loadedJsonFile = null;
  images = new Map();
  if (videoSource) { videoSource.dispose(); videoSource = null; }
  const cls = dirSource.classification;

  let coco = null;
  const rawJson = await dirSource.readJson();
  if (rawJson) coco = new CocoDocument(rawJson);

  const availableNames = cls.imagePaths ?? [];
  let bgCount = 0;
  let backgroundKind = 'image_sequence';
  let names = [];
  if (availableNames.length) {
    if (!coco) {
      // data-less: synthesize images[] from a NUMERIC sort so positions line up.
      const synth = orderedImageNames({ cocoImages: [], availableNames });
      coco = new CocoDocument({ images: synth.map((nm, i) => ({ id: i, file_name: nm })), annotations: [], categories: [] });
    }
    // Authoritative ordering: json images[] when file_names exist, else numeric
    // sort. Match each frame's background file by basename, not by position.
    names = orderedImageNames({ cocoImages: coco.images(), availableNames });
    for (let i = 0; i < names.length; i++) images.set(i, await dirSource.imageFileByName(names[i]));
    bgCount = names.length;
  } else if (cls.videoPath) {
    let videoFile = await dirSource.videoFile();
    if (!videoFile && opts.videoFileOverride) videoFile = opts.videoFileOverride;
    if (videoFile) {
      videoSource = await new VideoSource(videoFile, { fps }).ready();
      bgCount = videoSource.frameCount();
    }
    backgroundKind = 'video';
  }
  const background = bgCount ? { kind: backgroundKind, count: bgCount } : null;

  if (!coco) {
    coco = new CocoDocument({ images: Array.from({ length: bgCount }, (_, i) => ({ id: i })), annotations: [], categories: [] });
  }

  await mountDataset({ coco, background });
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

function buildFrame() {
  const a = store.current();
  const { root_rota, body_pose } = rotation.toAxisAngle();
  return { root_pos: a.root_pos, root_rota, body_pose, betas: a.betas };
}

function applyAnnotation() {
  if (!rotation || !store.current()) return;
  const out = forwardSmpl(model, buildFrame(), { worldRot: true });
  lastVertices = out.vertices;
  lastJoints = out.joints;
  lastWorldRot = out.worldRot;
  scene.updateMesh(out.vertices, out.joints);
  cam.set3DFollowTarget(new THREE.Vector3(out.joints[0], out.joints[1], out.joints[2]));
  if (panels) panels.syncFromState();
  if (bboxOverlay) bboxOverlay.render(store.current()?.bbox ?? null);
}

function renderAnnoActions() {
  const host = $('anno-actions'); if (!host) return;
  const has = store && store.hasData();
  const hasB = store && store.hasBbox();
  const hasS = store && store.hasSmpl();
  $('anno-state').textContent = !store ? '—'
    : (hasB && hasS) ? '✅ 框 + SMPL'
    : hasS ? '🧍 已有 SMPL'
    : hasB ? '📦 仅框选(可云端推理)'
    : '— 本帧无标注';
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
  $('frame-info').textContent = `${i} / ${store.frameCount() - 1}`;
  const a = store.current();
  if (a && store.hasSmpl()) {
    rotation = RotationState.fromAxisAngle({ root_rota: a.root_rota, body_pose: a.body_pose });
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
    await videoSource.seek(i);
    scene.setBackgroundTexture(videoSource.texture);
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

async function saveJson() {
  if (!store || !model) return;
  const doc = store.document();
  for (const id of doc.imageIds()) {
    const a = doc.getAnnotation(id);
    if (!a || !doc.hasSmpl(id)) continue;   // 仅 bbox 帧:保留框,不补算 SMPL 派生字段
    const out = forwardSmpl(model, { root_pos: a.root_pos, root_rota: a.root_rota, body_pose: a.body_pose, betas: a.betas });
    const keypoints = reprojectKeypoints(out.joints, cam.K, 52);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(out.vertices, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(model.faces), 1));
    const tmpMesh = new THREE.Mesh(g);
    const occ = computeOcclusion(out.joints, tmpMesh, cam.camera, 52);
    g.dispose();
    tmpMesh.material.dispose();
    doc.setAnnotation(id, { keypoints, occlution_joint: occ });
  }
  const obj = doc.serialize();
  if (dirSource) {
    const path = await dirSource.saveJson(obj);
    setStatus(`已保存 ${path}`);
  } else {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'player_0.json'; link.click();
    URL.revokeObjectURL(url);
    setStatus('⚠ 当前浏览器不支持原地保存,已下载 player_0.json — 请手动覆盖回数据目录(原地保存请用 Chrome/Edge)');
  }
}

async function resetFromDisk() {
  // 不复用 mountDataset:本函数语义是"重读同源并保留当前帧",不应重置相机
  // (snapTo/resize/prepareForSequence)或跳回第 0 帧,故保留独立装配。
  if (!store) return;
  if (dirSource) {
    const raw = await dirSource.readJson();
    if (raw) {
      store = new AnnotationStore(new CocoDocument(raw));
    } else {
      // 目录里没有 json:重置 = 清空所有标注(回到「未标注」空白态),而不是保留内存里的。
      store = new AnnotationStore(emptyCocoLike(store.document()));
    }
    ui = new UIController({ readOnly, modes: editorModes });
    if (syncUI) ui.onChange(syncUI);
  } else if (loadedJsonFile) {
    const coco = new CocoDocument(JSON.parse(await loadedJsonFile.text()));
    store = new AnnotationStore(coco);
    ui = new UIController({ readOnly, modes: editorModes });
    if (syncUI) ui.onChange(syncUI);
  } else {
    // 无 json 来源(纯图像/视频):重置 = 清空所有标注。
    store = new AnnotationStore(emptyCocoLike(store.document()));
    ui = new UIController({ readOnly, modes: editorModes });
    if (syncUI) ui.onChange(syncUI);
  }
  await showFrame(Math.min(store.currentFrame(), store.frameCount() - 1));
  setStatus('已重置');
}

// 构造一个保留 images[](帧序/尺寸/file_name)但 annotations 全空的 CocoDocument,
// 用于「无 json 来源时」重置 → 清空全部标注。沿用原 images 以保持帧数与背景对齐。
function emptyCocoLike(doc) {
  const raw = doc.serialize();
  return new CocoDocument({ images: raw.images ?? [], annotations: [], categories: raw.categories ?? [] });
}

function boot() {
  scene = new LabelScene($('c'));
  cam = new CameraModes({ canvas: $('c'), meta: { K: { fx: 1850, fy: 1850, cx: 960, cy: 540 }, image_w: 1920, image_h: 1080 } });
  scene.setCamera(cam);
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
  $('open-dir').addEventListener('click', () => {
    $('open-menu').hidden = true;
    openDirectoryData().catch((e) => { if (e?.name !== 'AbortError') setStatus(String(e)); });
  });
  $('open-video').addEventListener('click', () => {
    $('open-menu').hidden = true;
    if (!videoOpenSupported()) { setStatus('当前浏览器不支持打开视频文件,请用 Chrome/Edge'); return; }
    openVideoData().catch((e) => { if (e?.name !== 'AbortError') setStatus(String(e)); });
  });
  $('dir-input').addEventListener('change', (e) => openFiles(e.target.files).catch((err) => setStatus(String(err))));
  $('btn-2d').addEventListener('click', () => { if (dragGuards.some((g) => g.isDragging())) return; cam.switchTo('2d'); $('btn-2d').classList.add('on'); $('btn-3d').classList.remove('on'); refreshTabAvailability(); if (syncUI) syncUI(); });
  $('btn-3d').addEventListener('click', () => { if (dragGuards.some((g) => g.isDragging())) return; cam.switchTo('3d'); $('btn-3d').classList.add('on'); $('btn-2d').classList.remove('on'); leave2dOnlyModeIfNeeded(); refreshTabAvailability(); if (syncUI) syncUI(); });
  $('slider').addEventListener('input', (e) => { if (!store) return; setPlaying(false); showFrame(+e.target.value); });
  $('btn-prev').addEventListener('click', () => { if (!store) return; setPlaying(false); showFrame(Math.max(0, store.currentFrame() - 1)); });
  $('btn-next').addEventListener('click', () => { if (!store) return; setPlaying(false); showFrame(Math.min(store.frameCount() - 1, store.currentFrame() + 1)); });
  $('btn-play').addEventListener('click', () => { if (store) setPlaying(!playing); });
  $('speed').addEventListener('input', (e) => { fps = +e.target.value; $('speed-val').textContent = `${fps} fps`; });

  $('btn-undo').addEventListener('click', () => { if (store) { store.undo(); showFrame(store.currentFrame()); } });
  window.addEventListener('keydown', (e) => { if (store && !isBusy() && (e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); store.undo(); showFrame(store.currentFrame()); } });

  const toggle = (id, key) => $(id).addEventListener('click', () => {
    const on = !$(id).classList.contains('on');
    $(id).classList.toggle('on', on);
    scene.setFlag(key, on);
  });
  toggle('t-mesh', 'mesh'); toggle('t-points', 'points'); toggle('t-bones', 'bones');
  toggle('t-grid', 'grid'); toggle('t-axes', 'axes'); toggle('t-bg', 'bg');

  // --- Task 8: panels, gizmos, tabs, joint grid, canvas picking ---
  panels = new Panels({
    getRotation: () => rotation,
    getStore: () => store,
    getCam: () => cam,
    getUI: () => ui,
    getLastJoints: () => lastJoints,
    onEdit: applyAnnotation,
  });

  // Joint grid: 21 body-joint buttons (SMPL joints 1..21).
  const grid = $('joint-grid');
  jointGridButtons = [];
  for (let j = 0; j < 21; j++) {
    const b = document.createElement('button');
    b.textContent = JOINT_NAMES[j + 1];
    b.addEventListener('click', () => { setPlaying(false); ui && ui.selectJoint(j); });
    grid.appendChild(b);
    jointGridButtons.push(b);
  }

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
    onPick: (smpl) => {
      setPlaying(false);
      if (smpl === 0) ui.setMode('root');
      else if (smpl >= 1 && smpl <= 21) ui.selectJoint(smpl - 1);
    },
    onMiss: () => { if (ui && ui.mode === 'pose') ui.clearSelection(); },
    canPick: () => !engageGuards.some((g) => g.isEngaged()),
  });

  rootHandle = new RootHandle({
    scene: scene.threeScene(),
    camera: cam.camera,
    canvas: $('c'),
    controls: cam.controls,
    getMode: () => cam.mode,
    getStore: () => store,
    getRotation: () => rotation,
    onEdit: applyAnnotation,
  });
  poseGizmo = new PoseGizmo({
    scene: scene.threeScene(),
    camera: cam.camera,
    canvas: $('c'),
    controls: cam.controls,
    getMode: () => cam.mode,
    getRotation: () => rotation,
    getStore: () => store,
    onEdit: applyAnnotation,
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
      if (twoDOnlyModes.has(b.dataset.mode)) b.disabled = is3d;
    });
  }

  // 切到 3D 时,若当前正处于某个 2D-only 模式,自动跳回 3D 下安全模式(避免停在
  // 一个已禁用且无意义的 tab)。在 cam.switchTo('3d') 之后、syncUI 之前调用。
  function leave2dOnlyModeIfNeeded() {
    if (ui && twoDOnlyModes.has(ui.mode)) { drawArmed = false; ui.setMode(SAFE_MODE_3D); }
  }

  syncUI = () => {
    if (!ui) return;
    refreshTabAvailability();
    document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('on', b.dataset.mode === ui.mode));
    document.querySelectorAll('.tabpanel').forEach((p) => { p.hidden = p.dataset.mode !== ui.mode; });
    jointGridButtons.forEach((b, j) => b.classList.toggle('on', ui.mode === 'pose' && ui.selectedJoint === j));
    $('sel-joint').textContent = ui.selectedJoint == null ? '未选择关节' : `已选择: ${JOINT_NAMES[ui.selectedJoint + 1]}`;
    const prb = $('pose-rot-block'); if (prb) prb.hidden = !(ui.mode === 'pose' && ui.selectedJoint != null);
    scene.setSelectedJoint(ui.mode === 'pose' && ui.selectedJoint != null ? ui.selectedJoint + 1 : -1);
    if (jointPicker) jointPicker.setEnabled(ui.mode === 'pose');

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
      const j = ui.selectedJoint;
      const smplJ = j + 1;
      const parent = model.parents[smplJ];
      const qParentWorld = mat3ToQuat(lastWorldRot.slice(parent * 9, parent * 9 + 9));
      poseGizmo.attach(j, scene.jointWorldPosition(smplJ), qParentWorld);
      rootHandle.detach();
    } else if (!playing && ui.mode === 'root' && store && store.current()) {
      rootHandle.attach(store.current().root_pos);
      poseGizmo.detach();
    } else {
      poseGizmo.detach();
      rootHandle.detach();
    }
    bboxOverlay.render(bboxShownNow() ? (store?.current()?.bbox ?? null) : null);
    renderAnnoActions();
    panels.syncFromState();
  };

  // Root translate/rotate sub-mode buttons (inside the root tabpanel).
  $('root-translate').addEventListener('click', () => {
    setPlaying(false);
    rootHandle.setMode('translate');
    $('root-translate').classList.add('on');
    $('root-rotate').classList.remove('on');
    if (syncUI) syncUI();
  });
  $('root-rotate').addEventListener('click', () => {
    setPlaying(false);
    rootHandle.setMode('rotate');
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
    const depthMod = e.metaKey || e.ctrlKey;
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
      if (bboxOverlay) bboxOverlay.render(store?.current()?.bbox ?? null);
      return;
    }

    // depthMod 分支:2D 下用户已按修饰键,先 preventDefault 吞掉浏览器整页缩放,
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

  window.addEventListener('resize', () => { scene.resize(); if (bboxOverlay) bboxOverlay.render(bboxShownNow() ? (store?.current()?.bbox ?? null) : null); });

  // 安装 IK 插件(可插拔):本体只此一行,通过 ctx 注入扩展点;
  // 置 IK_ENABLED=false(或删此块)即彻底拆除 IK,本体不受影响。
  // 必须在 jointGridButtons 构造之后、syncUI 定义之后、首帧 loop 之前。
  const IK_ENABLED = true;
  if (IK_ENABLED) {
    installIK({
      scene, camera: cam.camera, canvas: $('c'), controls: cam.controls,
      getMode: () => cam.mode, getStore: () => store, getRotation: () => rotation,
      getLastJoints: () => lastJoints, getLastWorldRot: () => lastWorldRot,
      getUI: () => ui, getParents: () => model && model.parents, isPlaying: () => playing,
      onEdit: applyAnnotation, jointGridButtons, setStatus,
      requestSync: () => { if (syncUI) syncUI(); },
      toggleButton: $('ik-toggle'),
      registerSyncHook: (fn) => syncHooks.push(fn),
      registerGuard: (g) => { dragGuards.push(g); engageGuards.push(g); },
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
    scene.render();   // scene.render() calls cam.update() internally
    requestAnimationFrame(loop);
  }
  requestAnimationFrame((now) => { lastTick = now; loop(now); });
}
boot();
