const FX = 1850;
const FY = 1850;
const CX = 960;
const CY = 540;

function finiteArray(value, length, name) {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`${name} must have length ${length}`);
  }
  return value.map((x, i) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      throw new Error(`${name}[${i}] must be finite`);
    }
    return x;
  });
}

export function normalizeAnnotationFrame(annotation, index) {
  const frame = annotation.frame ?? annotation.image_id ?? index;
  if (!Number.isInteger(frame)) {
    throw new Error(`frame must be an integer: ${frame}`);
  }
  return {
    frame,
    root_pos: finiteArray(annotation.root_pos, 3, 'root_pos'),
    root_rota: finiteArray(annotation.root_rota, 3, 'root_rota'),
    body_pose: finiteArray(annotation.body_pose, 63, 'body_pose'),
    betas: finiteArray(annotation.betas, 10, 'betas'),
  };
}

export function detectOrientation(rootPositions) {
  if (!rootPositions.length) {
    return false;
  }
  const xs = rootPositions.map((p) => p[0]);
  const ys = rootPositions.map((p) => p[1]);
  const xRange = Math.max(...xs) - Math.min(...xs);
  const yRange = Math.max(...ys) - Math.min(...ys);
  if (rootPositions.length < 60) {
    const uCenter = rootPositions
      .map((p) => FX * p[0] / (-p[2]) + CX)
      .reduce((sum, u) => sum + u, 0) / rootPositions.length;
    return uCenter < CX;
  }
  return xRange > yRange * 2;
}

export function sequenceLabel(seq) {
  return `${seq.src}/${seq.name} (${seq.n_frames}f${seq.portrait ? ', portrait' : ''})`;
}

function isJpegName(name) {
  return /\.(jpe?g)$/i.test(name);
}

async function getFileHandle(dirHandle, pathParts) {
  let current = dirHandle;
  for (let i = 0; i < pathParts.length - 1; i++) {
    current = await current.getDirectoryHandle(pathParts[i]);
  }
  return current.getFileHandle(pathParts[pathParts.length - 1]);
}

async function readJson(fileHandle) {
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}

async function readImageHandles(dirHandle) {
  const imageDir = await dirHandle.getDirectoryHandle('images');
  const entries = [];
  for await (const [name, handle] of imageDir.entries()) {
    if (handle.kind === 'file' && isJpegName(name)) {
      entries.push([name, handle]);
    }
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([, handle]) => handle);
}

export async function loadLocalA1Sequence(dirHandle, src = 'local') {
  const jsonHandle = await getFileHandle(dirHandle, ['json_results', 'player_0', 'player_0.json']);
  const data = await readJson(jsonHandle);
  const annotations = data.annotations ?? data.records;
  if (!Array.isArray(annotations) || !annotations.length) {
    throw new Error('player_0.json must contain non-empty annotations');
  }

  const frames = annotations.map((annotation, index) => normalizeAnnotationFrame(annotation, index));
  const images = await readImageHandles(dirHandle);
  const name = dirHandle.name || 'sequence';
  return {
    src,
    name,
    n_frames: frames.length,
    portrait: detectOrientation(frames.map((frame) => frame.root_pos)),
    meta: {
      n_frames: frames.length,
      portrait: detectOrientation(frames.map((frame) => frame.root_pos)),
      K: { fx: FX, fy: FY, cx: CX, cy: CY },
      image_w: 1920,
      image_h: 1080,
      kp_count: 24,
    },
    frames,
    images,
  };
}

export async function chooseLocalSequence() {
  if (!globalThis.showDirectoryPicker) {
    throw new Error('当前浏览器不支持目录选择，请使用 Chromium 系浏览器打开本页');
  }
  const dirHandle = await globalThis.showDirectoryPicker({ mode: 'read' });
  return loadLocalA1Sequence(dirHandle);
}
