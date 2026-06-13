// label/src/app.js — M2: load, render, navigate, annotate (add/del/undo + display toggles).
import { loadModel } from '../../smpl_core/smpl_model.js';
import { forwardSmpl } from '../../smpl_core/lbs.js';
import { mat3ToQuat } from '../../smpl_core/rotations.js';
import { CocoDocument } from './io/coco_document.js';
import { buildFrames, isPortrait } from './io/source_loader.js';
import { AnnotationStore } from './edit/annotation_store.js';
import { reprojectKeypoints } from './edit/derived.js';
import { RotationState } from './edit/rotation_state.js';
import { UIController } from './ui/ui_controller.js';
import { JointPicker } from './ui/joint_picker.js';
import { CameraModes } from './scene/camera_modes.js';
import { LabelScene } from './scene/scene.js';
import { Panels } from './ui/panels.js';
import { RootHandle } from './edit/root_handle.js';
import { PoseGizmo } from './edit/pose_gizmo.js';
import { projectBboxFromMesh } from './edit/bbox_edit.js';
import { BboxOverlay } from './edit/bbox_overlay.js';
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };

const MODEL_URL = new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url);
const JOINT_NAMES = ['Pelvis', 'L_Hip', 'R_Hip', 'Spine1', 'L_Knee', 'R_Knee', 'Spine2', 'L_Ankle', 'R_Ankle', 'Spine3', 'L_Foot', 'R_Foot', 'Neck', 'L_Collar', 'R_Collar', 'Head', 'L_Shoulder', 'R_Shoulder', 'L_Elbow', 'R_Elbow', 'L_Wrist', 'R_Wrist', 'L_Hand', 'R_Hand'];
let model = null, scene = null, cam = null, store = null;
let images = new Map();      // index -> File
let loadedJsonFile = null;   // raw json File, for Reset-from-disk
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

function isJpeg(name) { return /\.(jpe?g)$/i.test(name); }

function setPlaying(on) {
  playing = on && store && store.frameCount() > 0;
  $('btn-play').textContent = playing ? '⏸ 暂停' : '▶ 播放';
  $('btn-play').classList.toggle('on', playing);
}

async function openFiles(fileList) {
  images = new Map();
  const files = Array.from(fileList ?? []);
  const jsonFile = files.find((f) => f.name.endsWith('.json'));
  loadedJsonFile = jsonFile ?? null;
  const imageFiles = files.filter((f) => isJpeg(f.name)).sort((a, b) => a.name.localeCompare(b.name));

  let coco = null;
  if (jsonFile) {
    coco = new CocoDocument(JSON.parse(await jsonFile.text()));
  }
  const background = imageFiles.length ? { kind: 'image_sequence', count: imageFiles.length } : null;
  if (!coco) {
    // data-less: synthesize an images list from the image files
    coco = new CocoDocument({ images: imageFiles.map((_, i) => ({ id: i })), annotations: [], categories: [] });
  }

  const ids = coco.imageIds();
  const dataFrameIndices = ids.map((id, idx) => (coco.getAnnotation(id) ? idx : -1)).filter((x) => x >= 0);
  const frames = buildFrames({ background, dataFrameIndices });
  imageFiles.forEach((f, i) => images.set(i, f));

  // portrait gate
  const info = coco.imageInfo(coco.imageIds()[0]);
  readOnly = info ? isPortrait(info) : false;
  if (readOnly) setStatus('⚠ 该数据为竖拍/旋转,标注器仅支持查看;请用其他软件转正后再标注');

  store = new AnnotationStore(coco);
  ui = new UIController({ readOnly });
  if (syncUI) ui.onChange(syncUI);
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
  $('slider').value = '0';
  if (!model) { model = await loadModel(MODEL_URL); scene.setTopology(model.faces); }
  scene.prepareForSequence({ K: cam.K, image_w: cam.imageW, image_h: cam.imageH });
  cam.snapTo('2d');
  scene.resize();
  await showFrame(0);
  if (syncUI) syncUI();
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
  $('anno-state').textContent = !store ? '—' : (has ? '✅ 本帧已标注' : '— 本帧无标注');
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
  if (a) {
    rotation = RotationState.fromAxisAngle({ root_rota: a.root_rota, body_pose: a.body_pose });
    applyAnnotation();
  } else {
    rotation = null;
    if (panels) panels.syncFromState();
    if (bboxOverlay) bboxOverlay.render(null);
  }
  renderAnnoActions();
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

function saveJson() {
  if (!store || !model) return;
  const doc = store.document();
  for (const id of doc.imageIds()) {
    const a = doc.getAnnotation(id);
    if (!a) continue;
    const out = forwardSmpl(model, { root_pos: a.root_pos, root_rota: a.root_rota, body_pose: a.body_pose, betas: a.betas });
    const keypoints = reprojectKeypoints(out.joints, cam.K, 52);
    doc.setAnnotation(id, { keypoints });
  }
  const json = JSON.stringify(doc.serialize(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'player_0.json'; link.click();
  URL.revokeObjectURL(url);
  setStatus('已保存 player_0.json');
}

async function resetFromDisk() {
  if (!store) return;
  if (loadedJsonFile) {
    const coco = new CocoDocument(JSON.parse(await loadedJsonFile.text()));
    store = new AnnotationStore(coco);
    ui = new UIController({ readOnly });
    if (syncUI) ui.onChange(syncUI);
  }
  await showFrame(Math.min(store.currentFrame(), store.frameCount() - 1));
  setStatus('已从硬盘重置');
}

function boot() {
  scene = new LabelScene($('c'));
  cam = new CameraModes({ canvas: $('c'), meta: { K: { fx: 1850, fy: 1850, cx: 960, cy: 540 }, image_w: 1920, image_h: 1080 } });
  scene.setCamera(cam);
  $('btn-open').addEventListener('click', () => $('dir-input').click());
  $('dir-input').addEventListener('change', (e) => openFiles(e.target.files).catch((err) => setStatus(String(err))));
  $('btn-2d').addEventListener('click', () => { cam.switchTo('2d'); $('btn-2d').classList.add('on'); $('btn-3d').classList.remove('on'); if (syncUI) syncUI(); });
  $('btn-3d').addEventListener('click', () => { cam.switchTo('3d'); $('btn-3d').classList.add('on'); $('btn-2d').classList.remove('on'); if (syncUI) syncUI(); });
  $('slider').addEventListener('input', (e) => { setPlaying(false); showFrame(+e.target.value); });
  $('btn-prev').addEventListener('click', () => { setPlaying(false); showFrame(Math.max(0, store.currentFrame() - 1)); });
  $('btn-next').addEventListener('click', () => { setPlaying(false); showFrame(Math.min(store.frameCount() - 1, store.currentFrame() + 1)); });
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
  $('grid-size').addEventListener('input', () => scene.setGrid(+$('grid-size').value, +$('grid-step').value));
  $('grid-step').addEventListener('input', () => scene.setGrid(+$('grid-size').value, +$('grid-step').value));

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
    b.addEventListener('click', () => ui && ui.selectJoint(j));
    grid.appendChild(b);
    jointGridButtons.push(b);
  }

  // Tab buttons.
  document.querySelectorAll('#tabs .tab').forEach((btn) => btn.addEventListener('click', () => ui && ui.setMode(btn.dataset.mode)));

  jointPicker = new JointPicker({
    canvas: $('c'),
    camera: cam.camera,
    getJointMeshes: () => scene.jointMeshes(),
    onPick: (smpl) => {
      if (smpl === 0) ui.setMode('root');
      else if (smpl >= 1 && smpl <= 21) ui.selectJoint(smpl - 1);
    },
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
    onEdit: applyAnnotation,
  });

  // ui.onChange fires whenever mode/joint changes → sync tabs, panels, gizmos.
  syncUI = () => {
    if (!ui) return;
    document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('on', b.dataset.mode === ui.mode));
    document.querySelectorAll('.tabpanel').forEach((p) => { p.hidden = p.dataset.mode !== ui.mode; });
    jointGridButtons.forEach((b, j) => b.classList.toggle('on', ui.mode === 'pose' && ui.selectedJoint === j));
    $('sel-joint').textContent = ui.selectedJoint == null ? '未选择关节' : `已选择: ${JOINT_NAMES[ui.selectedJoint + 1]}`;
    if (jointPicker) jointPicker.setEnabled(ui.mode === 'pose');

    // Exactly one interaction at a time.
    if (ui.mode === 'pose' && ui.selectedJoint != null && rotation && lastWorldRot) {
      const j = ui.selectedJoint;
      const smplJ = j + 1;
      const parent = model.parents[smplJ];
      const qParentWorld = mat3ToQuat(lastWorldRot.slice(parent * 9, parent * 9 + 9));
      poseGizmo.attach(j, scene.jointWorldPosition(smplJ), qParentWorld);
      rootHandle.detach();
    } else if (ui.mode === 'root' && store && store.current()) {
      rootHandle.attach(store.current().root_pos);
      poseGizmo.detach();
    } else {
      poseGizmo.detach();
      rootHandle.detach();
    }
    bboxOverlay.render(ui.mode === 'bbox' ? (store?.current()?.bbox ?? null) : null);
    renderAnnoActions();
    panels.syncFromState();
  };

  // Root translate/rotate sub-mode buttons (inside the root tabpanel).
  $('root-translate').addEventListener('click', () => {
    rootHandle.setMode('translate');
    $('root-translate').classList.add('on');
    $('root-rotate').classList.remove('on');
  });
  $('root-rotate').addEventListener('click', () => {
    rootHandle.setMode('rotate');
    $('root-rotate').classList.add('on');
    $('root-translate').classList.remove('on');
  });

  $('btn-bbox-auto').addEventListener('click', () => {
    if (!store || !store.current() || ui?.readOnly || !lastVertices) return;
    store.beginEdit();
    store.applyFields({ bbox: projectBboxFromMesh(lastVertices, cam.K) });
    store.commitEdit();
    panels.syncFromState();
    if (bboxOverlay) bboxOverlay.render(store.current()?.bbox ?? null);
  });

  // Save / Reset (#btn-save / #btn-reset) — Task 10.
  $('btn-save').addEventListener('click', saveJson);
  $('btn-reset').addEventListener('click', () => resetFromDisk().catch((e) => setStatus(String(e))));

  window.addEventListener('resize', () => { scene.resize(); if (bboxOverlay) bboxOverlay.render(ui?.mode === 'bbox' ? (store?.current()?.bbox ?? null) : null); });

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
    cam.update();
    scene.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame((now) => { lastTick = now; loop(now); });
}
boot();
