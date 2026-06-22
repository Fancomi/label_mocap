// pcd_label/src/app.js — 点云 SMPL 标注器装配。复用 smpl_edit 的世界系编辑内核。
import { loadModel } from '../../smpl_core/smpl_model.js';
import { forwardSmpl } from '../../smpl_core/lbs.js';
import { mat3ToQuat } from '../../smpl_core/rotations.js';
import { JOINT_NAMES } from '../../smpl_core/joint_names.js';
import { CocoDocument } from '../../smpl_edit/coco_document.js';
import { AnnotationStore } from '../../smpl_edit/annotation_store.js';
import { RotationState } from '../../smpl_edit/rotation_state.js';
import { UIController } from '../../smpl_edit/ui_controller.js';
import { JointPicker } from '../../smpl_edit/joint_picker.js';
import { RootHandle } from '../../smpl_edit/root_handle.js';
import { PoseGizmo } from '../../smpl_edit/pose_gizmo.js';
import { installIK } from '../../smpl_edit/ik_plugin.js';
import { PcdScene } from './scene/pcd_scene.js';
import { OrbitCam } from './scene/orbit_cam.js';
import { PcdPanels } from './ui/pcd_panels.js';
import { decodeXYZ } from './scene/point_cloud_decode.js';
import { decodePngFile } from './io/png_pixels.js';
import { PcdDirSource, FileListSource, fsAccessSupported, pickDirectory } from './io/pcd_dir_source.js';
import { FRONT_OPTIONS } from '../../smpl_edit/view_frame.js';

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };
const MODEL_URL = new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url);

let model = null, scene = null, cam = null, store = null;
let source = null, manifest = null;
let rotation = null, ui = null, panels = null;
let rootHandle = null, poseGizmo = null, jointPicker = null;
let jointGridButtons = [];
let lastVertices = null, lastJoints = null, lastWorldRot = null;
let syncUI = null, syncHooks = [], dragGuards = [], engageGuards = [];
let playing = false, fps = 10, lastTick = 0, acc = 0;
// 坐标轴(上轴/前轴)只影响观察者相机,不旋转点云/SMPL。AXIS_TO_IDX 给「高度配色」用。
let axisUp = 'Z', axisFront = 'X';
const AXIS_TO_IDX = { X: 0, Y: 1, Z: 2 };
let lastDecoded = null;

async function loadModelWithProgress() {
  const box = $('loading'), bar = $('loading-bar'), txt = $('loading-text');
  if (box) box.hidden = false;
  try {
    return await loadModel(MODEL_URL, { onProgress: ({ loaded, total }) => {
      if (!bar) return;
      if (total > 0) { const pct = Math.min(100, Math.round(loaded / total * 100)); bar.style.width = `${pct}%`; if (txt) txt.textContent = `加载模型… ${pct}%`; }
      else if (txt) txt.textContent = `加载模型… ${(loaded / 1048576).toFixed(1)} MB`;
    } });
  } finally { if (box) box.hidden = true; }
}

function buildFrame() {
  const a = store.current();
  const { root_rota, body_pose } = rotation.toAxisAngle();
  return { root_pos: a.root_pos, root_rota, body_pose, betas: a.betas };
}

function applyAnnotation() {
  if (!rotation || !store.current()) return;
  const out = forwardSmpl(model, buildFrame(), { worldRot: true });
  lastVertices = out.vertices; lastJoints = out.joints; lastWorldRot = out.worldRot;
  scene.updateMesh(out.vertices, out.joints);
  if (panels) panels.syncFromState();
}

async function renderPointCloud(i) {
  const file = await source.frameFile(i);
  const { pixels, channels } = await decodePngFile(file);
  lastDecoded = decodeXYZ(pixels, {
    pointWidth: manifest.pointWidth, pointHeight: manifest.pointHeight,
    scale: manifest.scale, center: manifest.center, channels,
  });
  // 点云存原始数据系坐标,不旋转。高度配色取「上轴」分量。
  scene.pointCloud.setHeightAxis(AXIS_TO_IDX[axisUp]);
  scene.pointCloud.setData(lastDecoded);
}

// 上轴/前轴变化:只动相机(up 向量 + 环绕方位)与地面网格朝向,几何不变。
function applyAxisFrame(recenter) {
  scene.orientGroundTo(axisUp);
  scene.pointCloud.setHeightAxis(AXIS_TO_IDX[axisUp]); // 高度配色取上轴分量(若为 height 模式会自动重算)
  const b = scene.pointCloud.bounds();
  cam.setFrame(axisUp, axisFront, recenter && b ? b.center : null, b ? b.radius : null);
}

function renderAnnoActions() {
  const host = $('anno-actions'); if (!host) return;
  const has = store && store.hasData();
  $('anno-state').textContent = !store ? '—' : (has ? '✅ 本帧已标注' : '— 本帧无标注');
  host.innerHTML = '';
  if (!store || ui?.readOnly) return;
  const row = document.createElement('div'); row.className = 'row'; host.appendChild(row);
  const mk = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; row.appendChild(b); };
  if (has) mk('🗑 删除本帧标注', '', () => { store.deleteCurrent(); showFrame(store.currentFrame()); });
  else { mk('＋ 新建:T-pose', 'primary', () => {
      store.addTpose();
      const c = scene.pointCloud.centroid();
      if (c) { store.beginEdit(); store.applyFields({ root_pos: c }); store.commitEdit(); }
      showFrame(store.currentFrame());
    }); mk('＋ 复制上一帧', '', () => { store.addFromPrevious(); showFrame(store.currentFrame()); }); }
}

async function showFrame(i) {
  store.setFrame(i);
  $('slider').value = String(i);
  $('frame-info').textContent = `${i} / ${store.frameCount() - 1}`;
  const a = store.current();
  if (a) {
    rotation = RotationState.fromAxisAngle({ root_rota: a.root_rota, body_pose: a.body_pose });
    applyAnnotation();
    scene.setPersonVisible(true);
  } else {
    rotation = null; lastVertices = null; lastJoints = null; lastWorldRot = null;
    scene.setPersonVisible(false);
    if (panels) panels.syncFromState();
  }
  renderAnnoActions();
  try { await renderPointCloud(i); }
  catch (e) { setStatus(`点云解码失败: ${e}`); }
  if (syncUI) syncUI();
}

async function mountSequence() {
  manifest = await source.readManifest();
  const raw = await source.readAnnotation();
  let coco;
  if (raw) coco = new CocoDocument(raw);
  else coco = new CocoDocument({ images: Array.from({ length: manifest.frameCount }, (_, i) => ({ id: i })), annotations: [], categories: [] });
  store = new AnnotationStore(coco);
  ui = new UIController({ modes: ['pose', 'root', 'beta'] });
  if (syncUI) ui.onChange(syncUI);
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
  $('slider').value = '0';
  $('right').classList.remove('disabled');
  if (!model) { model = await loadModelWithProgress(); scene.setTopology(model.faces); }
  fps = manifest.fps || 10; $('speed').value = String(fps); $('speed-val').textContent = `${fps} fps`;
  scene.resize();
  await showFrame(0);
  // 初次取景:相机按当前上轴/前轴环绕点云包围球,几何不动。
  applyAxisFrame(true);
  if (syncUI) syncUI();
  setStatus(`已加载 ${manifest.frameCount} 帧`);
}

async function openDirectory() {
  const h = await pickDirectory();
  source = new PcdDirSource(h);
  await mountSequence();
}

async function saveAnnotation() {
  if (!store) return;
  const obj = store.document().serialize();
  const path = await source.saveAnnotation(obj);
  setStatus(`已保存 ${path}`);
}

function boot() {
  scene = new PcdScene($('c'));
  cam = new OrbitCam({ canvas: $('c') });
  scene.setCamera(cam);
  scene.resize();

  $('btn-open').addEventListener('click', () => {
    if (!fsAccessSupported()) { $('dir-input').click(); return; }
    openDirectory().catch((e) => { if (e?.name !== 'AbortError') setStatus(String(e)); });
  });
  // 退化路径(Firefox/Safari 无 FS Access):webkitdirectory 选目录 → 内存持有 FileList。
  $('dir-input').addEventListener('change', (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    source = new FileListSource(files);
    setStatus('已选择文件夹(下载保存模式)');
    mountSequence().catch((err) => setStatus(String(err)));
  });

  $('slider').addEventListener('input', (e) => { if (!store) return; setPlaying(false); showFrame(+e.target.value); });
  $('btn-prev').addEventListener('click', () => { if (!store) return; setPlaying(false); showFrame(Math.max(0, store.currentFrame() - 1)); });
  $('btn-next').addEventListener('click', () => { if (!store) return; setPlaying(false); showFrame(Math.min(store.frameCount() - 1, store.currentFrame() + 1)); });
  $('btn-play').addEventListener('click', () => { if (store) setPlaying(!playing); });
  $('speed').addEventListener('input', (e) => { fps = +e.target.value; $('speed-val').textContent = `${fps} fps`; });
  $('btn-undo').addEventListener('click', () => { if (store) { store.undo(); showFrame(store.currentFrame()); } });
  window.addEventListener('keydown', (e) => { if (store && (e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); store.undo(); showFrame(store.currentFrame()); } });
  $('btn-save').addEventListener('click', () => saveAnnotation().catch((e) => setStatus(String(e))));
  $('btn-reset').addEventListener('click', async () => { if (!source || !store) return; const raw = await source.readAnnotation(); if (raw) { store = new AnnotationStore(new CocoDocument(raw)); ui = new UIController({ modes: ['pose','root','beta'] }); if (syncUI) ui.onChange(syncUI); } await showFrame(Math.min(store.currentFrame(), store.frameCount() - 1)); setStatus('已重置'); });

  const toggle = (id, key) => $(id).addEventListener('click', () => { const on = !$(id).classList.contains('on'); $(id).classList.toggle('on', on); scene.setFlag(key, on); });
  toggle('t-points', 'points'); toggle('t-mesh', 'mesh'); toggle('t-joints', 'joints'); toggle('t-bones', 'bones'); toggle('t-grid', 'grid'); toggle('t-axes', 'axes');

  boot2();
}

function populateFrontAxis() {
  const sel = $('axis-front'); sel.innerHTML = '';
  for (const f of FRONT_OPTIONS[axisUp]) { const o = document.createElement('option'); o.value = f; o.textContent = `${f}-front`; sel.appendChild(o); }
  if (!FRONT_OPTIONS[axisUp].includes(axisFront)) axisFront = FRONT_OPTIONS[axisUp][0];
  sel.value = axisFront;
}

function setPlaying(on) {
  playing = on && store && store.frameCount() > 0;
  if (playing) { poseGizmo?.detach(); rootHandle?.detach(); }
  $('btn-play').textContent = playing ? '⏸ 暂停' : '▶ 播放';
  $('btn-play').classList.toggle('on', playing);
}

function boot2() {
  $('color-mode').addEventListener('change', (e) => scene.pointCloud.setColorMode(e.target.value));
  $('decimation').addEventListener('input', (e) => scene.pointCloud.setDecimation(+e.target.value));
  $('point-size').addEventListener('input', (e) => scene.pointCloud.setPointSize(+e.target.value));
  populateFrontAxis();
  $('axis-up').addEventListener('change', (e) => { axisUp = e.target.value; populateFrontAxis(); applyAxisFrame(false); });
  $('axis-front').addEventListener('change', (e) => { axisFront = e.target.value; applyAxisFrame(false); });

  panels = new PcdPanels({ getRotation: () => rotation, getStore: () => store, getUI: () => ui, getLastJoints: () => lastJoints, onEdit: applyAnnotation });

  const grid = $('joint-grid'); jointGridButtons = [];
  for (let j = 0; j < 21; j++) {
    const b = document.createElement('button'); b.textContent = JOINT_NAMES[j + 1];
    b.addEventListener('click', () => { setPlaying(false); ui && ui.selectJoint(j); });
    grid.appendChild(b); jointGridButtons.push(b);
  }
  document.querySelectorAll('#tabs .tab').forEach((btn) => btn.addEventListener('click', () => {
    if (dragGuards.some((g) => g.isDragging())) return;
    if (btn.dataset.mode === 'root' || btn.dataset.mode === 'pose') setPlaying(false);
    if (ui) ui.setMode(btn.dataset.mode);
  }));

  boot3();
}

function boot3() {
  jointPicker = new JointPicker({
    canvas: $('c'), camera: cam.camera, getJointMeshes: () => scene.jointMeshes(),
    onPick: (smpl) => { setPlaying(false); if (smpl === 0) ui.setMode('root'); else if (smpl >= 1 && smpl <= 21) ui.selectJoint(smpl - 1); },
    onMiss: () => { if (ui && ui.mode === 'pose') ui.clearSelection(); },
    canPick: () => !engageGuards.some((g) => g.isEngaged()),
  });
  rootHandle = new RootHandle({ scene: scene.threeScene(), camera: cam.camera, canvas: $('c'), controls: cam.controls, getMode: () => cam.mode, getStore: () => store, getRotation: () => rotation, onEdit: applyAnnotation });
  poseGizmo = new PoseGizmo({ scene: scene.threeScene(), camera: cam.camera, canvas: $('c'), controls: cam.controls, getMode: () => cam.mode, getRotation: () => rotation, getStore: () => store, onEdit: applyAnnotation });
  dragGuards.push(poseGizmo, rootHandle); engageGuards.push(poseGizmo, rootHandle);

  syncUI = () => {
    if (!ui) return;
    document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('on', b.dataset.mode === ui.mode));
    document.querySelectorAll('.tabpanel').forEach((p) => { p.hidden = p.dataset.mode !== ui.mode; });
    jointGridButtons.forEach((b, j) => b.classList.toggle('on', ui.mode === 'pose' && ui.selectedJoint === j));
    $('sel-joint').textContent = ui.selectedJoint == null ? '未选择关节' : `已选择: ${JOINT_NAMES[ui.selectedJoint + 1]}`;
    const prb = $('pose-rot-block'); if (prb) prb.hidden = !(ui.mode === 'pose' && ui.selectedJoint != null);
    scene.setSelectedJoint(ui.mode === 'pose' && ui.selectedJoint != null ? ui.selectedJoint + 1 : -1);
    if (jointPicker) jointPicker.setEnabled(ui.mode === 'pose');
    let claimed = false;
    for (const h of syncHooks) { if (h()) claimed = true; }
    if (claimed) { poseGizmo.detach(); rootHandle.detach(); }
    else if (!playing && ui.mode === 'pose' && ui.selectedJoint != null && rotation && lastWorldRot) {
      const j = ui.selectedJoint, smplJ = j + 1, parent = model.parents[smplJ];
      const qParentWorld = mat3ToQuat(lastWorldRot.slice(parent * 9, parent * 9 + 9));
      poseGizmo.attach(j, scene.jointWorldPosition(smplJ), qParentWorld); rootHandle.detach();
    } else if (!playing && ui.mode === 'root' && store && store.current()) { rootHandle.attach(store.current().root_pos); poseGizmo.detach(); }
    else { poseGizmo.detach(); rootHandle.detach(); }
    renderAnnoActions(); panels.syncFromState();
  };

  $('root-translate').addEventListener('click', () => { setPlaying(false); rootHandle.setMode('translate'); $('root-translate').classList.add('on'); $('root-rotate').classList.remove('on'); if (syncUI) syncUI(); });
  $('root-rotate').addEventListener('click', () => { setPlaying(false); rootHandle.setMode('rotate'); $('root-rotate').classList.add('on'); $('root-translate').classList.remove('on'); if (syncUI) syncUI(); });

  boot4();
}

function boot4() {
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

  window.addEventListener('resize', () => scene.resize());

  function loop(now) {
    if (playing && store && store.frameCount() > 0) {
      acc += now - lastTick;
      const interval = 1000 / fps;
      if (acc >= interval) { acc %= interval; const next = (store.currentFrame() + 1) % store.frameCount(); showFrame(next); }
    }
    lastTick = now;
    const gizmoBusy = engageGuards.some((g) => g.isEngaged());
    if (cam) cam.controls.enabled = !gizmoBusy;
    scene.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame((now) => { lastTick = now; loop(now); });
}

boot();
