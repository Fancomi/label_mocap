import { loadSequence } from './data/sequence_loader.js';
import { loadReferenceMeshIfAvailable } from './debug/reference_mesh.js';
import { loadModel } from './smpl/smpl_model.js';
import { Playback } from './viewer/playback.js';
import { SmplScene } from './viewer/scene.js';

const statusEl = document.querySelector('#status');
const slider = document.querySelector('#frameSlider');
const playButton = document.querySelector('#playPause');
const loadButton = document.querySelector('#loadSample');
const viewport = document.querySelector('#viewport');

const scene = new SmplScene(viewport);
const worker = new Worker(new URL('./smpl/smpl_worker.js', import.meta.url), { type: 'module' });

let playback = new Playback(0);
let sequence = null;
let referenceMesh = null;
let requestId = 0;
const pendingFrames = new Map();

function setStatus(message) {
  statusEl.textContent = message;
}

function setControlsEnabled(enabled) {
  playButton.disabled = !enabled;
  slider.disabled = !enabled;
}

function frameLabel(frame, ms) {
  const prefix = `Frame ${frame + 1} / ${playback.frameCount}`;
  return Number.isFinite(ms) ? `${prefix} - SMPL ${ms.toFixed(1)} ms` : prefix;
}

worker.addEventListener('message', (event) => {
  const msg = event.data;

  if (msg.type === 'ready') {
    setStatus('Model loaded. Preparing first frame...');
    return;
  }

  if (msg.type === 'frameResult') {
    if (!pendingFrames.has(msg.requestId)) {
      return;
    }
    const frameIndex = pendingFrames.get(msg.requestId);
    pendingFrames.delete(msg.requestId);
    scene.updateFrame(new Float32Array(msg.vertices), new Float32Array(msg.joints));
    if (referenceMesh) {
      scene.updateReferenceFrame(referenceMesh.frameVertices(frameIndex));
    }
    setStatus(frameLabel(frameIndex, msg.ms));
    return;
  }

  if (msg.type === 'error') {
    pendingFrames.delete(msg.requestId);
    setStatus(`Worker error: ${msg.message}`);
  }
});

function requestFrame(frameIndex) {
  if (!sequence || frameIndex < 0 || frameIndex >= sequence.frames.length) {
    return;
  }

  const id = ++requestId;
  pendingFrames.set(id, frameIndex);
  worker.postMessage({
    type: 'frame',
    requestId: id,
    frame: sequence.frames[frameIndex],
  });
}

async function loadSample() {
  setControlsEnabled(false);
  loadButton.disabled = true;
  setStatus('Loading SMPL model...');

  try {
    pendingFrames.clear();
    const model = await loadModel('./public/models/smpl_neutral.meta.json');
    scene.setTopology(model.faces);
    scene.setReferenceTopology(model.faces);
    worker.postMessage({ type: 'init', model });

    setStatus('Loading sample sequence...');
    sequence = await loadSequence('./public/samples/a_famale_224/a1/sequence.json');
    try {
      referenceMesh = await loadReferenceMeshIfAvailable(
        './public/debug/a_famale_224/a1/python_ref_mesh.meta.json'
      );
    } catch (_err) {
      referenceMesh = null;
    }
    playback = new Playback(sequence.frames.length, sequence.fps);
    slider.max = String(Math.max(0, sequence.frames.length - 1));
    slider.value = '0';
    playButton.textContent = 'Play';
    scene.configure2DCamera(sequence);
    setControlsEnabled(sequence.frames.length > 0);
    loadButton.disabled = false;
    requestFrame(0);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    setStatus(`Unable to load local sample assets: ${detail}`);
    loadButton.disabled = false;
  }
}

loadButton.addEventListener('click', () => {
  loadSample();
});

playButton.addEventListener('click', () => {
  playButton.textContent = playback.toggle() ? 'Pause' : 'Play';
});

slider.addEventListener('input', () => {
  playback.setFrame(Number(slider.value));
  requestFrame(playback.frame);
});

setControlsEnabled(false);
setStatus('Ready. Load the local sample to begin.');

let lastTime = performance.now();
function loop(now) {
  const previousFrame = playback.frame;
  playback.tick(now - lastTime);
  lastTime = now;

  if (sequence && playback.frame !== previousFrame && pendingFrames.size < 2) {
    slider.value = String(playback.frame);
    requestFrame(playback.frame);
  }

  scene.render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
