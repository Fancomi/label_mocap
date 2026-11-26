// mhr_label/src/app.js — MHR(sam-3d-body)标注器:一个或多个标定视频 + 一个世界系人体,逐帧修 bad case。
// 页面按人体模型划分(本页 MHR,/label/ SMPL),视角数由数据 cameras[] 决定。共享内核 smpl_core / smpl_edit
// 与 label 的场景/面板组件,但入口、数据约定、界面独立。
// 分屏(ViewHub,一块 canvas 分区渲染):A = 3D 自由视角 + 各相机对齐视频(默认),B = 各相机对齐视频平铺,
// C = 聚焦一个相机。点一下某个视图即设为「当前视图」,手柄只在当前视图显示与拖拽,其余视图实时跟随。
import { loadModel } from '../../smpl_core/smpl_model.js';
import { BODY_ASSETS, createBody, createMhrBody } from '../../smpl_core/body_model.js';
import { CocoDocument } from '../../smpl_edit/coco_document.js';
import { AnnotationStore } from '../../smpl_edit/annotation_store.js';
import { createPoseState } from '../../smpl_edit/pose_state.js';
import { UIController } from '../../smpl_edit/ui_controller.js';
import { JointPicker } from '../../smpl_edit/joint_picker.js';
import { RootHandle } from '../../smpl_edit/root_handle.js';
import { PoseGizmo } from '../../smpl_edit/pose_gizmo.js';
import { GizmoSpace } from '../../smpl_edit/gizmo_space.js';
import { mountSpaceToggles } from '../../smpl_edit/space_toggle.js';
import { jointWorldQuat } from '../../smpl_edit/gizmo_frame.js';
import { bodyBounds, focusTarget } from '../../smpl_edit/framing.js';
import { JointFigure } from '../../smpl_edit/joint_figure.js';
import { installIK } from '../../smpl_edit/ik_plugin.js';
import { resolveChains } from '../../smpl_edit/ik_chains.js';
import { bindShortcuts, shortcutHintHtml } from '../../smpl_edit/shortcuts.js';
import { AnnoTimeline } from '../../smpl_edit/anno_timeline.js';
import { findMarked, countMarked } from '../../smpl_edit/frame_marks.js';
import { LabelScene } from '../../label/src/scene/scene.js';
import { Panels } from '../../label/src/ui/panels.js';
import { VideoSource } from '../../label/src/io/video_source.js';
import { pickDirectory, fsAccessSupported, DirSource } from '../../label/src/io/dir_source.js';
import { viewConfigOf } from '../../label/src/io/view_config.js';
import { deriveFrame } from '../../label/src/edit/frame_derive.js';
import { ViewHub } from './view_hub.js';
import { FREE_AXES, freeFrontOptions } from './layout.js';
import { findPredictionFiles, indexPrediction, predictionFields } from './alt_prediction.js';
import { ANNOTATION_PATH, checkMhrDoc } from './dataset.js';

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };
const MODELS_DIR = new URL('../../smpl_web_viewer/public/models/', import.meta.url);
const MODES = ['root', 'pose', 'beta'];
const DISPLAY_TOGGLES = [['t-mesh', 'mesh'], ['t-points', 'points'], ['t-bones', 'bones'], ['t-bg', 'bg']];

const modelCache = new Map();
let body = null;
let dir = null;          // DirSource
let store = null;        // 单人物(player_0)
let savedRev = 0;
let cfgs = new Map();    // cameraId → viewConfigOf(...):数据配置(帧号、派生量、帧率都用它)
let viewRot = new Map(); // cameraId → 标注员的显示旋转(顺时针 90° 步数),只改该视图的显示
let viewRotKey = null;
let docRaw = null;
let videos = new Map();  // cameraId → VideoSource
let preds = new Map();   // cameraId → Map(imageId → annotation)
let camOrder = [];       // cameras[] 顺序 = 分屏顺序
let ui = null, rotation = null;
let lastVertices = null, lastJoints = null, lastWorldRot = null;
let playing = false, fps = 30;
let axisPreferenceKey = null;
let useLimits = true;    // 姿态编辑遵守 rig 关节范围

let scene, hub, panels, rootHandle, poseGizmo, jointPicker;
const gizmoSpace = new GizmoSpace();
mountSpaceToggles(gizmoSpace);
let jointFigure = null;   // 人形 + 分组按钮(boot 里创建)
// 插件(IK)扩展点:同 label 的约定 —— syncHooks 返回 true 表示接管当前交互,guards 并入拖拽/悬停判定。
const syncHooks = [], guards = [], camConsumers = [], handleObjects = [], handleScalers = [];
const isDragging = () => !!(rootHandle?.isDragging() || poseGizmo?.isDragging() || guards.some((g) => g.isDragging()));
const isEngaged = () => !!(rootHandle?.isEngaged() || poseGizmo?.isEngaged() || guards.some((g) => g.isEngaged()));

async function loadModelWithProgress(url) {
  const box = $('loading'); const bar = $('loading-bar'); const txt = $('loading-text');
  box.hidden = false;
  try {
    return await loadModel(url, {
      onProgress: ({ loaded, total }) => {
        if (total > 0) { const pct = Math.min(100, Math.round((loaded / total) * 100)); bar.style.width = `${pct}%`; txt.textContent = `加载模型… ${pct}%`; }
        else txt.textContent = `加载模型… ${(loaded / 1048576).toFixed(1)} MB`;
      },
    });
  } finally { box.hidden = true; }
}

// 显示配置 = 数据配置的转正角再叠加标注员的显示旋转(docs/CONTRACTS.md §4)。存储、派生量仍走 cfgs。
function displayCfg(id) {
  const n = viewRot.get(id) ?? 0;
  if (!n) return cfgs.get(id);
  const cameras = docRaw.cameras.map((c) => (c.id === id ? { ...c, view_rotation_deg: ((c.view_rotation_deg ?? 0) + 90 * n) % 360 } : c));
  return { ...viewConfigOf({ ...docRaw, cameras }, id), userRotN: n };
}
function restoreViewRotation(raw) {
  const identity = raw.info?.source_id ?? raw.cameras.map((c) => [c.id, c.width, c.height, c.view_rotation_deg]);
  viewRotKey = 'mhr-label:view-rotation:' + JSON.stringify(identity);
  viewRot = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(viewRotKey)) ?? {};
    for (const id of camOrder) if (Number.isInteger(saved[id]) && saved[id] % 4) viewRot.set(id, ((saved[id] % 4) + 4) % 4);
  } catch { /* 存储被禁用时用数据的转正配置 */ }
}
function rotateView(id, step) {
  if (isDragging()) return;
  viewRot.set(id, (((viewRot.get(id) ?? 0) + step) % 4 + 4) % 4);
  try { localStorage.setItem(viewRotKey, JSON.stringify(Object.fromEntries(viewRot))); } catch { /* 只影响本次页面 */ }
  hub.setCameraConfig(id, displayCfg(id));
}

// 每个视图左上角的标签与按钮(ViewHub 回调)。
function decorateView(view, active) {
  const cur = active ? ' · 当前' : '';
  if (view.kind === 'free') return { tag: `3D 自由视角${cur}`, buttons: [] };
  const c = cfgs.get(view.camId);
  const signed = (d) => (d > 180 ? d - 360 : d);
  const rot = (c.rotationDeg ? ` · 转正 ${signed(c.rotationDeg)}°` : '') + (view.cfg.userRotN ? ` · 显示 ${signed(view.cfg.userRotN * 90)}°` : '');
  const cal = c.calibrationAccepted === false ? ' · ⚠ 标定未验收' : '';
  const noFrame = c.decodeIndex(store?.currentFrame() ?? 0) == null ? ' · 本帧无画面' : '';
  const sizing = hub.focusSizing();
  const rotate = [
    { text: '⟲', title: '画面逆时针转 90°(只改显示)', onClick: () => rotateView(view.camId, -1) },
    { text: '⟳', title: '画面顺时针转 90°(只改显示)', onClick: () => rotateView(view.camId, +1) },
  ];
  const buttons = hub.mode() === 'C'
    ? [{
      text: sizing === 'cover' ? '全幅' : '填满',
      title: sizing === 'cover' ? '复位缩放并显示完整画面' : '保持原比例填满画布',
      focusSizing: sizing,
      onClick: () => { if (!isDragging()) hub.setFocusSizing(sizing === 'cover' ? 'fit' : 'cover'); },
    }, ...camOrder.filter((id) => id !== view.camId).map((id) => ({ text: `→ ${id}`, onClick: () => setLayout('C', id) }))]
    : [{ text: '⛶', title: '只看这个视角(模式 C)', onClick: () => setLayout('C', view.camId) }];
  buttons.unshift(...rotate);
  return { tag: `${view.camId}${cur}${rot}${cal}${noFrame}`, buttons };
}

function setLayout(mode, focusId) {
  if (isDragging()) return;
  hub.setMode(mode, focusId);
  document.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('on', b.dataset.layout === mode));
}

function setAxisOptions(select, names, current) {
  select.replaceChildren(...names.map((name) => new Option(name.startsWith('-') ? `−${name.slice(1)}` : `+${name}`, name)));
  select.value = current;
}

function syncAxisMenus() {
  const { up, front } = hub.freeAxes();
  $('axis-up').value = up;
  setAxisOptions($('axis-front'), freeFrontOptions(up), front);
}

// Remember a viewer setting without changing the annotation or camera data.
function restoreAxisPreference(raw) {
  const { up, front } = hub.freeAxes();
  const identity = raw.info?.source_id ?? raw.cameras.map(c => [c.id, c.width, c.height, c.view_rotation_deg]);
  axisPreferenceKey = 'mhr-label:view-axes:' + JSON.stringify([identity, up, front]);
  try {
    const saved = JSON.parse(localStorage.getItem(axisPreferenceKey));
    if (saved) hub.setFreeAxes(saved.up, saved.front);
  } catch { /* Storage can be disabled. The dataset defaults still work. */ }
}

function saveAxisPreference(reset = false) {
  if (!axisPreferenceKey) return;
  try {
    if (reset) localStorage.removeItem(axisPreferenceKey);
    else localStorage.setItem(axisPreferenceKey, JSON.stringify(hub.freeAxes()));
  } catch { /* The view changes still apply for the open page. */ }
}

// ── 人体模型 / 手部开关 ─────────────────────────────────────────────────────
function setBody(next) {
  body = next;
  body.ikSkeleton = resolveChains(body);   // 手臂(肩-肘-腕)、腿(髋-膝-踝)两段链
  scene.setBody(body);
  panels.setBody(body);
  scene.setMeshOpacity(+$('mesh-opacity').value);
  jointFigure.setBody(body);
  $('hands-row').hidden = !body.supportsHands;
  $('t-hands').checked = !!body.showHands;
}

function setShowHands(on) {
  if (!body?.supportsHands || body.showHands === on || isDragging()) return;
  if (ui?.mode === 'pose') ui.clearSelection();
  setBody(createMhrBody(modelCache.get('mhr'), { showHands: on }));
  if (store) showFrame(store.currentFrame());
}

// ── 打开数据集 ──────────────────────────────────────────────────────────────
async function openDataset() {
  if (store && store.revision() !== savedRev && !window.confirm('当前数据有未保存的修改,确定打开其他数据集?')) return;
  const src = new DirSource(await pickDirectory());
  await src.scan();
  const raw = await src.readJsonAt(ANNOTATION_PATH);
  const err = checkMhrDoc(raw, src.paths);
  if (err) throw new Error(err);
  setStatus('读取视频…');
  for (const v of videos.values()) v.dispose();
  const doc = new CocoDocument(raw);
  const nextVideos = new Map();
  for (const c of raw.cameras) {
    nextVideos.set(c.id, await new VideoSource(await src.readFile(c.video), { fps: c.fps > 0 ? c.fps : 30 }).ready());
  }
  const name = doc.bodyModelName();
  if (!modelCache.has(name)) modelCache.set(name, await loadModelWithProgress(new URL(BODY_ASSETS[name], MODELS_DIR)));
  if (!body || body.name !== name) setBody(createBody(name, modelCache.get(name)));

  dir = src;
  videos = nextVideos;
  camOrder = raw.cameras.map((c) => c.id);
  cfgs = new Map(camOrder.map((id) => [id, viewConfigOf(raw, id)]));
  preds = new Map();
  for (const { cameraId, path } of findPredictionFiles(src.paths)) {
    const p = await src.readJsonAt(path);
    if (p) preds.set(cameraId, indexPrediction(p));
  }
  mountStore(new AnnotationStore(doc));
  fps = raw.cameras[0].fps > 0 ? raw.cameras[0].fps : 30;
  $('speed').value = String(fps); $('speed-val').textContent = `${fps} fps`;
  $('right').classList.remove('disabled');
  hub.setSceneConfig(raw.info?.scene);
  docRaw = raw;
  restoreViewRotation(raw);
  hub.setCameras(camOrder, new Map(camOrder.map((id) => [id, displayCfg(id)])));
  restoreAxisPreference(raw);
  syncAxisMenus();
  await showFrame(0);
  frameFreeView();
  const sum = countMarked(store.annotatedMask());
  setStatus(`已加载 ${store.frameCount()} 帧 · 有人体 ${sum} 帧 · 视角 ${camOrder.join(' / ')}`);
}

function mountStore(s) {
  store = s;
  savedRev = store.revision();
  store.onCommitted(onCommitted);
  ui = new UIController({ modes: MODES });
  ui.onChange(syncUI);
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
}

// ── 派生量:帧定稿时单帧计算(两视角各一份),缓存进文档;保存只序列化 ───────────────
const pendingDerive = new Set();
let deriveTimer = null;
function onCommitted(imageId) {
  pendingDerive.add(imageId);
  deriveTimer ??= setTimeout(flushDerived, 0);
}
function flushDerived() {
  clearTimeout(deriveTimer); deriveTimer = null;
  if (!store) return;
  const doc = store.document();
  const views = camOrder.map((id) => ({ cameraId: id, cfg: cfgs.get(id) }));
  const order = doc.imageIds();
  for (const id of pendingDerive) {
    const a = doc.getAnnotation(id);
    if (!a || !doc.hasSmpl(id)) continue;
    store.setDerived(id, deriveFrame(body, body.forward(bodyFields(a)), views, order.indexOf(id)));
  }
  pendingDerive.clear();
}

async function save() {
  if (!store) return;
  flushDerived();
  await dir.writeFile(ANNOTATION_PATH, JSON.stringify(store.document().serialize()));
  savedRev = store.revision();
  setStatus(`已保存 ${ANNOTATION_PATH}`);
}

async function reload() {
  if (!store) return;
  if (store.revision() !== savedRev && !window.confirm('丢弃未保存的修改,重新读取?')) return;
  const at = store.currentFrame();
  mountStore(new AnnotationStore(new CocoDocument(await dir.readJsonAt(ANNOTATION_PATH))));
  await showFrame(Math.min(at, store.frameCount() - 1));
  setStatus('已重新读取');
}

// ── 帧显示与编辑 ────────────────────────────────────────────────────────────
function bodyFields(a) {
  const f = {};
  for (const k of body.fieldKeys) f[k] = a[k];
  return f;
}

function applyAnnotation() {
  if (!rotation || !store.current()) return;
  const out = body.forward({ ...bodyFields(store.current()), ...rotation.toAxisAngle() }, { worldRot: true });
  lastVertices = out.vertices; lastJoints = out.joints; lastWorldRot = out.worldRot;
  rootHandle.syncFromState(); poseGizmo.syncFromState();
  scene.updateMesh(out.vertices, out.joints);
  const bb = bodyBounds(lastJoints);
  scene.setFollowCenter(bb?.center ?? null);
  if (bb) hub.setGroundUnder(bb.center);
  panels.syncFromState();
  refreshTimeline();
}

function showFrame(i) {
  store.setFrame(i);
  $('slider').value = String(i);
  $('frame-info').textContent = `${i + 1} / ${store.frameCount()}`;
  const a = store.current();
  if (a && store.hasSmpl()) {
    rotation = createPoseState(body, a, { limits: useLimits });
    scene.setPersonVisible(true);
    applyAnnotation();
  } else {
    rotation = null; lastVertices = lastJoints = lastWorldRot = null;
    scene.setPersonVisible(false);
    panels.syncFromState();
    refreshTimeline();
  }
  syncVideos(i);
  syncUI();
  hub.refreshOverlay();   // 标签上的「本帧无画面」随帧刷新
}

// 每台相机按 images[i].views 定位到自己的解码帧;本帧无画面的相机背景置空(不显示白板)。
// 暂停时精确 seek,且每台相机同一时刻只有一个 seek 在飞(拖进度条时只追最新帧,不排队);
// 播放时视频自己按时钟播放,只在漂移超过 2 帧时纠正(人体跟着主相机的视频时间走,见 loop)。
const seekState = new Map();   // cameraId → { busy, want }
function syncVideos(i) {
  for (const id of camOrder) {
    const v = videos.get(id);
    const di = cfgs.get(id).decodeIndex(i);
    if (di == null) { v.videoEl.pause(); hub.setTexture(id, null); continue; }
    if (playing) {
      const el = v.videoEl, t = (di + 0.001) / v.fps;
      if (Math.abs(el.currentTime - t) > 2 / v.fps) el.currentTime = t;
      if (el.paused) el.play().catch(() => {});
      hub.setTexture(id, v.texture);
      continue;
    }
    const st = seekState.get(id) ?? { busy: false, want: null };
    seekState.set(id, st);
    st.want = di;
    if (st.busy) continue;
    const run = async () => {
      st.busy = true;
      while (st.want != null) {
        const want = st.want; st.want = null;
        await v.seek(want);
        hub.setTexture(id, v.texture);
      }
      st.busy = false;
    };
    run();
  }
}

function frameFreeView() {
  const b = bodyBounds(lastJoints);
  if (b) hub.frameFree(b.center, b.radius);
}

function refreshTimeline() {
  timeline.setData({ n: store.frameCount(), current: store.currentFrame(), rows: [{ mask: store.annotatedMask(), active: true, label: 'player_0' }] });
}

function renderAnnoActions() {
  const host = $('anno-actions');
  host.innerHTML = '';
  if (!store) return;
  const a = store.current();
  const has = store.hasSmpl();
  const src = a?.source;
  const views = camOrder.filter((id) => cfgs.get(id).decodeIndex(store.currentFrame()) != null);
  $('anno-state').textContent = (has ? `🧍 已有 ${body.name.toUpperCase()}` : '— 本帧无人体')
    + (src ? ` · 来源 ${src.camera}${src.effective_state ? `/${src.effective_state}` : ''}${src.adopted ? '(已采用)' : ''}${src.fused_to ? ` · 已按两视角融合(${Object.entries(src.fused_to).map(([c, e]) => `${c} ${e}px`).join(' / ')})` : ''}` : '')
    + ` · 有画面: ${views.join(' / ') || '无'}`;
  const mk = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; host.appendChild(b); };
  // 逐帧改用某个视角的原始预测(一个 undo 单元)。
  for (const [cid, idx] of preds) {
    const fields = predictionFields(idx, store.currentImageId(), body.fieldKeys);
    if (!fields) continue;
    mk(`⇄ 采用 ${cid} 预测`, '', () => {
      const pa = idx.get(store.currentImageId());
      store.applyCloudResult({ ...fields, source: { ...structuredClone(pa.source ?? { camera: cid }), adopted: true } });
      showFrame(store.currentFrame());
      setStatus(`本帧已采用 ${cid} 预测(Ctrl+Z 撤销)`);
    });
  }
  if (has) mk('🗑 删除本帧人体', '', () => { store.deleteCurrent(); showFrame(store.currentFrame()); });
  else mk('＋ 复制上一帧', '', () => { store.addFromPrevious(); showFrame(store.currentFrame()); });
}

function syncUI() {
  if (!ui) return;
  document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('on', b.dataset.mode === ui.mode));
  document.querySelectorAll('.tabpanel').forEach((p) => { p.hidden = p.dataset.mode !== ui.mode; });
  jointFigure.buttons().forEach((b, k) => b.classList.toggle('on', ui.mode === 'pose' && ui.selectedJoint === k));
  jointFigure.setSelected(ui.mode === 'root' ? body.rootJoint : ui.mode === 'pose' && ui.selectedJoint != null ? body.poseJoints[ui.selectedJoint] : null);
  const selJ = ui.selectedJoint == null ? null : body.poseJoints[ui.selectedJoint];
  $('sel-joint').textContent = selJ == null ? '未选择关节' : `已选择: ${body.poseLabels[ui.selectedJoint]}(${body.jointNames[selJ]})`;
  // 该关节可动的轴与范围(灰掉的轴 rig 不让动)。
  const DEG = 180 / Math.PI;
  $('pose-range').textContent = selJ == null || !rotation?.channelRanges ? '' : '可动轴: ' + rotation.channelRanges(ui.selectedJoint)
    .map(({ ch, range, coef }) => `${'XYZ'[ch]} ${range && useLimits ? `${(Math.min(range[0] * coef, range[1] * coef) * DEG).toFixed(0)}°…${(Math.max(range[0] * coef, range[1] * coef) * DEG).toFixed(0)}°` : '不限'}`).join(' · ');
  $('pose-rot-block').hidden = !(ui.mode === 'pose' && ui.selectedJoint != null);
  scene.setSelectedJoint(ui.mode === 'pose' && ui.selectedJoint != null ? body.poseJoints[ui.selectedJoint] : -1);
  jointPicker.setEnabled(ui.mode === 'pose' || ui.mode === 'root');
  let claimed = false;
  for (const h of syncHooks) if (h()) claimed = true;
  if (claimed) {
    poseGizmo.detach(); rootHandle.detach();
  } else if (!playing && ui.mode === 'pose' && ui.selectedJoint != null && rotation && lastWorldRot) {
    const sj = body.poseJoints[ui.selectedJoint];
    poseGizmo.attach(ui.selectedJoint, scene.jointWorldPosition(sj), jointWorldQuat(lastWorldRot, body.parents[sj]));
    applyAxisLock(ui.selectedJoint);
    rootHandle.detach();
  } else if (!playing && ui.mode === 'root' && !ui.released && store?.hasSmpl()) {
    rootHandle.attach(store.current().root_pos);
    poseGizmo.detach();
  } else {
    poseGizmo.detach(); rootHandle.detach();
  }
  if (!(ui.mode === 'pose' && ui.selectedJoint != null)) applyAxisLock(null);
  syncHandleScale();
  renderAnnoActions();
  panels.syncFromState();
}

// 受限关节(rig 只给 1–2 个旋转自由度,如肘、膝、腕、踝):旋转手柄只出可动的环,并锁定自身轴 ——
// 这些自由度是关节自己的轴,世界轴下拖不出对应的转动。3 自由度关节恢复两种参考系与全部环。
let axisLocked = false;
function applyAxisLock(k) {
  const ch = k == null || !rotation?.editableChannels ? [0, 1, 2] : rotation.editableChannels(k);
  const locked = ch.length < 3;
  poseGizmo.setAxes({ x: ch.includes(0), y: ch.includes(1), z: ch.includes(2) });
  poseGizmo.setSpaceOverride(locked ? 'local' : null);
  if (locked === axisLocked) return;
  axisLocked = locked;
  document.querySelectorAll('.tabpanel[data-mode="pose"] [data-space-toggle] button').forEach((b) => {
    const world = b.dataset.space === 'world';
    b.disabled = locked && world;
    b.title = locked && world ? '该关节只能绕自身轴转动(rig 限定)' : '';
    b.classList.toggle('on', locked ? !world : b.dataset.space === gizmoSpace.get());
  });
}

// 当前视图变化(切视图 / 缩放):手柄与拾取换到该视图相机，手柄缩放跟随显示窗口。
function onViewChange() {
  const c = hub.activeCamera();
  if (!c) return;
  for (const h of [rootHandle, poseGizmo, jointPicker]) h?.setCamera(c);
  camConsumers.forEach((fn) => fn(c));
  syncHandleScale();
}
function syncHandleScale() {
  const s = hub.activeView()?.handleScale() ?? 1;
  // 选中手指等精细关节时,旋转手柄按该关节的显示尺寸缩小。
  const sel = ui?.mode === 'pose' && ui.selectedJoint != null ? body.poseJoints[ui.selectedJoint] : null;
  poseGizmo?.setHandleScale(s * (sel == null ? 1 : body.jointScale(sel)));
  rootHandle?.setHandleScale(s);
  handleScalers.forEach((fn) => fn(s));
}

// 播放 = 各视频原生播放(倍速 = 速度 / 主相机帧率),人体帧号取自主相机视频的当前时间,
// 所以人体与画面同步、不会因逐帧 seek 而滞后。暂停时回到逐帧精确定位。
function setPlaying(on) {
  const was = playing;
  playing = on && !!store;
  if (playing) {
    poseGizmo.detach(); rootHandle.detach();
    for (const v of videos.values()) v.videoEl.playbackRate = fps / (cfgs.get(camOrder[0]).fps || 30);
    syncVideos(store.currentFrame());
  } else if (was) {
    for (const v of videos.values()) v.videoEl.pause();
    showFrame(store.currentFrame());
  }
  $('btn-play').textContent = playing ? '⏸ 暂停' : '▶ 播放';
  $('btn-play').classList.toggle('on', playing);
}

function jumpMarked(dir) {
  if (!store) return;
  setPlaying(false);
  const j = findMarked(store.annotatedMask(), store.currentFrame(), dir);
  if (j < 0) { setStatus(dir > 0 ? '后面没有已标注帧' : '前面没有已标注帧'); return; }
  showFrame(j);
}

// ── 启动 ────────────────────────────────────────────────────────────────────
let timeline = null;
function boot() {
  const canvas = $('c');
  scene = new LabelScene(canvas);   // 只用它的人体网格/关节/骨骼与灯光;背景与相机由 ViewHub 管
  let depthTimer = null;
  hub = new ViewHub({
    canvas, scene: scene.threeScene(), renderer: scene.renderer(), overlay: $('overlay'),
    decorate: decorateView, isEngaged: () => isEngaged(), onChange: onViewChange,
    // 对齐视角里 Alt+滚轮:人体沿该相机视线前后移动(整体 tab)。
    onDepthWheel: (view, dy) => {
      if (!store?.hasSmpl() || ui.mode !== 'root') return;
      const { R } = view.cfg.pose;               // 相机→世界;相机看 −Z
      const back = [R[2], R[5], R[8]];
      const pos = store.current().root_pos.map((v, i) => v + back[i] * (dy > 0 ? 1 : -1) * 0.05);
      if (depthTimer === null) store.beginEdit();
      store.applyFields({ root_pos: pos });
      applyAnnotation();
      rootHandle.attach(pos);
      clearTimeout(depthTimer);
      depthTimer = setTimeout(() => { store.commitEdit(); depthTimer = null; }, 250);
    },
  });
  jointFigure = new JointFigure({
    figureHost: $('joint-figure'), gridHost: $('joint-grid'),
    onSelectPose: (k) => { setPlaying(false); ui?.selectJoint(k); },
    onPick: (j) => { if (!ui) return; setPlaying(false); if (j === body.rootJoint) ui.setMode('root'); else ui.selectJoint(body.poseJoints.indexOf(j)); },
  });
  panels = new Panels({ getRotation: () => rotation, getStore: () => store, getCam: () => null, getUI: () => ui,
    getLastJoints: () => lastJoints, getBody: () => body, onEdit: applyAnnotation });
  const handleCtx = { scene: scene.threeScene(), camera: hub.activeCamera(), canvas, getStore: () => store,
    getRotation: () => rotation, onEdit: applyAnnotation, space: gizmoSpace };
  rootHandle = new RootHandle(handleCtx);
  poseGizmo = new PoseGizmo({ ...handleCtx,
    onLimit: (hit) => { if (hit) setStatus(`已到关节限位:${body.poseLabels[ui.selectedJoint] ?? ''} 转不过去了(可在姿势 tab 关闭「遵守关节限位」)`); } });
  for (const h of [rootHandle, poseGizmo]) h.setNdcMapper((e) => hub.pointerToNdc(e));
  jointPicker = new JointPicker({
    canvas, camera: hub.activeCamera(), getJointMeshes: () => scene.jointMeshes(),
    getNdc: (e) => hub.pointerToNdc(e),
    onPick: (j) => {
      setPlaying(false);
      if (j === body.rootJoint) { ui.setMode('root'); return; }
      const k = body.poseJoints.indexOf(j);
      if (k >= 0) ui.selectJoint(k);
    },
    // 点人体网格 = 调整整体;点人体以外 = 取消调整(收起手柄,视角自由拖动)。见 docs/CONTRACTS.md。
    getBodyMesh: () => scene.meshObject(),
    onPickBody: () => { setPlaying(false); ui.setMode('root'); },
    onMiss: () => ui?.release(),
    canPick: () => !isEngaged(),
  });
  timeline = new AnnoTimeline({ host: $('anno-timeline'), onSeek: (i) => { if (store) { setPlaying(false); showFrame(i); } }, onJump: jumpMarked });

  const fail = (e) => { if (e?.name !== 'AbortError') setStatus(`⚠ ${e?.message ?? e}`); };
  $('btn-open').addEventListener('click', () => {
    if (!fsAccessSupported()) { setStatus('请用 Chrome / Edge:需要读写本地数据集目录'); return; }
    openDataset().catch(fail);
  });
  $('btn-save').addEventListener('click', () => save().catch(fail));
  $('btn-reset').addEventListener('click', () => reload().catch(fail));
  const undo = () => {
    if (!store || isDragging()) return;
    if (!store.canUndo()) { setStatus('没有可撤销的操作'); return; }
    store.undo(); showFrame(store.currentFrame()); setStatus('已撤销');
  };
  $('btn-undo').addEventListener('click', undo);
  $('slider').addEventListener('input', (e) => { if (store) { setPlaying(false); showFrame(+e.target.value); } });
  $('btn-prev').addEventListener('click', () => { if (store) { setPlaying(false); showFrame(Math.max(0, store.currentFrame() - 1)); } });
  $('btn-next').addEventListener('click', () => { if (store) { setPlaying(false); showFrame(Math.min(store.frameCount() - 1, store.currentFrame() + 1)); } });
  $('btn-play').addEventListener('click', () => setPlaying(!playing));
  $('speed').addEventListener('input', (e) => {
    fps = +e.target.value; $('speed-val').textContent = `${fps} fps`;
    if (playing) for (const v of videos.values()) v.videoEl.playbackRate = fps / (cfgs.get(camOrder[0]).fps || 30);
  });
  document.querySelectorAll('#tabs .tab').forEach((b) => b.addEventListener('click', () => {
    if (isDragging() || !ui) return;
    setPlaying(false);
    ui.setMode(b.dataset.mode);
  }));
  for (const [id, mode] of [['root-translate', 'translate'], ['root-rotate', 'rotate']]) {
    $(id).addEventListener('click', () => {
      if (ui?.released) ui.setMode('root');   // 按「移动/旋转」= 重新拿起整体手柄
      rootHandle.setMode(mode);
      $('root-translate').classList.toggle('on', mode === 'translate');
      $('root-rotate').classList.toggle('on', mode === 'rotate');
      syncUI();
    });
  }
  document.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => setLayout(b.dataset.layout)));
  setAxisOptions($('axis-up'), FREE_AXES, hub.freeAxes().up);
  syncAxisMenus();
  $('axis-up').addEventListener('change', (e) => {
    const up = e.target.value, { front } = hub.freeAxes(), options = freeFrontOptions(up);
    if (!isDragging()) {
      hub.setFreeAxes(up, options.includes(front) ? front : options[0]);
      saveAxisPreference();
    }
    syncAxisMenus();
  });
  $('axis-front').addEventListener('change', (e) => {
    if (!isDragging()) {
      hub.setFreeAxes(hub.freeAxes().up, e.target.value);
      saveAxisPreference();
    }
    syncAxisMenus();
  });
  $('axis-default').addEventListener('click', () => {
    if (isDragging()) return;
    hub.resetFreeAxes();
    saveAxisPreference(true);
    frameFreeView();
    syncAxisMenus();
  });
  for (const [id, key] of DISPLAY_TOGGLES) {
    $(id).addEventListener('click', () => {
      const on = !$(id).classList.contains('on');
      $(id).classList.toggle('on', on);
      if (key === 'bg') hub.setShowBackground(on); else scene.setFlag(key, on);
    });
  }
  $('mesh-opacity').addEventListener('input', (e) => scene.setMeshOpacity(+e.target.value));
  $('t-hands').addEventListener('change', (e) => setShowHands(e.target.checked));
  $('t-limits').addEventListener('change', (e) => {
    useLimits = e.target.checked;
    if (store) showFrame(store.currentFrame());
    setStatus(useLimits ? '已开启关节限位' : '已关闭关节限位(可拖出 rig 范围)');
  });

  // 快捷键:与 label / pcd_label 同一张表(smpl_edit/shortcuts.js)。
  // F 同 SMPL:3D 视角保持朝向、只把人体移到视野中央(一次性);R:重置当前视图(3D = 人体+地面默认取景,对齐 = 复位缩放)。
  const shortcutActions = {
    undo,
    play: () => setPlaying(!playing),
    prevFrame: () => $('btn-prev').click(),
    nextFrame: () => $('btn-next').click(),
    prevMarked: () => jumpMarked(-1),
    nextMarked: () => jumpMarked(+1),
    focus: () => {
      const sel = ui?.mode === 'pose' && ui.selectedJoint != null ? body.poseJoints[ui.selectedJoint] : null;
      const t = focusTarget(lastJoints, sel, sel == null ? 1 : body.jointScale(sel));
      if (!t) { setStatus('本帧无人体，无可居中'); return; }
      const what = t.kind === 'joint' ? body.poseLabels[ui.selectedJoint] : 'player_0';
      setStatus(hub.focusFree(t.center, t.radius) ? `已居中 ${what}` : '当前分屏没有 3D 视角(切到 A 后按 F)');
    },
    reset: () => {
      const v = hub.activeView();
      if (v?.kind === 'free') { frameFreeView(); setStatus('3D 视角已重置(人体 + 地面)'); }
      else if (v) { v.reset(); onViewChange(); setStatus(`${v.camId} 已复位缩放/平移`); }
    },
  };
  bindShortcuts({ actions: shortcutActions, enabled: (a) => !!store && (a === 'play' || a === 'undo' || !isDragging()) });
  $('kbd-hint').innerHTML = shortcutHintHtml(shortcutActions, ['对齐视频:滚轮缩放 · 空白处拖动平移 · 双击复位 · <b>Alt+滚轮</b> 沿该相机视线调远近']);
  window.addEventListener('beforeunload', (e) => { if (store && store.revision() !== savedRev) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('resize', () => hub.relayout());

  handleObjects.push(...rootHandle.sceneObjects(), ...poseGizmo.sceneObjects());
  const renderHooks = new Set();
  // IK(拖手腕/脚踝,肩肘或髋膝自动反解;MHR 的肘、膝投影到弯曲轴并遵守限位)。
  installIK({
    scene, camera: hub.activeCamera(), canvas, getStore: () => store, getRotation: () => rotation,
    getLastJoints: () => lastJoints, getLastWorldRot: () => lastWorldRot, getUI: () => ui,
    getParents: () => body?.parents, isPlaying: () => playing, onEdit: applyAnnotation,
    getSkeleton: () => body?.ikSkeleton ?? null, poseJointOf: (k) => body.poseJoints[k],
    jointGridButtons: jointFigure.buttons(), setStatus, requestSync: () => syncUI(),
    toggleButton: $('ik-toggle'), gizmoSpace,
    registerSyncHook: (fn) => syncHooks.push(fn),
    registerRenderHook: (fn) => { renderHooks.add(fn); return () => renderHooks.delete(fn); },
    registerGuard: (g) => guards.push(g),
    registerCameraConsumer: (fn) => camConsumers.push(fn),
    registerHandleObjects: (objs) => handleObjects.push(...objs),
    registerHandleScale: (fn) => handleScalers.push(fn),
    ndcMapper: (e) => hub.pointerToNdc(e),
  });
  function loop() {
    if (playing && store) {
      const master = videos.get(camOrder[0]).videoEl;
      if (master.ended) { master.currentTime = 0; master.play().catch(() => {}); }
      const i = Math.min(store.frameCount() - 1, Math.floor(master.currentTime * (cfgs.get(camOrder[0]).fps || 30) + 1e-3));
      if (i !== store.currentFrame()) showFrame(i);
    }
    for (const hook of renderHooks) hook();
    hub.render(handleObjects, (view) => scene.setLightFromCamera(view.camera, bodyBounds(lastJoints)?.center ?? null));
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

boot();
