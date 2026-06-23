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
import { projectBboxFromMesh } from './edit/bbox_edit.js';
import { BboxOverlay } from './edit/bbox_overlay.js';
import { fsAccessSupported, pickDirectory, DirSource, videoOpenSupported, pickVideoFile } from './io/dir_source.js';
import { VideoSource } from './io/video_source.js';
import { DEFAULT_ENDPOINT, inferGvhmr, cloudResultToFields } from './io/gvhmr_client.js';
import { fileToBase64, videoFrameToBase64 } from './io/image_bytes.js';
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
// 通用扩展点:插件(如 IK)通过 install 时注入。本体不出现任何插件专有名字。
//  - syncHooks:syncUI 末尾依次调用,任一返回 true 表示该插件接管了当前交互;
//  - dragGuards:模式/标签切换前聚合 isDragging() 拦截;
//  - engageGuards:相机锁 / 画布拾取聚合 isEngaged() 拦截。
let syncHooks = [];
let dragGuards = [];
let engageGuards = [];

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
  ui = new UIController({ readOnly });
  if (syncUI) ui.onChange(syncUI);
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
  $('slider').value = '0';
  $('right').classList.remove('disabled');
  if (!model) { model = await loadModelWithProgress(); scene.setTopology(model.faces); }
  scene.prepareForSequence({ K: cam.K, image_w: cam.imageW, image_h: cam.imageH });
  cam.snapTo('2d');
  scene.resize();
  await showFrame(0);
  if (syncUI) syncUI();
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

// 取当前显示帧的图像 base64(唯一来源:images / videoSource,不另存副本)。
async function currentFrameBase64() {
  if (videoSource) return videoFrameToBase64(videoSource.videoEl);
  const file = images.get(store.currentFrame());
  if (!file) throw new Error('当前帧没有可用图像');
  return fileToBase64(file);
}

function currentFileName() {
  const file = videoSource ? null : images.get(store.currentFrame());
  return file ? file.name : `frame_${store.currentFrame()}.jpg`;
}

// 云端 cam_K = [fx,0,cx, 0,fy,cy, 0,0,1](行主序)。采用为当前相机内参,
// 并写入当前帧 images[].cam_K(cam_K 真相在数据,cam.K 为运行时镜像)。
function adoptCamK(camK) {
  if (!Array.isArray(camK) || camK.length < 9) return;
  const fx = camK[0], fy = camK[4], cx = camK[2], cy = camK[5];
  cam.setIntrinsics({ fx, fy, cx, cy });
  const info = store.document().imageInfo(store.currentImageId());
  if (info) info.cam_K = camK.slice();
}

let gvhmrAbort = null;
function showGvhmrOverlay(on, msg) {
  const ov = $('gvhmr-overlay'); if (!ov) return;
  if (msg) $('gvhmr-msg').textContent = msg;
  ov.hidden = !on;
}

// withBbox=false → 链路1(纯图);true → 链路2(带当前帧 bbox)。
async function runGvhmr(withBbox) {
  if (!store || ui?.readOnly) return;
  if (withBbox && !store.hasBbox()) { setStatus('当前帧无框,无法带框推理'); return; }
  const frameAtStart = store.currentFrame();      // 落地前校验仍在原帧
  const bbox = withBbox ? store.current()?.bbox : undefined;
  setPlaying(false);
  gvhmrAbort = new AbortController();
  showGvhmrOverlay(true, '云端推理中…');
  try {
    const imageB64 = await currentFrameBase64();
    const { ann, camK } = await inferGvhmr({
      endpoint: $('gvhmr-endpoint')?.value || DEFAULT_ENDPOINT,
      imageB64, fileName: currentFileName(), bbox, signal: gvhmrAbort.signal,
    });
    if (store.currentFrame() !== frameAtStart) { setStatus('已切帧,放弃本次结果'); return; }
    store.applyCloudResult(cloudResultToFields(ann));   // 一个 undo 单元,直接覆盖
    adoptCamK(camK);
    await showFrame(frameAtStart);
    setStatus('云端推理完成');
  } catch (e) {
    setStatus(String(e.message || e));
  } finally {
    showGvhmrOverlay(false);
    gvhmrAbort = null;
  }
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
    if (!a) continue;
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
      ui = new UIController({ readOnly });
      if (syncUI) ui.onChange(syncUI);
    }
  } else if (loadedJsonFile) {
    const coco = new CocoDocument(JSON.parse(await loadedJsonFile.text()));
    store = new AnnotationStore(coco);
    ui = new UIController({ readOnly });
    if (syncUI) ui.onChange(syncUI);
  }
  await showFrame(Math.min(store.currentFrame(), store.frameCount() - 1));
  setStatus('已重置');
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
  $('btn-3d').addEventListener('click', () => { if (dragGuards.some((g) => g.isDragging())) return; cam.switchTo('3d'); $('btn-3d').classList.add('on'); $('btn-2d').classList.remove('on'); if (ui && ui.mode === 'bbox') ui.setMode('pose'); refreshTabAvailability(); if (syncUI) syncUI(); });
  $('slider').addEventListener('input', (e) => { if (!store) return; setPlaying(false); showFrame(+e.target.value); });
  $('btn-prev').addEventListener('click', () => { if (!store) return; setPlaying(false); showFrame(Math.max(0, store.currentFrame() - 1)); });
  $('btn-next').addEventListener('click', () => { if (!store) return; setPlaying(false); showFrame(Math.min(store.frameCount() - 1, store.currentFrame() + 1)); });
  $('btn-play').addEventListener('click', () => { if (store) setPlaying(!playing); });
  $('speed').addEventListener('input', (e) => { fps = +e.target.value; $('speed-val').textContent = `${fps} fps`; });

  $('btn-undo').addEventListener('click', () => { if (store) { store.undo(); showFrame(store.currentFrame()); } });
  window.addEventListener('keydown', (e) => { if (store && (e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); store.undo(); showFrame(store.currentFrame()); } });

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

  // Tab buttons.
  document.querySelectorAll('#tabs .tab').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.disabled) return;
    if (dragGuards.some((g) => g.isDragging())) return;
    // Switching into an editing tab pauses playback (user-initiated edit entry).
    if (btn.dataset.mode === 'root' || btn.dataset.mode === 'pose') setPlaying(false);
    if (ui) ui.setMode(btn.dataset.mode);
  }));

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
    getBboxVisible: () => ui?.mode === 'bbox',
    getCanDraw: () => !!store && ui?.mode === 'bbox' && cam?.mode === '2d'
      && !ui?.readOnly && !store.hasBbox(),
    onEdit: applyAnnotation,
  });

  // 本体两个编辑基元并入通用守卫聚合(插件会各自再 push 自己的手柄)。
  dragGuards.push(poseGizmo, rootHandle);
  engageGuards.push(poseGizmo, rootHandle);
  dragGuards.push(bboxOverlay);
  engageGuards.push(bboxOverlay);

  // ui.onChange fires whenever mode/joint changes → sync tabs, panels, gizmos.
  function refreshTabAvailability() {
    const bboxTab = document.querySelector('#tabs .tab[data-mode="bbox"]');
    if (bboxTab) bboxTab.disabled = (cam.mode === '3d');
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
    bboxOverlay.render(ui.mode === 'bbox' ? (store?.current()?.bbox ?? null) : null);
    const bboxBtn = $('btn-gvhmr-bbox');
    if (bboxBtn) bboxBtn.disabled = !(store && store.hasBbox() && !ui.readOnly);
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

  $('btn-bbox-auto').addEventListener('click', () => {
    if (!store || !store.current() || ui?.readOnly || !lastVertices) return;
    store.beginEdit();
    store.applyFields({ bbox: projectBboxFromMesh(lastVertices, cam.K) });
    store.commitEdit();
    panels.syncFromState();
    if (bboxOverlay) bboxOverlay.render(store.current()?.bbox ?? null);
  });

  $('btn-gvhmr-plain').addEventListener('click', () => runGvhmr(false));
  $('btn-gvhmr-bbox').addEventListener('click', () => runGvhmr(true));
  $('gvhmr-cancel').addEventListener('click', () => { if (gvhmrAbort) gvhmrAbort.abort(); });

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

  window.addEventListener('resize', () => { scene.resize(); if (bboxOverlay) bboxOverlay.render(ui?.mode === 'bbox' ? (store?.current()?.bbox ?? null) : null); });

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
