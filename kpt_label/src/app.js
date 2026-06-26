// kpt_label/src/app.js
// 2D 关键点标注器装配层（DOM/canvas 耦合，浏览器内验证）。
import { computeWindow, zoomAtSolve, canvasNormToImage, clampPan, ZOOM_MIN } from '../../label/src/scene/view_zoom.js';
import { orderedImageNames } from '../../label/src/io/image_order.js';
import { isPortrait } from '../../label/src/io/source_loader.js';
import { DirSource, fsAccessSupported, pickDirectory, videoOpenSupported, pickVideoFile } from '../../label/src/io/dir_source.js';
import { getSkeleton } from './skeleton.js';
import { KptStore } from './kpt_store.js';
import { resizeBboxByCorner, normRect } from './bbox_geom.js';
import { hitKeypoint, hitBboxCorner, hitPerson } from './hit_test.js';
import { drawImage, drawPersons } from './render.js';
import { BodyDiagram } from './body_diagram.js';
import { VideoFrames } from './video_frames.js';
import { buildExport } from './yolo_export.js';

const $ = (id) => document.getElementById(id);
const skel = getSkeleton('coco17');
const PROJECT_FILE = 'kpt_label_project.json';   // 工程文件（可载入续标）；区别于 export 的单向产物

const state = {
  store: null, dirSource: null, video: null, images: null /* Map<idx,File> */,
  imgW: 1920, imgH: 1080, bitmap: null,
  zoom: 1, panX: 0, panY: 0,
  mode: 'pose', armed: -1,
  diagram: null,
};

const canvas = $('canvas');
const ctx = canvas.getContext('2d');

function win() {
  return computeWindow({ imageW: state.imgW, imageH: state.imgH, cx: state.imgW / 2, cy: state.imgH / 2,
    zoom: state.zoom, panX: state.panX, panY: state.panY });
}
function eventToImage(ev) {
  const r = canvas.getBoundingClientRect();
  const u = (ev.clientX - r.left) / r.width;
  const v = (ev.clientY - r.top) / r.height;
  return canvasNormToImage(u, v, win());
}
function hitRadius(px = 8) {
  const w = win();
  return px * (w.winW / canvas.width);
}

function fitCanvas() {
  const stage = $('stage');
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const ar = state.imgW / state.imgH;
  let cw = sw, ch = sw / ar;
  if (ch > sh) { ch = sh; cw = sh * ar; }
  canvas.width = Math.round(cw); canvas.height = Math.round(ch);
}

function render() {
  if (!state.bitmap) return;
  const w = win();
  drawImage(ctx, state.bitmap, w, canvas.width, canvas.height);
  if (state.store) drawPersons(ctx, state.store.persons(), state.store.selectedId(), skel, w, canvas.width, canvas.height);
}

function syncUI() {
  if (state.store) {
    $('frame-label').textContent = `${state.store.currentFrame() + 1} / ${state.store.frameCount()}`;
    $('frame-slider').value = String(state.store.currentFrame());
  }
  for (const t of document.querySelectorAll('#tabs .tab')) t.classList.toggle('on', t.dataset.mode === state.mode);
  const list = $('person-list'); list.innerHTML = '';
  if (state.store) for (const p of state.store.persons()) {
    const el = document.createElement('div');
    el.className = 'item' + (p.id === state.store.selectedId() ? ' on' : '');
    const nk = p.keypoints.filter((k) => k[2] > 0).length;
    el.innerHTML = `<span>Person ${p.id}</span><span>${p.bbox ? '▢' : '·'} ${nk}/${skel.names.length}</span>`;
    el.addEventListener('click', () => { state.store.select(p.id); refresh(); });
    list.appendChild(el);
  }
  const sel = state.store?.selected();
  state.diagram?.update(sel ? sel.keypoints : null, state.armed);
}

function refresh() { render(); syncUI(); }

async function loadFrame(idx) {
  state.store.setFrame(idx);
  let bmp = null;
  if (state.video) { await state.video.seek(idx); bmp = state.video.videoEl; }
  else if (state.images) {
    const f = state.images.get(idx);
    if (f) bmp = await createImageBitmap(f);
  }
  state.bitmap = bmp;
  state.armed = -1;
  fitCanvas();
  refresh();
}

async function mountImages(dirSource, cls) {
  const names = orderedImageNames({ cocoImages: null, availableNames: cls.imagePaths });
  const images = new Map();
  const metas = [];
  for (let i = 0; i < names.length; i++) {
    const f = await dirSource.imageFileByName(names[i]);
    if (!f) continue;
    images.set(metas.length, f);
    metas.push({ file_name: names[i], width: 0, height: 0 });
  }
  if (!metas.length) throw new Error('目录无可用图像');
  const first = await createImageBitmap(images.get(0));
  state.imgW = first.width; state.imgH = first.height;
  if (isPortrait({ width: state.imgW, height: state.imgH })) $('status').textContent = '竖拍图像：仍可标注（YOLO 归一化与方向无关）';
  for (const m of metas) { m.width = state.imgW; m.height = state.imgH; }
  state.images = images;
  state.store = new KptStore({ images: metas, skeleton: 'coco17', nkpt: skel.names.length });
  $('frame-slider').max = String(metas.length - 1);
  await loadFrame(0);
}

async function openDirectory() {
  if (!fsAccessSupported()) { $('status').textContent = '浏览器不支持目录访问，请用 Chrome/Edge'; return; }
  const handle = await pickDirectory();
  const src = new DirSource(handle);
  const cls = await src.scan();
  if (cls.hasManifest) { $('status').textContent = '该目录是点云序列，请用 pcd 标注器'; return; }
  state.video?.dispose();
  state.dirSource = src; state.video = null;
  await mountImages(src, cls);
  // 目录内若有本工具的工程文件，载入续标（fromJSON 往返保真）。
  const proj = await readProjectFile(src);
  if (proj?.schema === 'kpt-label/v1') {
    state.store = KptStore.fromJSON(proj, skel.names.length);
    $('frame-slider').max = String(state.store.frameCount() - 1);
    await loadFrame(0);
    $('status').textContent = `已加载图像目录 + 续接工程（${PROJECT_FILE}）`;
    return;
  }
  $('status').textContent = '已加载图像目录';
}

// 直接按固定文件名读工程，不走 DirSource 的 SMPL 命名约定。
async function readProjectFile(src) {
  const file = await src.readFile(PROJECT_FILE);
  if (!file) return null;
  try { return JSON.parse(await file.text()); }
  catch { return null; }
}

async function openVideo() {
  if (!videoOpenSupported()) { $('status').textContent = '浏览器不支持视频选择'; return; }
  const file = await pickVideoFile();
  const vf = await new VideoFrames(file).ready();
  state.video?.dispose();
  state.video = vf; state.images = null; state.dirSource = null;
  state.imgW = vf.width; state.imgH = vf.height;
  const n = vf.frameCount();
  const metas = Array.from({ length: n }, (_, i) => ({ file_name: `frame_${String(i).padStart(6, '0')}.jpg`, width: vf.width, height: vf.height }));
  state.store = new KptStore({ images: metas, skeleton: 'coco17', nkpt: skel.names.length });
  $('frame-slider').max = String(n - 1);
  await loadFrame(0);
  $('status').textContent = `已加载视频（${n} 帧）`;
}

$('stage').addEventListener('wheel', (ev) => {
  if (!state.bitmap) return;
  ev.preventDefault();
  const r = canvas.getBoundingClientRect();
  const u = (ev.clientX - r.left) / r.width, v = (ev.clientY - r.top) / r.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return;
  const factor = Math.exp(-ev.deltaY * 0.0015);
  const next = zoomAtSolve({ imageW: state.imgW, imageH: state.imgH, cx: state.imgW / 2, cy: state.imgH / 2,
    zoom: state.zoom, panX: state.panX, panY: state.panY, u, v, factor });
  Object.assign(state, { zoom: next.zoom, panX: next.panX, panY: next.panY });
  const c = clampPan({ imageW: state.imgW, imageH: state.imgH, cx: state.imgW / 2, cy: state.imgH / 2,
    zoom: state.zoom, panX: state.panX, panY: state.panY });
  state.panX = c.panX; state.panY = c.panY;
  render();
}, { passive: false });

let drag = null;
canvas.addEventListener('pointerdown', (ev) => {
  if (!state.store) return;
  const [ix, iy] = eventToImage(ev);
  const r = hitRadius();
  if (ev.shiftKey) { drag = { kind: 'pan', x: ev.clientX, y: ev.clientY, panX: state.panX, panY: state.panY }; canvas.setPointerCapture(ev.pointerId); return; }
  const sel = state.store.selected();
  if (sel) {
    const ki = hitKeypoint(sel, [ix, iy], r);
    if (ki >= 0 && state.mode === 'pose') { state.store.beginEdit(); drag = { kind: 'kpt', idx: ki }; canvas.setPointerCapture(ev.pointerId); return; }
    const corner = hitBboxCorner(sel, [ix, iy], r);
    if (corner && state.mode === 'bbox') { state.store.beginEdit(); drag = { kind: 'corner', corner }; canvas.setPointerCapture(ev.pointerId); return; }
  }
  if (state.mode === 'pose' && state.armed >= 0 && sel) {
    state.store.setKeypoint(state.armed, ix, iy, 2);
    state.armed = nextUnset(sel, state.armed);
    refresh(); return;
  }
  if (state.mode === 'bbox' && sel) { state.store.beginEdit(); drag = { kind: 'bbox', x0: ix, y0: iy }; canvas.setPointerCapture(ev.pointerId); return; }
  const hid = hitPerson(state.store.persons(), [ix, iy], r);
  if (hid != null) { state.store.select(hid); refresh(); }
});

canvas.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  if (drag.kind === 'pan') {
    const w = win();
    const dx = (ev.clientX - drag.x) / canvas.width * w.winW;
    const dy = (ev.clientY - drag.y) / canvas.height * w.winH;
    const c = clampPan({ imageW: state.imgW, imageH: state.imgH, cx: state.imgW / 2, cy: state.imgH / 2,
      zoom: state.zoom, panX: drag.panX - dx, panY: drag.panY - dy });
    state.panX = c.panX; state.panY = c.panY; render(); return;
  }
  const [ix, iy] = eventToImage(ev);
  if (drag.kind === 'kpt') { state.store.applyKeypoint(drag.idx, ix, iy, state.store.selected().keypoints[drag.idx][2] || 2); render(); }
  else if (drag.kind === 'corner') { state.store.applyBbox(resizeBboxByCorner(state.store.selected().bbox, drag.corner, [ix, iy])); render(); }
  else if (drag.kind === 'bbox') { state.store.applyBbox(normRect(drag.x0, drag.y0, ix, iy)); render(); }
});

canvas.addEventListener('pointerup', (ev) => {
  if (drag && drag.kind !== 'pan') state.store.commitEdit();
  if (drag) { try { canvas.releasePointerCapture(ev.pointerId); } catch {} }
  drag = null; refresh();
});

canvas.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const sel = state.store?.selected();
  if (!sel || state.mode !== 'pose') return;
  const [ix, iy] = eventToImage(ev);
  const ki = hitKeypoint(sel, [ix, iy], hitRadius());
  if (ki < 0) return;
  const cur = sel.keypoints[ki][2];
  const nv = cur === 2 ? 1 : cur === 1 ? 0 : 2;
  if (nv === 0) state.store.setKeypoint(ki, 0, 0, 0);
  else state.store.setKeypoint(ki, sel.keypoints[ki][0], sel.keypoints[ki][1], nv);
  refresh();
});

function nextUnset(person, from) {
  for (let i = 1; i <= skel.names.length; i++) {
    const j = (from + i) % skel.names.length;
    if (person.keypoints[j][2] === 0) return j;
  }
  return -1;
}

$('open-dir').addEventListener('click', () => openDirectory().catch((e) => $('status').textContent = String(e.message || e)));
$('open-video').addEventListener('click', () => openVideo().catch((e) => $('status').textContent = String(e.message || e)));
$('prev').addEventListener('click', () => state.store && loadFrame(Math.max(0, state.store.currentFrame() - 1)));
$('next').addEventListener('click', () => state.store && loadFrame(Math.min(state.store.frameCount() - 1, state.store.currentFrame() + 1)));
$('frame-slider').addEventListener('input', (e) => state.store && loadFrame(Number(e.target.value)));
$('add-person').addEventListener('click', () => { if (!state.store) return; state.store.addPerson(); state.armed = state.mode === 'pose' ? 0 : -1; refresh(); });
$('del-person').addEventListener('click', () => { if (!state.store) return; state.store.deletePerson(); state.armed = -1; refresh(); });
$('copy-prev').addEventListener('click', () => copyPrev());
for (const t of document.querySelectorAll('#tabs .tab')) t.addEventListener('click', () => { state.mode = t.dataset.mode; state.armed = -1; refresh(); });
$('save-json').addEventListener('click', () => saveProject().catch((e) => $('status').textContent = String(e.message || e)));
$('export').addEventListener('click', () => exportYolo().catch((e) => $('status').textContent = String(e.message || e)));

function copyPrev() {
  if (!state.store) return;
  if (state.store.copyFromPrevForEmpty()) { state.armed = -1; refresh(); }
  else $('status').textContent = '仅空帧可复制，且前方需有已标注帧';
}

window.addEventListener('keydown', (ev) => {
  if (!state.store || ev.target.tagName === 'INPUT') return;
  if (ev.key === 'n' || ev.key === 'N') { state.store.addPerson(); state.armed = state.mode === 'pose' ? 0 : -1; refresh(); }
  else if (ev.key === 'Delete') { state.store.deletePerson(); state.armed = -1; refresh(); }
  else if (ev.key === 'c' || ev.key === 'C') { copyPrev(); }
  else if (ev.key === 's' || ev.key === 'S') { saveProject().catch((e) => $('status').textContent = String(e.message || e)); }
  else if (ev.key === 'Tab') { ev.preventDefault(); cycleSelect(); }
  else if (ev.key === '1') { state.mode = 'bbox'; state.armed = -1; refresh(); }
  else if (ev.key === '2') { state.mode = 'pose'; refresh(); }
  else if (ev.key === 'f' || ev.key === 'F') focusSelected();
  else if (ev.key === 'r' || ev.key === 'R') { state.zoom = ZOOM_MIN; state.panX = 0; state.panY = 0; render(); }
  else if (ev.key === 'z' || ev.key === 'Z') { state.store.undo(); refresh(); }
});

function cycleSelect() {
  const ps = state.store.persons(); if (!ps.length) return;
  const i = ps.findIndex((p) => p.id === state.store.selectedId());
  state.store.select(ps[(i + 1) % ps.length].id); refresh();
}

function focusSelected() {
  const sel = state.store?.selected(); if (!sel) return;
  let box = sel.bbox;
  if (!box) {
    const pts = sel.keypoints.filter((k) => k[2] > 0);
    if (!pts.length) return;
    const xs = pts.map((k) => k[0]), ys = pts.map((k) => k[1]);
    box = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  }
  const [bx, by, bw, bh] = box;
  const z = Math.min(8, Math.max(2, 0.6 * Math.min(state.imgW / Math.max(1, bw), state.imgH / Math.max(1, bh))));
  const cxImg = bx + bw / 2, cyImg = by + bh / 2;
  state.zoom = z;
  const winW = state.imgW / z, winH = state.imgH / z;
  state.panX = cxImg - winW / 2;
  state.panY = cyImg - winH / 2;
  const c = clampPan({ imageW: state.imgW, imageH: state.imgH, cx: state.imgW / 2, cy: state.imgH / 2,
    zoom: state.zoom, panX: state.panX, panY: state.panY });
  state.panX = c.panX; state.panY = c.panY; render();
}

// 保存工程（可再次载入续标）：优先原地写回目录的 PROJECT_FILE，否则下载。
async function saveProject() {
  if (!state.store) return;
  const text = JSON.stringify(state.store.serialize(), null, 2);
  if (state.dirSource) {
    await state.dirSource.writeFile(PROJECT_FILE, new Blob([text], { type: 'application/json' }));
    $('status').textContent = `已原地保存工程：${PROJECT_FILE}（下次打开此目录自动续标）`;
  } else {
    triggerDownload(new Blob([text], { type: 'application/json' }), PROJECT_FILE);
    $('status').textContent = `已下载 ${PROJECT_FILE}（视频源无目录权限，载入续标需用图像目录）`;
  }
}

async function exportYolo() {
  if (!state.store) return;
  const valRatio = Number($('val-ratio').value) || 0;
  const doc = state.store.serialize();
  const out = buildExport(doc, skel, { valRatio });
  if (state.dirSource) {
    for (const lf of out.labelFiles) await state.dirSource.writeFile(lf.path, new Blob([lf.text]));
    await state.dirSource.writeFile('dataset.yaml', new Blob([out.yaml]));
    for (let idx = 0; idx < out.images.length; idx++) {
      const im = out.images[idx];
      const f = state.images?.get(idx);
      if (f) await state.dirSource.writeFile(`images/${im.split}/${im.file_name}`, f);
    }
    $('status').textContent = '已导出 YOLO-pose 到目录（labels/ images/ dataset.yaml）';
  } else {
    const parts = [out.yaml, ...out.labelFiles.map((f) => `# ${f.path}\n${f.text}`)].join('\n\n');
    triggerDownload(new Blob([parts]), 'yolo_pose_labels.txt');
    $('status').textContent = '已下载 labels + yaml（图像请自行放入 images/）';
  }
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

state.diagram = new BodyDiagram($('diagram-host'), skel, (idx) => {
  if (!state.store?.selected()) { $('status').textContent = '请先新建/选中一个人'; return; }
  state.mode = 'pose'; state.armed = idx; refresh();
});
window.addEventListener('resize', () => { if (state.bitmap) { fitCanvas(); render(); } });
syncUI();
