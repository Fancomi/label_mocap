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
// devicePixelRatio so the rendered texture isn't blurry on HiDPI displays
// (was setPixelRatio(1) → upscaled blur on retina). Capped at 2 to keep
// fragment-shader cost sane.
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x0f1216, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();

// Lighting — hemisphere + key directional. Cheap, looks decent on white skin.
scene.add(new THREE.HemisphereLight(0xddeeff, 0x223344, 0.55));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
keyLight.position.set(3, 5, -2);
scene.add(keyLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.15));

let cam = null;            // CameraModes instance, created after meta loads
let bgNear = null;         // 3D-mode near image plane (1.5m)
let bgFar = null;          // both-mode far image plane (50m)
let bgTex = null;          // shared texture for both planes
// `dataRotCw` rotates BOTH the SMPL geometry (vertices/joints) and the bg
// texture by N×90° clockwise about the camera -Z axis. Camera intrinsics &
// extrinsics never change. Each press of CCW/CW shifts dataRotCw by ∓1 mod 4.
// 0 = native capture, 1 = 90° CW (turns sideways portrait into "upright"
// from the camera's POV after flipping the canvas? no — just rotates
// content; user picks whichever orientation reads).
let dataRotCw = 0;
let mesh = null;
let bonesGroup = null;
let pointsGroup = null;
let frustum = null;
let grid = null;
let axes = null;
let gridSize = 20;
let gridStep = 0.5;

const flags = { mesh: true, points: true, bones: true, grid: true, axes: false, bg: true };

// Re-evaluate visibility of mode-sensitive helpers (grid hidden in 2D).
function applyVisibility() {
  if (!cam) return;
  if (mesh) mesh.visible = flags.mesh;
  if (pointsGroup) pointsGroup.visible = flags.points;
  if (bonesGroup) bonesGroup.visible = flags.bones;
  if (grid) grid.visible = flags.grid && cam.mode === '3d';
  if (axes) axes.visible = flags.axes && cam.mode === '3d';
  // Two image planes: far always on (visible from both modes), near only in 3D.
  if (bgFar) bgFar.visible = flags.bg;
  if (bgNear) bgNear.visible = flags.bg && cam.mode === '3d';
  if (frustum) frustum.visible = cam.mode === '3d';
}

// Rebuild grid geometry. Larger range + tighter spacing → cleaner read.
function buildGrid() {
  if (grid) {
    scene.remove(grid);
    grid.geometry.dispose();
    grid.material.dispose();
    grid = null;
  }
  // Rounded divisions ensures lines fall on integer offsets when step is whole.
  const divisions = Math.max(2, Math.round(gridSize / gridStep));
  grid = new THREE.GridHelper(gridSize, divisions, 0x6695c8, 0x4a6080);
  grid.position.y = -1.0;
  grid.material.opacity = 0.85;
  grid.material.transparent = true;
  grid.material.depthWrite = false;
  scene.add(grid);
}

function ensureGridAxes() {
  if (!grid) buildGrid();
  if (!axes) {
    axes = new THREE.AxesHelper(0.5);
    axes.visible = flags.axes;
    scene.add(axes);
  }
}

function makeFrustum(meta, rotN = 0) {
  // Frustum mirrors what camera_modes.js does: when N is odd the new
  // "vertical" axis is the original sensor width, so use fx; otherwise fy.
  // Result: 3D mode's wireframe always matches the rotated 2D-aligned fov.
  const odd = rotN % 2 === 1;
  const newH = odd ? meta.image_w : meta.image_h;
  const newFy = odd ? meta.K.fx : meta.K.fy;
  const fovY = 2 * Math.atan(newH / (2 * newFy));    // radians
  const aspect = odd ? meta.image_h / meta.image_w
                     : meta.image_w / meta.image_h;
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

function rebuildFrustum() {
  if (!cam || !curSeq) return;
  if (frustum) {
    scene.remove(frustum);
    frustum.geometry.dispose();
    frustum.material.dispose();
  }
  frustum = makeFrustum(curSeq.meta, dataRotCw);
  frustum.frustumCulled = false;
  scene.add(frustum);
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
  if (bgNear) { scene.remove(bgNear); bgNear.geometry.dispose(); bgNear.material.dispose(); bgNear = null; }
  if (bgFar) { scene.remove(bgFar); bgFar.geometry.dispose(); bgFar.material.dispose(); bgFar = null; }
  if (bgTex) { bgTex.dispose(); bgTex = null; }
  if (cam) { cam.controls.dispose(); cam = null; }
  frameCache.clear();

  curSeq = { src, name, meta, faces };
  curN = meta.n_frames;
  curFrame = 0;
  dataRotCw = 0;     // reset rotation per-sequence

  $('frame-slider').max = curN - 1;
  $('frame-info').textContent = `0 / ${curN - 1}`;

  ensureGridAxes();
  cam = new CameraModes({ canvas: renderer.domElement, meta });
  syncIntrinsicsPanel();
  // CSS aspect-ratio drives canvas size; resize() reads back the resulting
  // pixel dims and informs camera.aspect. Called after `cam` exists.
  resize();

  // Two image planes share one texture. Far plane (z=-50) is the 2D-aligned
  // backdrop and stays visible in 3D too; near plane (z=-1.5) is the
  // frustum-near preview, only shown in 3D. depthTest stays enabled so
  // the body mesh, which writes depth, occludes the near plane correctly
  // ("near bg inside is not erased" per spec — body sits between camera
  // and near plane only when user orbits inside the frustum).
  const bgMatNear = new THREE.MeshBasicMaterial({
    color: 0xffffff, depthWrite: false, side: THREE.DoubleSide,
  });
  const bgMatFar = new THREE.MeshBasicMaterial({
    color: 0xffffff, depthWrite: false, side: THREE.DoubleSide,
  });
  bgNear = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMatNear);
  bgFar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMatFar);
  bgNear.renderOrder = 0;
  bgFar.renderOrder = -1;     // far renders before near
  scene.add(bgNear);
  scene.add(bgFar);

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
  frustum = makeFrustum(meta, dataRotCw);
  frustum.frustumCulled = false;
  scene.add(frustum);

  try { await applyFrame(0); }
  catch (_) { /* stale-epoch — outer return below */ }
  if (myEpoch !== seqEpoch) return;

  // applyFrame called set3DFollowTarget(pelvis_0), which re-aimed the saved
  // _pose3D quaternion to face pelvis. This is the "prime" step that prevents
  // the first 2D→3D switch from snap-correcting on the next OrbitControls
  // tick.

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
  const rootPos = new Float32Array(buf, (6890 * 3 + 24 * 3) * 4, 3);
  const rootRota = new Float32Array(buf, (6890 * 3 + 24 * 3 + 3) * 4, 3);
  const entry = { verts, joints, rootPos, rootRota, tex };
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

  // Rotation about camera -Z (i.e. the source-coord +Z axis comes out of
  // screen → +Z is "out". A clockwise rotation as seen looking *down* the
  // -Z direction maps (x, y) → (y, -x). N applications give Nx 90° CW.
  const cR = Math.cos(dataRotCw * Math.PI / 2);
  const sR = Math.sin(dataRotCw * Math.PI / 2);
  // CW rotation about -Z (camera-out) keeping right-hand frame:
  //   x' =  cos·x + sin·y
  //   y' = -sin·x + cos·y
  // (When dataRotCw=1 → x'=y, y'=-x.)
  function rot(x, y) {
    return [cR * x + sR * y, -sR * x + cR * y];
  }

  // mesh verts (rotated, write into geometry buffer in place)
  const pos = mesh.geometry.attributes.position;
  const dst = pos.array;
  for (let v = 0, vlen = 6890 * 3; v < vlen; v += 3) {
    const x = f.verts[v], y = f.verts[v + 1];
    const [rx, ry] = rot(x, y);
    dst[v] = rx; dst[v + 1] = ry; dst[v + 2] = f.verts[v + 2];
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();

  // joints + bones (rotated)
  const rotJ = new Float32Array(24 * 3);
  for (let j = 0; j < 24; j++) {
    const x = f.joints[j * 3], y = f.joints[j * 3 + 1];
    const [rx, ry] = rot(x, y);
    rotJ[j * 3] = rx; rotJ[j * 3 + 1] = ry; rotJ[j * 3 + 2] = f.joints[j * 3 + 2];
    pointsGroup.children[j].position.set(rx, ry, f.joints[j * 3 + 2]);
  }
  for (let bi = 0; bi < BONES.length; bi++) {
    const [a, b] = BONES[bi];
    const line = bonesGroup.children[bi];
    line.geometry.setFromPoints([
      new THREE.Vector3(rotJ[a * 3], rotJ[a * 3 + 1], rotJ[a * 3 + 2]),
      new THREE.Vector3(rotJ[b * 3], rotJ[b * 3 + 1], rotJ[b * 3 + 2]),
    ]);
    line.geometry.attributes.position.needsUpdate = true;
  }
  cam.set3DFollowTarget(new THREE.Vector3(rotJ[0], rotJ[1], rotJ[2]));

  // background image — bind same texture to both planes
  bgNear.material.map = f.tex;
  bgNear.material.needsUpdate = true;
  bgFar.material.map = f.tex;
  bgFar.material.needsUpdate = true;
  bgTex = f.tex;

  // SMPL root pos/rota — also rotated about camera -Z, then displayed.
  const [rpx, rpy] = rot(f.rootPos[0], f.rootPos[1]);
  const rotatedRootPos = [rpx, rpy, f.rootPos[2]];
  // Compose camera-out rotation onto the root axis-angle.
  // Axis-angle (vec, magnitude=angle) → quaternion → premultiply → axis-angle.
  const rrAngle = Math.hypot(f.rootRota[0], f.rootRota[1], f.rootRota[2]);
  const qRoot = new THREE.Quaternion();
  if (rrAngle > 1e-9) {
    qRoot.setFromAxisAngle(
      new THREE.Vector3(f.rootRota[0] / rrAngle, f.rootRota[1] / rrAngle, f.rootRota[2] / rrAngle),
      rrAngle);
  }
  // CW rotation about camera-out (-Z world): rotation axis is +Z (camera out
  // is -Z, but data rotation is CW *seen by camera*, which is +Z in the
  // right-handed world frame), angle = -dataRotCw·π/2.
  const qCam = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), -dataRotCw * Math.PI / 2);
  const qComposed = qCam.clone().multiply(qRoot);
  // back to axis-angle for display
  const composedAxis = new THREE.Vector3();
  let composedAngle = 2 * Math.acos(Math.min(1, Math.max(-1, qComposed.w)));
  const sinHalf = Math.sqrt(Math.max(0, 1 - qComposed.w * qComposed.w));
  if (sinHalf > 1e-9) {
    composedAxis.set(qComposed.x / sinHalf, qComposed.y / sinHalf, qComposed.z / sinHalf);
  } else {
    composedAxis.set(1, 0, 0);
    composedAngle = 0;
  }
  const rotatedRootRota = [
    composedAxis.x * composedAngle,
    composedAxis.y * composedAngle,
    composedAxis.z * composedAngle,
  ];

  layoutBg();
  renderAngles(rotJ);
  syncRootPanel(rotatedRootPos, rotatedRootRota);
}

// Old setFrame is now a thin wrapper used by UI handlers.
async function setFrame(i) {
  if (curN === 0) return;
  const target = Math.max(0, Math.min(curN - 1, i | 0));
  await applyFrame(target);
}

function layoutBg() {
  const p = cam.bgPlaneParams();
  // Plane geometry uses NATIVE image dims; rotation is applied to the plane
  // mesh's `rotation.z`. Texture sits in the rotated plane → pixels never get
  // resized to a non-image aspect. With native plane + same rotation as
  // mesh/joints, everything stays pixel-aligned through the camera matrix.
  bgNear.geometry.dispose();
  bgNear.geometry = new THREE.PlaneGeometry(p.near.w, p.near.h);
  bgNear.position.set(0, 0, p.near.z);
  bgNear.rotation.set(0, 0, -dataRotCw * Math.PI / 2);
  bgFar.geometry.dispose();
  bgFar.geometry = new THREE.PlaneGeometry(p.far.w, p.far.h);
  bgFar.position.set(0, 0, p.far.z);
  bgFar.rotation.set(0, 0, -dataRotCw * Math.PI / 2);
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

// Single intrinsics panel: shows the *live* K (the one currently rendering).
// On data rotation, K rotates too (cx↔cy swap pattern + dims) and the panel
// reflects that automatically. User edits land directly on cam.K.
function syncIntrinsicsPanel() {
  if (!cam) return;
  $('k-fx').value = cam.K.fx;
  $('k-fy').value = cam.K.fy;
  $('k-cx').value = cam.K.cx;
  $('k-cy').value = cam.K.cy;
  $('k-wh').textContent = `${cam.imageW}×${cam.imageH}`;
}

// SMPL root state panel — shows the *world-coordinate* root pos / rotation
// for the currently-rendered frame (i.e. after dataRotN has been applied to
// SMPL pose). This is what the camera actually sees in 3D space.
function syncRootPanel(pos, rota) {
  const fmt = v => v.map(x => x.toFixed(3)).join(', ');
  const mag = Math.hypot(rota[0], rota[1], rota[2]);
  $('r-pos').textContent = fmt(pos);
  $('r-rot').textContent = fmt(rota);
  $('r-rotmag').textContent = `${mag.toFixed(3)} rad / ${(mag * 180 / Math.PI).toFixed(1)}°`;
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
    syncIntrinsicsPanel();    // mirror dims back if anything changed
    rebuildFrustum();
    layoutBg();
  });
});
$('btn-k-reset').addEventListener('click', () => {
  if (!cam) return;
  cam.resetIntrinsics();      // restores meta.K rotated by current dataRotN
  syncIntrinsicsPanel();
  rebuildFrustum();
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

// Data rotation: rotate verts/joints/bg by N×90° about camera -Z (camera frame
// stays put, but its fov/aspect swap with N to follow rotated content).
// Apply to current frame; cache holds raw bin so rotation is re-applied on rebuild.
function rotateData(delta) {
  dataRotCw = ((dataRotCw + delta) % 4 + 4) % 4;
  if (cam) {
    cam.setDataRotation(dataRotCw);
    rebuildFrustum();
    syncIntrinsicsPanel();    // K + dims rotated together; panel reflects live values
    resize();
  }
  if (curN > 0) applyFrame(curFrame);
}
$('btn-rot-ccw').addEventListener('click', () => rotateData(-1));
$('btn-rot-cw').addEventListener('click', () => rotateData(+1));
$('btn-rot-reset').addEventListener('click', () => rotateData(-dataRotCw));

// Grid range/step inputs
function rebuildGrid() {
  const sz = parseFloat($('grid-size').value);
  const st = parseFloat($('grid-step').value);
  if (Number.isFinite(sz) && sz > 0) gridSize = sz;
  if (Number.isFinite(st) && st > 0) gridStep = st;
  buildGrid();
  applyVisibility();
}
$('grid-size').addEventListener('input', rebuildGrid);
$('grid-step').addEventListener('input', rebuildGrid);
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
  if (!cam) return;
  const containerEl = renderer.domElement.parentElement;
  const cw = containerEl.clientWidth, ch = containerEl.clientHeight;
  if (cw <= 0 || ch <= 0) return;

  // Compute the largest WxH that fits inside the container while matching
  // the rotated image aspect. Pure pixel math, no CSS aspect-ratio.
  const targetAspect = cam.effectiveAspect();
  const containerAspect = cw / ch;
  let w, h;
  if (containerAspect > targetAspect) {
    // container wider than image → fit height, leave horizontal bars
    h = ch;
    w = Math.round(h * targetAspect);
  } else {
    // container taller than image → fit width, leave vertical bars
    w = cw;
    h = Math.round(w / targetAspect);
  }
  // Set canvas CSS pixel size; centering done by absolute + translate(-50%).
  renderer.domElement.style.width = w + 'px';
  renderer.domElement.style.height = h + 'px';
  renderer.setSize(w, h, false);     // backing buffer matches CSS × DPR
  cam.camera.aspect = w / h;
  cam.camera.updateProjectionMatrix();
}

function renderFrame() {
  if (!cam) return;
  // No setViewport / setScissor — canvas is sized by CSS aspect-ratio so
  // its pixel buffer already matches the (rotated) image aspect. Renderer
  // fills the entire backing buffer.
  renderer.render(scene, cam.camera);
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
    renderFrame();
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
      renderFrame();
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
