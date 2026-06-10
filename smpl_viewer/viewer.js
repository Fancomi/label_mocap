// label_mocap/smpl_viewer/viewer.js
//
// Validate mode: ?validate=1&seq=<src>/<name>&frame=<i>
// Renders one frame in 2D-aligned mode and triggers a PNG download.
// No interaction, no mode switching. Task 7 expands this.

import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const validate = params.get('validate') === '1';
const seq = params.get('seq');     // e.g. "10m/TiaoShui_a_male_5500_597"
const frameI = parseInt(params.get('frame') || '0', 10);

const status = document.getElementById('status');
function setStatus(t) { status.textContent = t; console.log('[viewer]', t); }

if (!validate) {
  setStatus('Task 5 only supports ?validate=1&seq=<src>/<name>&frame=<i>. Task 7 adds full UI.');
} else if (!seq) {
  setStatus('missing ?seq=<src>/<name>');
} else {
  main(seq, frameI).catch(e => {
    setStatus('ERROR: ' + e.message);
    console.error(e);
  });
}

async function main(seqId, fi) {
  const [src, name] = seqId.split('/');
  setStatus(`fetching meta for ${seqId} …`);
  const meta = await (await fetch(`/seq/${src}/${name}/meta`)).json();
  setStatus(`forwarding SMPL (first call may take ~10s) …`);
  const facesBuf = await (await fetch(meta.faces_url)).arrayBuffer();
  const frameBuf = await (await fetch(`/seq/${src}/${name}/frame/${fi}.bin`)).arrayBuffer();

  const faces = new Int32Array(facesBuf);                     // (F*3,)
  const verts = new Float32Array(frameBuf, 0, 6890 * 3);      // (6890*3,)

  // Three.js scene
  const W = window.innerWidth, H = window.innerHeight;
  const renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('c'),
    antialias: true,
    preserveDrawingBuffer: true, // needed for toDataURL
  });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();

  // 2D-aligned camera: at origin, looking -Z, fov_y matches intrinsics
  const fovDeg = 2 * Math.atan(meta.image_h / (2 * meta.K.fy)) * 180 / Math.PI;
  const camera = new THREE.PerspectiveCamera(fovDeg, meta.image_w / meta.image_h, 0.01, 1000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.up.set(0, 1, 0);
  // Principal-point offset: for diving cx==W/2 and cy==H/2, so offsets are zero,
  // but we still call setViewOffset so the formula is exercised end-to-end.
  const offX = meta.image_w / 2 - meta.K.cx;
  const offY = meta.image_h / 2 - meta.K.cy;
  camera.setViewOffset(meta.image_w, meta.image_h, offX, offY, meta.image_w, meta.image_h);

  // Background image plane: large plane at z=-50 covering the camera fov exactly.
  const bgZ = -50;
  const bgH = 2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * Math.abs(bgZ);
  const bgW = bgH * (meta.image_w / meta.image_h);
  const tex = new THREE.TextureLoader().load(`/seq/${src}/${name}/img/${fi}.jpg`,
    () => onTextureReady());
  tex.colorSpace = THREE.SRGBColorSpace;
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(bgW, bgH),
    new THREE.MeshBasicMaterial({ map: tex, depthWrite: false })
  );
  bg.position.set(0, 0, bgZ);
  bg.renderOrder = 0;
  scene.add(bg);

  // Mesh wireframe in src coords (Y+=up, -Z=depth)
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
  geom.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x00dd00, wireframe: true,
    depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = 10;
  scene.add(mesh);

  function onTextureReady() {
    setStatus(`rendering frame ${fi} of ${seqId}`);
    renderer.render(scene, camera);
    const tag = `${src}_${name}_f${String(fi).padStart(4, '0')}`;
    const a = document.createElement('a');
    a.download = `viewer_${tag}.png`;
    a.href = renderer.domElement.toDataURL('image/png');
    a.click();
    setStatus(`done. saved viewer_${tag}.png. compare to alignment_check output.`);
  }
}
