// label/src/app.js — M2: load, render, navigate, annotate (add/del/undo + display toggles).
import { loadModel } from '../../smpl_core/smpl_model.js';
import { forwardSmpl } from '../../smpl_core/lbs.js';
import { CocoDocument } from './io/coco_document.js';
import { buildFrames, isPortrait } from './io/source_loader.js';
import { AnnotationStore } from './edit/annotation_store.js';
import { RotationState } from './edit/rotation_state.js';
import { EditController } from './edit/edit_controller.js';
import { CameraModes } from './scene/camera_modes.js';
import { LabelScene } from './scene/scene.js';
import { Panels } from './ui/panels.js';
import { RootHandle } from './edit/root_handle.js';
import { PoseGizmo } from './edit/pose_gizmo.js';
import { projectBboxFromMesh } from './edit/bbox_edit.js';
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };

const MODEL_URL = new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url);
let model = null, scene = null, cam = null, store = null;
let images = new Map();      // index -> File
let readOnly = false;
let textureLoader = null;
let currentTexture = null;
let playing = false;
let fps = 24;
let lastTick = 0;
let acc = 0;
let rotation = null;
let editController = null;
let lastVertices = null;
let lastJoints = null;
let panels = null;
let rootHandle = null;
let poseGizmo = null;
let syncTools = null;

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
  editController = new EditController({ readOnly });
  if (syncTools) editController.onChange(syncTools);
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
  $('slider').value = '0';
  if (!model) { model = await loadModel(MODEL_URL); scene.setTopology(model.faces); }
  scene.prepareForSequence({ K: cam.K, image_w: cam.imageW, image_h: cam.imageH });
  cam.snapTo('2d');
  scene.resize();
  await showFrame(0);
}

function buildFrame() {
  const a = store.current();
  const { root_rota, body_pose } = rotation.toAxisAngle();
  return { root_pos: a.root_pos, root_rota, body_pose, betas: a.betas };
}

function applyAnnotation() {
  if (!rotation || !store.current()) return;
  const out = forwardSmpl(model, buildFrame());
  lastVertices = out.vertices;
  lastJoints = out.joints;
  scene.updateMesh(out.vertices, out.joints);
  cam.set3DFollowTarget(new THREE.Vector3(out.joints[0], out.joints[1], out.joints[2]));
  if (panels) panels.syncFromState();
}

async function showFrame(i) {
  store.setFrame(i);
  $('slider').value = String(i);
  $('frame-info').textContent = `${i} / ${store.frameCount() - 1}`;
  const a = store.current();
  if (a) {
    rotation = RotationState.fromAxisAngle({ root_rota: a.root_rota, body_pose: a.body_pose });
    $('anno-state').textContent = '有数据';
    applyAnnotation();
  } else {
    rotation = null;
    $('anno-state').textContent = '空帧 (可 +T-pose / +续上帧)';
  }
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

function boot() {
  scene = new LabelScene($('c'));
  cam = new CameraModes({ canvas: $('c'), meta: { K: { fx: 1850, fy: 1850, cx: 960, cy: 540 }, image_w: 1920, image_h: 1080 } });
  scene.setCamera(cam);
  $('btn-open').addEventListener('click', () => $('dir-input').click());
  $('dir-input').addEventListener('change', (e) => openFiles(e.target.files).catch((err) => setStatus(String(err))));
  $('btn-2d').addEventListener('click', () => { cam.switchTo('2d'); $('btn-2d').classList.add('on'); $('btn-3d').classList.remove('on'); });
  $('btn-3d').addEventListener('click', () => { cam.switchTo('3d'); $('btn-3d').classList.add('on'); $('btn-2d').classList.remove('on'); });
  $('slider').addEventListener('input', (e) => { setPlaying(false); showFrame(+e.target.value); });
  $('btn-prev').addEventListener('click', () => { setPlaying(false); showFrame(Math.max(0, store.currentFrame() - 1)); });
  $('btn-next').addEventListener('click', () => { setPlaying(false); showFrame(Math.min(store.frameCount() - 1, store.currentFrame() + 1)); });
  $('btn-play').addEventListener('click', () => { if (store) setPlaying(!playing); });
  $('speed').addEventListener('input', (e) => { fps = +e.target.value; $('speed-val').textContent = `${fps} fps`; });

  $('btn-add-t').addEventListener('click', () => { if (store && !editController?.readOnly) { store.addTpose(); showFrame(store.currentFrame()); } });
  $('btn-add-prev').addEventListener('click', () => { if (store && !editController?.readOnly) { store.addFromPrevious(); showFrame(store.currentFrame()); } });
  $('btn-del').addEventListener('click', () => { if (store && !editController?.readOnly) { store.deleteCurrent(); showFrame(store.currentFrame()); } });
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

  // --- Task 8: panels, gizmos, tool buttons, joint select, bbox edit ---
  panels = new Panels({
    getRotation: () => rotation,
    getStore: () => store,
    getCam: () => cam,
    getEditController: () => editController,
    getLastJoints: () => lastJoints,
    onEdit: applyAnnotation,
  });
  panels.populateJointSelect();

  rootHandle = new RootHandle({
    scene: scene.threeScene(),
    camera: cam.camera,
    canvas: $('c'),
    controls: cam.controls,
    getStore: () => store,
    onEdit: applyAnnotation,
  });
  poseGizmo = new PoseGizmo({
    scene: scene.threeScene(),
    camera: cam.camera,
    canvas: $('c'),
    controls: cam.controls,
    getRotation: () => rotation,
    getStore: () => store,
    getJointWorldPos: (j) => scene.jointWorldPosition(j),
    onEdit: applyAnnotation,
  });

  const setToolBtn = (active) => {
    $('tool-root').classList.toggle('on', active === 'root');
    $('tool-pose').classList.toggle('on', active === 'pose');
    $('tool-bbox').classList.toggle('on', active === 'bbox');
  };
  $('tool-root').addEventListener('click', () => editController?.setTool('root'));
  $('tool-pose').addEventListener('click', () => editController?.setTool('pose'));
  $('tool-bbox').addEventListener('click', () => editController?.setTool('bbox'));
  $('joint-select').addEventListener('change', (e) => {
    if (!editController) return;
    const v = e.target.value;
    if (v === 'root') editController.setTool('root');
    else if (v !== '') editController.selectJoint(Number(v));
  });

  // editController fires onChange whenever tool/joint changes → sync gizmos + panels.
  syncTools = () => {
    if (!editController) return;
    const tool = editController.tool;
    setToolBtn(tool);
    if (tool === 'root' && store && store.current()) {
      rootHandle.attach(store.current().root_pos);
      poseGizmo.detach();
    } else if (tool === 'pose' && editController.selectedJoint != null && rotation) {
      const j = editController.selectedJoint;
      // body joint j corresponds to SMPL world joint j+1
      poseGizmo.attach(j, scene.jointWorldPosition(j + 1), rotation.getJointQuat(j));
      rootHandle.detach();
    } else {
      rootHandle.detach();
      poseGizmo.detach();
    }
    panels.syncFromState();
  };

  $('btn-bbox-auto').addEventListener('click', () => {
    if (!store || !store.current() || editController?.readOnly || !lastVertices) return;
    store.beginEdit();
    store.applyFields({ bbox: projectBboxFromMesh(lastVertices, cam.K) });
    store.commitEdit();
    panels.syncFromState();
  });

  // #t-bbox: bbox visual overlay not implemented yet — toggle .on flag only.
  $('t-bbox').addEventListener('click', () => $('t-bbox').classList.toggle('on'));

  // Save / Reset (#btn-save / #btn-reset) wired in Task 10.

  window.addEventListener('resize', () => scene.resize());

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
