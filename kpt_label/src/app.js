// kpt_label/src/app.js
// 2D 关键点标注器装配层（DOM/canvas 耦合，浏览器内验证）。
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
import { transform, clampCenter, screenToImg, zoomAt, ZOOM_MIN } from './viewport.js';

const $ = (id) => document.getElementById(id);
const skel = getSkeleton('coco17');
const PROJECT_FILE = 'kpt_label_project.json';   // 工程文件（可载入续标）；区别于 export 的单向产物

const state = {
  store: null, dirSource: null, video: null, images: null /* Map<idx,File> */,
  imgW: 1920, imgH: 1080, bitmap: null,
  zoom: 1, cx: 960, cy: 540,        // zoom≥1（1=fit）；(cx,cy)=显示在视口中心的图像点
  mode: 'pose', armed: -1,
  diagram: null,
};

const canvas = $('canvas');
const ctx = canvas.getContext('2d');

// 视口几何参数（视口尺寸即 canvas 像素尺寸，铺满 stage）。
function vp() {
  return { vw: canvas.width, vh: canvas.height, imgW: state.imgW, imgH: state.imgH, zoom: state.zoom, cx: state.cx, cy: state.cy };
}
function xform() { return transform(vp()); }
// 把中心点钳制回有效区间（图像不完全移出、无黑边）并写回 state。
function clampView() {
  const { cx, cy } = clampCenter(vp());
  state.cx = cx; state.cy = cy;
}
// 鼠标事件 → 图像像素坐标。
function eventToImage(ev) {
  const r = canvas.getBoundingClientRect();
  // canvas CSS 尺寸=绘制像素尺寸（无 DPR 缩放），rect 与像素一一对应。
  return screenToImg(ev.clientX - r.left, ev.clientY - r.top, xform());
}
// 屏幕命中半径(px) → 图像像素半径（除以当前 scale）。
function hitRadius(px = 8) { return px / xform().scale; }

// canvas 铺满整个 stage（不再按图像宽高比 letterbox）。fit 由 viewport 内部处理：
// zoom=1 时图像长边顶住 canvas、短边在 canvas 内留黑边；放大后图像覆盖超出区域可见。
function fitCanvas() {
  const stage = $('stage');
  canvas.width = Math.round(stage.clientWidth);
  canvas.height = Math.round(stage.clientHeight);
  clampView();
}

function render() {
  if (!state.bitmap) return;
  const t = xform();
  drawImage(ctx, state.bitmap, t, state.imgW, state.imgH, canvas.width, canvas.height);
  if (state.store) drawPersons(ctx, state.store.persons(), state.store.selectedId(), skel, t, state.armed);
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
    el.addEventListener('click', () => { state.store.select(p.id); state.armed = -1; refresh(); });
    list.appendChild(el);
  }
  const sel = state.store?.selected();
  state.diagram?.update(sel ? sel.keypoints : null, state.armed);
}

function refresh() { render(); syncUI(); }

// 重置视口到 fit：zoom=1，中心=图像中心。
function resetView() {
  state.zoom = ZOOM_MIN; state.cx = state.imgW / 2; state.cy = state.imgH / 2;
}

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
  resetView();
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
  // 仿 label：再选一个可写目录，标注/导出原地写回该目录（Chrome/Edge）。
  let dir = null;
  if (fsAccessSupported()) {
    $('status').textContent = '请选择用于读写标注的文件夹（可选视频所在目录）';
    try { dir = new DirSource(await pickDirectory()); await dir.scan(); } catch { dir = null; }
  }
  const vf = await new VideoFrames(file).ready();
  state.video?.dispose();
  state.video = vf; state.images = null; state.dirSource = dir;
  state.imgW = vf.width; state.imgH = vf.height;
  const n = vf.frameCount();
  const metas = Array.from({ length: n }, (_, i) => ({ file_name: `frame_${String(i).padStart(6, '0')}.jpg`, width: vf.width, height: vf.height }));
  // 目录内若有本工具工程文件，续标。
  const proj = dir ? await readProjectFile(dir) : null;
  state.store = proj?.schema === 'kpt-label/v1'
    ? KptStore.fromJSON(proj, skel.names.length)
    : new KptStore({ images: metas, skeleton: 'coco17', nkpt: skel.names.length });
  resetView();
  $('frame-slider').max = String(state.store.frameCount() - 1);
  await loadFrame(0);
  $('status').textContent = dir ? `已加载视频（${n} 帧）+ 可原地保存` : `已加载视频（${n} 帧，无目录权限，保存将下载）`;
}

$('stage').addEventListener('wheel', (ev) => {
  if (!state.bitmap) return;
  ev.preventDefault();
  const r = canvas.getBoundingClientRect();
  const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
  if (sx < 0 || sx > canvas.width || sy < 0 || sy > canvas.height) return;
  const factor = Math.exp(-ev.deltaY * 0.0015);
  const next = zoomAt(vp(), sx, sy, factor);   // 以光标为锚缩放
  state.zoom = next.zoom; state.cx = next.cx; state.cy = next.cy;
  clampView();
  render();
}, { passive: false });

let drag = null;
canvas.addEventListener('pointerdown', (ev) => {
  if (!state.store) return;
  const [ix, iy] = eventToImage(ev);
  const r = hitRadius();
  if (ev.shiftKey) { drag = { kind: 'pan', x: ev.clientX, y: ev.clientY, cx: state.cx, cy: state.cy }; canvas.setPointerCapture(ev.pointerId); return; }
  const sel = state.store.selected();
  if (sel) {
    // 命中已标关节：选中它（=SVG 点它，进入 armed），并预备拖动微调。move 超阈值才算拖。
    const ki = hitKeypoint(sel, [ix, iy], r);
    if (ki >= 0) { armKeypoint(ki); state.store.beginEdit(); drag = { kind: 'kpt', idx: ki, moved: false, x: ev.clientX, y: ev.clientY }; canvas.setPointerCapture(ev.pointerId); return; }
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
  if (hid != null) { state.store.select(hid); state.armed = -1; refresh(); }
});

canvas.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  if (drag.kind === 'pan') {
    // 屏幕位移 → 图像位移（除以 scale）；中心点反向移动。
    const s = xform().scale;
    state.cx = drag.cx - (ev.clientX - drag.x) / s;
    state.cy = drag.cy - (ev.clientY - drag.y) / s;
    clampView(); render(); return;
  }
  const [ix, iy] = eventToImage(ev);
  if (drag.kind === 'kpt') {
    if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 3) return;  // 阈值内只算点选不微调
    drag.moved = true;
    state.store.applyKeypoint(drag.idx, ix, iy, state.store.selected().keypoints[drag.idx][2] || 2); render();
  }
  else if (drag.kind === 'corner') { state.store.applyBbox(resizeBboxByCorner(state.store.selected().bbox, drag.corner, [ix, iy])); render(); }
  else if (drag.kind === 'bbox') { state.store.applyBbox(normRect(drag.x0, drag.y0, ix, iy)); render(); }
});

canvas.addEventListener('pointerup', (ev) => {
  // kpt 若没真正拖动（moved=false），提交的是空事务——commit 仍安全（无变化的快照）。
  if (drag && drag.kind !== 'pan') state.store.commitEdit();
  if (drag) { try { canvas.releasePointerCapture(ev.pointerId); } catch {} }
  drag = null; refresh();
});

// 右键切可见性：优先作用于命中的已标点，否则作用于当前 armed 关节。统一入口 cycleVisibility。
$('stage').addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const sel = state.store?.selected();
  if (!sel) { $('status').textContent = '右键切可见性：请先选中一个人'; return; }
  const [ix, iy] = eventToImage(ev);
  const ki = hitKeypoint(sel, [ix, iy], hitRadius(12));
  const target = ki >= 0 ? ki : state.armed;
  if (target < 0) { $('status').textContent = '右键未命中关键点；先在人体图选一个关节'; return; }
  cycleVisibility(target);
});

// 按 skeleton.order（深度优先）找 from 之后的下一个未标关节；都标完返回 -1。
function nextUnset(person, from) {
  const ord = skel.order;
  const start = ord.indexOf(from);
  for (let i = 1; i <= ord.length; i++) {
    const j = ord[(start + i) % ord.length];
    if (person.keypoints[j][2] === 0) return j;
  }
  return -1;
}

// —— 关节统一操作入口：SVG 点击 / 图上点中 / 右键 都走这两个函数 ——
// 选中（armed）某关节：切到 pose 模式并高亮；需已有选中人。
function armKeypoint(idx) {
  if (!state.store?.selected()) { $('status').textContent = '请先新建/选中一个人'; return; }
  state.mode = 'pose'; state.armed = idx; refresh();
}
// 切某关节可见性 2(可见)→1(遮挡)→0(清除)；保留原坐标。
function cycleVisibility(idx) {
  const sel = state.store?.selected(); if (!sel) return;
  const [x, y, v] = sel.keypoints[idx];
  const nv = v === 2 ? 1 : v === 1 ? 0 : 2;
  if (nv === 0) state.store.setKeypoint(idx, 0, 0, 0);
  else state.store.setKeypoint(idx, x, y, nv);
  $('status').textContent = `${skel.names[idx]} → ${nv === 2 ? '可见' : nv === 1 ? '遮挡' : '清除'}`;
  refresh();
}

// 「选择数据」下拉菜单（对齐 label）。
$('btn-open').addEventListener('click', () => { $('open-menu').hidden = !$('open-menu').hidden; });
document.addEventListener('click', (e) => { if (!e.target.closest('.menu-anchor')) $('open-menu').hidden = true; });
$('open-dir').addEventListener('click', () => { $('open-menu').hidden = true; openDirectory().catch(reportErr); });
$('open-video').addEventListener('click', () => { $('open-menu').hidden = true; openVideo().catch(reportErr); });
$('prev').addEventListener('click', () => state.store && loadFrame(Math.max(0, state.store.currentFrame() - 1)));
$('next').addEventListener('click', () => state.store && loadFrame(Math.min(state.store.frameCount() - 1, state.store.currentFrame() + 1)));
$('frame-slider').addEventListener('input', (e) => state.store && loadFrame(Number(e.target.value)));
$('add-person').addEventListener('click', () => { if (!state.store) return; state.store.addPerson(); state.armed = state.mode === 'pose' ? 0 : -1; refresh(); });
$('del-person').addEventListener('click', () => { if (!state.store) return; state.store.deletePerson(); state.armed = -1; refresh(); });
$('copy-prev').addEventListener('click', () => copyPrev());
for (const t of document.querySelectorAll('#tabs .tab')) t.addEventListener('click', () => { state.mode = t.dataset.mode; state.armed = -1; refresh(); });
$('save-json').addEventListener('click', () => saveProject().catch(reportErr));
$('export').addEventListener('click', () => exportYolo().catch(reportErr));

// 用户取消文件/目录选择器（AbortError）是正常操作，不报错。
function reportErr(e) {
  if (e?.name === 'AbortError') return;
  $('status').textContent = String(e?.message || e);
}

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
  else if (ev.key === 's' || ev.key === 'S') { saveProject().catch(reportErr); }
  else if (ev.key === 'Tab') { ev.preventDefault(); cycleSelect(); }
  else if (ev.key === 'b' || ev.key === 'B') { state.mode = 'bbox'; state.armed = -1; refresh(); }
  else if (ev.key === 'k' || ev.key === 'K') { state.mode = 'pose'; refresh(); }
  else if (ev.key === 'f' || ev.key === 'F') focusSelected();
  else if (ev.key === 'r' || ev.key === 'R') { resetView(); render(); }
  else if (ev.key === 'z' || ev.key === 'Z') { state.store.undo(); refresh(); }
});

function cycleSelect() {
  const ps = state.store.persons(); if (!ps.length) return;
  const i = ps.findIndex((p) => p.id === state.store.selectedId());
  state.store.select(ps[(i + 1) % ps.length].id); refresh();
}

// F 聚焦：把选中人的框（或关键点包围盒）放大居中。
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
  state.zoom = Math.min(8, Math.max(2, 0.6 * Math.min(state.imgW / Math.max(1, bw), state.imgH / Math.max(1, bh))));
  state.cx = bx + bw / 2; state.cy = by + bh / 2;
  clampView(); render();
}

// 保存工程（可再次载入续标）：优先原地写回目录的 PROJECT_FILE，否则下载。
async function saveProject() {
  if (!state.store) return;
  const text = JSON.stringify(state.store.serialize(), null, 2);
  if (state.dirSource) {
    await state.dirSource.writeFile(PROJECT_FILE, new Blob([text], { type: 'application/json' }));
    $('status').textContent = '工程已原地保存';
  } else {
    triggerDownload(new Blob([text], { type: 'application/json' }), PROJECT_FILE);
    $('status').textContent = '工程已下载（载入续标需用图像目录）';
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

state.diagram = new BodyDiagram($('diagram-host'), skel, {
  onPick: (idx) => armKeypoint(idx),       // SVG 左键选关节 = 图上点中关节
  onToggle: (idx) => { armKeypoint(idx); cycleVisibility(idx); },  // SVG 右键切可见性
});
$('show-kpt-label').addEventListener('change', (e) => state.diagram.setLabelVisible(e.target.checked));
window.addEventListener('resize', () => { if (state.bitmap) { fitCanvas(); render(); } });
syncUI();
