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
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();

// Lighting — hemisphere + key directional. Cheap, looks decent on white skin.
scene.add(new THREE.HemisphereLight(0xddeeff, 0x223344, 0.55));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
keyLight.position.set(3, 5, -2);
scene.add(keyLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.15));

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

// Re-evaluate visibility of mode-sensitive helpers (grid hidden in 2D).
function applyVisibility() {
  if (!cam) return;
  if (mesh) mesh.visible = flags.mesh;
  if (pointsGroup) pointsGroup.visible = flags.points;
  if (bonesGroup) bonesGroup.visible = flags.bones;
  if (grid) grid.visible = flags.grid && cam.mode === '3d';
  if (axes) axes.visible = flags.axes && cam.mode === '3d';
  if (bg) bg.visible = flags.bg;
  if (frustum) frustum.visible = cam.mode === '3d';
}

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
let seqEpoch = 0;          // bumped on every selectSeq; stale loads bail
let frameBusy = false;     // gate for tick() to avoid concurrent setFrame

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
  // Stop the play loop and bump epoch — any in-flight setFrame from prior
  // sequence will see a stale epoch and bail before mutating scene state.
  playing = false;
  $('btn-play').textContent = '▶ 播放';
  $('btn-play').classList.remove('on');
  seqEpoch++;
  const myEpoch = seqEpoch;

  const [src, name] = seqId.split('/');
  setStatus(`loading meta for ${seqId}…`);
  const meta = await (await fetch(`/seq/${src}/${name}/meta`)).json();
  if (myEpoch !== seqEpoch) return;
  setStatus(`forwarding SMPL (~10s on first call)…`);
  const facesBuf = await (await fetch(meta.faces_url)).arrayBuffer();
  if (myEpoch !== seqEpoch) return;
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
  syncIntrinsicsPanel(cam.K);

  bg = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ depthWrite: false, color: 0xffffff }));
  bg.renderOrder = 0;
  scene.add(bg);

  // White skin + simple lighting (Lambert is cheap and looks fine here).
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6890 * 3), 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
  geom.computeVertexNormals();
  mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({
    color: 0xf0f0f0, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;   // bbox stays at origin since we update positions in-place
  mesh.renderOrder = 5;
  scene.add(mesh);

  pointsGroup = new THREE.Group();
  pointsGroup.frustumCulled = false;
  pointsGroup.renderOrder = 11;
  scene.add(pointsGroup);
  for (let i = 0; i < 24; i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false }));
    p.frustumCulled = false;
    p.renderOrder = 11;
    pointsGroup.add(p);
  }
  bonesGroup = new THREE.Group();
  bonesGroup.frustumCulled = false;
  bonesGroup.renderOrder = 11;
  scene.add(bonesGroup);
  for (const [, , g] of BONES) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: BONE_COLORS[g], depthTest: false }));
    line.frustumCulled = false;
    line.renderOrder = 11;
    bonesGroup.add(line);
  }
  frustum = makeFrustum(meta);
  frustum.frustumCulled = false;
  scene.add(frustum);

  try { await applyFrame(0); }
  catch (_) { /* stale-epoch — outer return below */ }
  if (myEpoch !== seqEpoch) return;

  // 用户偏好: 切换序列后立即跳到 2D 对齐, 让数据切换可视化.
  cam.snapTo('2d');
  applyMode('2d');
  setStatus(`${seqId} ready (${curN} frames) · 2D`);
}

async function loadFrame(i) {
  // Returns {verts, joints, root, tex} — fetched in parallel, cached.
  // Caller must handle epoch/staleness; this is a pure data fetch.
  if (frameCache.has(i)) return frameCache.get(i);
  const { src, name } = curSeq;
  const myEpoch = seqEpoch;

  const binP = fetch(`/seq/${src}/${name}/frame/${i}.bin`).then(r => r.arrayBuffer());
  const texP = new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      `/seq/${src}/${name}/img/${i}.jpg`,
      t => { t.colorSpace = THREE.SRGBColorSpace; resolve(t); },
      undefined, reject);
  });
  const [buf, tex] = await Promise.all([binP, texP]);
  if (myEpoch !== seqEpoch) {
    tex.dispose();
    throw new Error('stale-epoch');
  }
  const verts = new Float32Array(buf, 0, 6890 * 3);
  const joints = new Float32Array(buf, 6890 * 3 * 4, 24 * 3);
  const root = new Float32Array(buf, (6890 * 3 + 24 * 3) * 4, 3);
  const entry = { verts, joints, root, tex };
  frameCache.set(i, entry);
  return entry;
}

// Atomically apply a fully-loaded frame to the scene.
// All geometry/texture updates land in the same RAF tick to avoid
// the "new mesh + old image" tear during playback or seq switch.
async function applyFrame(i) {
  const myEpoch = seqEpoch;
  const f = await loadFrame(i);
  if (myEpoch !== seqEpoch) return;

  curFrame = i;
  $('frame-slider').value = curFrame;
  $('frame-info').textContent = `${curFrame} / ${curN - 1}`;

  // mesh verts
  const pos = mesh.geometry.attributes.position;
  pos.array.set(f.verts);
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();

  // joints + bones
  for (let j = 0; j < 24; j++) {
    pointsGroup.children[j].position.set(
      f.joints[j * 3], f.joints[j * 3 + 1], f.joints[j * 3 + 2]);
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

  // background image (texture is already loaded; just rebind)
  bg.material.map = f.tex;
  bg.material.needsUpdate = true;

  layoutBg();
  renderAngles(f.joints);
}

// Old setFrame is now a thin wrapper used by UI handlers.
async function setFrame(i) {
  if (curN === 0) return;
  const target = Math.max(0, Math.min(curN - 1, i | 0));
  await applyFrame(target);
}

function layoutBg() {
  const p = cam.bgPlaneParams();
  bg.geometry.dispose();
  bg.geometry = new THREE.PlaneGeometry(p.w, p.h);
  bg.position.set(0, 0, p.z);
  applyVisibility();
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

// ── Intrinsics panel ───────────────────────────────────────────────────────
function syncIntrinsicsPanel(K) {
  $('k-fx').value = K.fx;
  $('k-fy').value = K.fy;
  $('k-cx').value = K.cx;
  $('k-cy').value = K.cy;
}
function readIntrinsicsPanel() {
  return {
    fx: parseFloat($('k-fx').value),
    fy: parseFloat($('k-fy').value),
    cx: parseFloat($('k-cx').value),
    cy: parseFloat($('k-cy').value),
  };
}
['k-fx', 'k-fy', 'k-cx', 'k-cy'].forEach(id => {
  $(id).addEventListener('input', () => {
    if (!cam) return;
    cam.setIntrinsics(readIntrinsicsPanel());
    layoutBg();
  });
});
$('btn-k-reset').addEventListener('click', () => {
  if (!cam || !curSeq) return;
  cam.setIntrinsics(curSeq.meta.K);
  syncIntrinsicsPanel(cam.K);
  layoutBg();
});

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
$('frame-slider').addEventListener('input', e => {
  // Drag-to-scrub: stop playback so we don't fight the play loop on the same frame.
  if (playing) {
    playing = false;
    $('btn-play').textContent = '▶ 播放';
    $('btn-play').classList.remove('on');
  }
  setFrame(+e.target.value);
});
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
    applyVisibility();
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

  // Frame advance: serial — never schedule a second setFrame while one is
  // still loading. Prevents the "stale-frame splash" on slow image fetches.
  if (playing && curN > 0 && !frameBusy) {
    accT += ts - lastTickTs;
    const iv = 1000 / fps;
    if (accT >= iv) {
      accT = accT % iv;
      const next = (curFrame + 1) % curN;
      const myEpoch = seqEpoch;
      frameBusy = true;
      try { await applyFrame(next); }
      catch (_) { /* stale-epoch or fetch err — drop */ }
      finally { if (myEpoch === seqEpoch) frameBusy = false; }
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
      // selectSeq already snaps to 2D and applies frame 0.
      if (validateFrame !== 0) await applyFrame(validateFrame);
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
