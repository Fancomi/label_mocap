// label/src/app.js — M1 skeleton: load, render, navigate. No editing yet.
import { loadModel } from '../../smpl_core/smpl_model.js';
import { forwardSmpl } from '../../smpl_core/lbs.js';
import { CocoDocument } from './io/coco_document.js';
import { buildFrames, isPortrait } from './io/source_loader.js';
import { AnnotationStore } from './edit/annotation_store.js';
import { CameraModes } from './scene/camera_modes.js';
import { LabelScene } from './scene/scene.js';

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };

const MODEL_URL = new URL('../../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url);
let model = null, scene = null, cam = null, store = null;
let images = new Map();      // index -> File
let readOnly = false;
let textureLoader = null;
let currentTexture = null;

function isJpeg(name) { return /\.(jpe?g)$/i.test(name); }

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
  $('slider').max = String(Math.max(0, store.frameCount() - 1));
  $('slider').value = '0';
  if (!model) { model = await loadModel(MODEL_URL); scene.setTopology(model.faces); }
  await showFrame(0);
}

async function showFrame(i) {
  store.setFrame(i);
  $('frame-info').textContent = `${i} / ${store.frameCount() - 1}`;
  const a = store.current();
  if (a) {
    const out = forwardSmpl(model, { root_pos: a.root_pos, root_rota: a.root_rota, body_pose: a.body_pose, betas: a.betas });
    scene.updateMesh(out.vertices, out.joints);
  }
  const file = images.get(i);
  if (file) {
    const url = URL.createObjectURL(file);
    textureLoader ||= new (await import('three')).TextureLoader();
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
  $('btn-2d').addEventListener('click', () => { cam.switchTo('2d'); });
  $('btn-3d').addEventListener('click', () => { cam.switchTo('3d'); });
  $('slider').addEventListener('input', (e) => showFrame(+e.target.value));
  $('btn-prev').addEventListener('click', () => showFrame(Math.max(0, store.currentFrame() - 1)));
  $('btn-next').addEventListener('click', () => showFrame(Math.min(store.frameCount() - 1, store.currentFrame() + 1)));
  function loop() { cam.update(); scene.render(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
}
boot();
