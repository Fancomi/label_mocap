// label_mocap/smpl_viewer/viewer.js
import * as THREE from 'three';
import { CameraModes } from '/smpl_viewer/camera_modes.js';

// Shared schema with kps3d_viewer.html
// BONES: [child_kp_idx, parent_kp_idx, group]
// SMPL joint indices match the 24-joint convention used by data_convert.
const BONES = [
  [0,3,0],[3,6,0],[6,9,0],[9,12,0],[12,15,0],
  [9,13,1],[13,16,1],[16,18,1],[18,20,1],[20,22,1],
  [9,14,2],[14,17,2],[17,19,2],[19,21,2],[21,23,2],
  [0,1,3],[1,4,3],[4,7,3],[7,10,3],
  [0,2,4],[2,5,4],[5,8,4],[8,11,4],
];
const BONE_COLORS = [0xd4b800, 0x4da6ff, 0xff7733, 0x33cc66, 0xcc44cc];

const ANGLES = [
  ['R-Elbow',16,18,20], ['L-Elbow',17,19,21],
  ['R-Knee',  1, 4, 7], ['L-Knee',  2, 5, 8],
  ['R-Shoulder',9,16,18], ['L-Shoulder',9,17,19],
  ['R-Hip',  0, 1, 4], ['L-Hip',  0, 2, 5],
  ['Spine',  0, 6,12],
];

const params = new URLSearchParams(location.search);
const validate = params.get('validate') === '1';
const validateSeq = params.get('seq');
const validateFrame = parseInt(params.get('frame') || '0', 10);

const $ = id => document.getElementById(id);
const status = $('status');
function setStatus(t) { status.textContent = t; }

// ── Three.js skeleton ─────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({
  canvas: $('c'), antialias: true, preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setClearColor(0x111111, 1);
const scene = new THREE.Scene();

let cam = null;            // CameraModes instance, created after meta loads
let bg = null;             // background image plane
let bgTex = null;
let mesh = null;
let bonesGroup = null;
let pointsGroup = null;
let frustum = null;
let grid = null;
let axes = null;

const flags = { mesh: true, points: true, bones: true, grid: true, axes: false, bg: true };

function ensureGridAxes() {
  if (!grid) {
    grid = new THREE.GridHelper(20, 40, 0x335577, 0x223344);
    grid.position.y = -1.0;
    grid.material.opacity = 0.6;
    grid.material.transparent = true;
    scene.add(grid);
  }
  if (!axes) {
    axes = new THREE.AxesHelper(0.5);
    axes.visible = flags.axes;
    scene.add(axes);
  }
  grid.visible = flags.grid;
  axes.visible = flags.axes;
}

function makeFrustum(meta) {
  const fovY = THREE.MathUtils.degToRad(2 * Math.atan(meta.image_h / (2 * meta.K.fy)) * 180 / Math.PI);
  const aspect = meta.image_w / meta.image_h;
  const d = 2.0;
  const h = 2 * Math.tan(fovY / 2) * d;
  const w = h * aspect;
  const corners = [
    new THREE.Vector3( w/2,  h/2, -d), new THREE.Vector3(-w/2,  h/2, -d),
    new THREE.Vector3(-w/2, -h/2, -d), new THREE.Vector3( w/2, -h/2, -d),
  ];
  const O = new THREE.Vector3();
  const segs = [
    O, corners[0], O, corners[1], O, corners[2], O, corners[3],
    corners[0], corners[1], corners[1], corners[2],
    corners[2], corners[3], corners[3], corners[0],
  ];
  const geom = new THREE.BufferGeometry().setFromPoints(segs);
  return new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: 0x66aaff }));
}

// ── Sequence loading ──────────────────────────────────────────────────────
let curSeq = null;
let curFrame = 0;
let curN = 0;
let frameCache = new Map();
let playing = false;
let fps = 24;
let lastTickTs = 0;
let accT = 0;

async function loadSeqList() {
  const resp = await fetch('/seqs');
  const j = await resp.json();
  const sel = $('seq-select');
  sel.innerHTML = '';
  j.seqs.forEach(s => {
    const o = document.createElement('option');
    o.value = `${s.src}/${s.name}`;
    o.textContent = `${s.src}/${s.name} (${s.n_frames}f${s.portrait ? ', portrait' : ''})`;
    sel.appendChild(o);
  });
  return j.seqs;
}

async function selectSeq(seqId) {
  const [src, name] = seqId.split('/');
  setStatus(`loading meta for ${seqId}…`);
  const meta = await (await fetch(`/seq/${src}/${name}/meta`)).json();
  setStatus(`forwarding SMPL (~10s on first call)…`);
  const facesBuf = await (await fetch(meta.faces_url)).arrayBuffer();
  const faces = new Int32Array(facesBuf);

  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
  if (bonesGroup) { scene.remove(bonesGroup); bonesGroup = null; }
  if (pointsGroup) { scene.remove(pointsGroup); pointsGroup = null; }
  if (frustum) { scene.remove(frustum); frustum.geometry.dispose(); frustum.material.dispose(); frustum = null; }
  if (bg) { scene.remove(bg); bg.geometry.dispose(); bg.material.dispose(); bg = null; }
  if (bgTex) { bgTex.dispose(); bgTex = null; }
  if (cam) { cam.controls.dispose(); cam = null; }
  frameCache.clear();

  curSeq = { src, name, meta, faces };
  curN = meta.n_frames;
  curFrame = 0;

  $('frame-slider').max = curN - 1;
  $('frame-info').textContent = `0 / ${curN - 1}`;

  ensureGridAxes();
  cam = new CameraModes({ canvas: renderer.domElement, meta });

  bg = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ depthWrite: false }));
  bg.renderOrder = 0;
  scene.add(bg);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6890 * 3), 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
  geom.computeVertexNormals();
  mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    color: 0x00dd00, wireframe: true, depthTest: false, depthWrite: false,
  }));
  mesh.renderOrder = 10;
  scene.add(mesh);

  pointsGroup = new THREE.Group();
  pointsGroup.renderOrder = 11;
  scene.add(pointsGroup);
  for (let i = 0; i < 24; i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false }));
    p.renderOrder = 11;
    pointsGroup.add(p);
  }
  bonesGroup = new THREE.Group();
  bonesGroup.renderOrder = 11;
  scene.add(bonesGroup);
  for (const [, , g] of BONES) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: BONE_COLORS[g], depthTest: false }));
    line.renderOrder = 11;
    bonesGroup.add(line);
  }
  frustum = makeFrustum(meta);
  scene.add(frustum);

  await loadFrame(0);
  applyMode(cam.mode);
  setStatus(`${seqId} ready (${curN} frames)`);
}

async function loadFrame(i) {
  if (frameCache.has(i)) return frameCache.get(i);
  const { src, name } = curSeq;
  const buf = await (await fetch(`/seq/${src}/${name}/frame/${i}.bin`)).arrayBuffer();
  const verts = new Float32Array(buf, 0, 6890 * 3);
  const joints = new Float32Array(buf, 6890 * 3 * 4, 24 * 3);
  const root = new Float32Array(buf, (6890 * 3 + 24 * 3) * 4, 3);
  const entry = { verts, joints, root };
  frameCache.set(i, entry);
  return entry;
}

async function setFrame(i) {
  curFrame = Math.max(0, Math.min(curN - 1, i | 0));
  $('frame-slider').value = curFrame;
  $('frame-info').textContent = `${curFrame} / ${curN - 1}`;

  const f = await loadFrame(curFrame);
  const pos = mesh.geometry.attributes.position;
  pos.array.set(f.verts);
  pos.needsUpdate = true;

  for (let j = 0; j < 24; j++) {
    const x = f.joints[j * 3], y = f.joints[j * 3 + 1], z = f.joints[j * 3 + 2];
    pointsGroup.children[j].position.set(x, y, z);
  }
  for (let bi = 0; bi < BONES.length; bi++) {
    const [a, b] = BONES[bi];
    const line = bonesGroup.children[bi];
    line.geometry.setFromPoints([
      new THREE.Vector3(f.joints[a * 3], f.joints[a * 3 + 1], f.joints[a * 3 + 2]),
      new THREE.Vector3(f.joints[b * 3], f.joints[b * 3 + 1], f.joints[b * 3 + 2]),
    ]);
    line.geometry.attributes.position.needsUpdate = true;
  }
  cam.set3DFollowTarget(new THREE.Vector3(f.joints[0], f.joints[1], f.joints[2]));

  const newTex = await new Promise(resolve => {
    new THREE.TextureLoader().load(`/seq/${curSeq.src}/${curSeq.name}/img/${curFrame}.jpg`, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      resolve(t);
    });
  });
  if (bgTex) bgTex.dispose();
  bgTex = newTex;
  bg.material.map = bgTex;
  bg.material.needsUpdate = true;
  layoutBg();
  renderAngles(f.joints);
}

function layoutBg() {
  const p = cam.bgPlaneParams();
  bg.geometry.dispose();
  bg.geometry = new THREE.PlaneGeometry(p.w, p.h);
  bg.position.set(0, 0, p.z);
  bg.visible = flags.bg;
  frustum.visible = (cam.mode === '3d');
}

function renderAngles(joints) {
  const html = ANGLES.map(([label, a, v, b]) => {
    const ax = joints[a*3]-joints[v*3], ay = joints[a*3+1]-joints[v*3+1], az = joints[a*3+2]-joints[v*3+2];
    const bx = joints[b*3]-joints[v*3], by = joints[b*3+1]-joints[v*3+1], bz = joints[b*3+2]-joints[v*3+2];
    const la = Math.hypot(ax,ay,az), lb = Math.hypot(bx,by,bz);
    let deg = 0;
    if (la > 1e-9 && lb > 1e-9) {
      const c = Math.min(1, Math.max(-1, (ax*bx + ay*by + az*bz) / (la*lb)));
      deg = Math.acos(c) * 180 / Math.PI;
    }
    return `<div class="ar"><span>${label}</span><span>${deg.toFixed(1)}°</span></div>`;
  }).join('');
  $('angle-list').innerHTML = html;
}

function applyMode(mode) {
  $('btn-mode-3d').classList.toggle('on', mode === '3d');
  $('btn-mode-2d').classList.toggle('on', mode === '2d');
  layoutBg();
}

// ── UI wiring ──────────────────────────────────────────────────────────────
$('seq-select').addEventListener('change', e => selectSeq(e.target.value));
$('btn-mode-3d').addEventListener('click', () => { cam.switchTo('3d'); applyMode('3d'); });
$('btn-mode-2d').addEventListener('click', () => { cam.switchTo('2d'); applyMode('2d'); });
$('btn-play').addEventListener('click', () => {
  playing = !playing;
  $('btn-play').textContent = playing ? '⏸ 暂停' : '▶ 播放';
  $('btn-play').classList.toggle('on', playing);
});
$('btn-prev').addEventListener('click', () => setFrame(curFrame - 1));
$('btn-next').addEventListener('click', () => setFrame(curFrame + 1));
$('frame-slider').addEventListener('input', e => setFrame(+e.target.value));
$('speed-slider').addEventListener('input', e => {
  fps = +e.target.value; $('speed-val').textContent = `${fps} fps`;
});
const flagBtns = [
  ['btn-mesh','mesh'], ['btn-points','points'], ['btn-bones','bones'],
  ['btn-grid','grid'], ['btn-axes','axes'], ['btn-bg','bg'],
];
flagBtns.forEach(([id, key]) => {
  $(id).addEventListener('click', e => {
    flags[key] = !flags[key];
    e.target.classList.toggle('on', flags[key]);
    if (mesh && key === 'mesh') mesh.visible = flags.mesh;
    if (pointsGroup && key === 'points') pointsGroup.visible = flags.points;
    if (bonesGroup && key === 'bones') bonesGroup.visible = flags.bones;
    if (grid && key === 'grid') grid.visible = flags.grid;
    if (axes && key === 'axes') axes.visible = flags.axes;
    if (bg && key === 'bg') bg.visible = flags.bg;
  });
});

window.addEventListener('resize', resize);
function resize() {
  const c = renderer.domElement;
  const w = c.clientWidth, h = c.clientHeight;
  renderer.setSize(w, h, false);
  if (cam) {
    cam.camera.aspect = w / h;
    cam.camera.updateProjectionMatrix();
  }
}

// ── Render loop ────────────────────────────────────────────────────────────
async function tick(ts) {
  requestAnimationFrame(tick);
  if (playing && curN > 0) {
    accT += ts - lastTickTs;
    const iv = 1000 / fps;
    if (accT >= iv) {
      accT = accT % iv;
      await setFrame((curFrame + 1) % curN);
    }
  }
  lastTickTs = ts;
  if (cam) {
    cam.update(ts);
    layoutBg();
    renderer.render(scene, cam.camera);
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
(async function () {
  const seqs = await loadSeqList();
  resize();
  if (validate) {
    if (validateSeq) {
      $('seq-select').value = validateSeq;
      await selectSeq(validateSeq);
      cam.switchTo('2d');
      cam.update(performance.now() + 9999);
      applyMode('2d');
      await setFrame(validateFrame);
      renderer.render(scene, cam.camera);
      const tag = `${validateSeq.replace('/', '_')}_f${String(validateFrame).padStart(4, '0')}`;
      const a = document.createElement('a');
      a.download = `viewer_${tag}.png`;
      a.href = renderer.domElement.toDataURL('image/png');
      a.click();
      setStatus(`saved viewer_${tag}.png`);
      return;
    }
  }
  if (seqs.length > 0) await selectSeq(seqs[0].src + '/' + seqs[0].name);
  requestAnimationFrame(ts => { lastTickTs = ts; tick(ts); });
})();
