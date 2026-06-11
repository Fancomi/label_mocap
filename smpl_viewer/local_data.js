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

function splitPath(path) {
  return String(path).split('/').filter(Boolean);
}

function stripCommonA1Prefix(path) {
  const parts = splitPath(path);
  const jsonIdx = parts.findIndex((part, index) => (
    part === 'json_results' && parts[index + 1] === 'player_0' && parts[index + 2] === 'player_0.json'
  ));
  if (jsonIdx >= 0) {
    return parts.slice(jsonIdx).join('/');
  }
  const imagesIdx = parts.findIndex((part) => part === 'images');
  if (imagesIdx >= 0) {
    return parts.slice(imagesIdx).join('/');
  }
  return parts.join('/');
}

function fallbackPathForPlainFile(file) {
  if (file.name === 'player_0.json') {
    return 'json_results/player_0/player_0.json';
  }
  if (isJpegName(file.name)) {
    return `images/${file.name}`;
  }
  return file.name;
}

async function readJsonFile(file) {
  return JSON.parse(await file.text());
}

function readImageFiles(filesByPath) {
  const entries = [];
  for (const [path, file] of filesByPath.entries()) {
    if (path.startsWith('images/') && isJpegName(path)) {
      entries.push([path, file]);
    }
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([, file]) => file);
}

function localSourceNameFromFiles(files) {
  const first = files.find((file) => file.webkitRelativePath);
  if (!first) {
    return 'sequence';
  }
  const parts = splitPath(first.webkitRelativePath);
  const jsonIdx = parts.findIndex((part, index) => (
    part === 'json_results' && parts[index + 1] === 'player_0' && parts[index + 2] === 'player_0.json'
  ));
  if (jsonIdx > 0) {
    return parts[jsonIdx - 1];
  }
  const imagesIdx = parts.findIndex((part) => part === 'images');
  if (imagesIdx > 0) {
    return parts[imagesIdx - 1];
  }
  return parts[0] ?? 'sequence';
}

function normalizeAnnotationsData(data) {
  const annotations = data.annotations ?? data.records;
  if (!Array.isArray(annotations) || !annotations.length) {
    throw new Error('player_0.json must contain non-empty annotations');
  }
  return annotations.map((annotation, index) => normalizeAnnotationFrame(annotation, index));
}

function sequenceFromFramesAndImages({ frames, images, name, src = 'local' }) {
  const portrait = detectOrientation(frames.map((frame) => frame.root_pos));
  return {
    src,
    name,
    n_frames: frames.length,
    portrait,
    meta: {
      n_frames: frames.length,
      portrait,
      K: { fx: FX, fy: FY, cx: CX, cy: CY },
      image_w: 1920,
      image_h: 1080,
      kp_count: 24,
    },
    frames,
    images,
  };
}

export async function loadLocalA1SequenceFromFileList(fileList, src = 'local') {
  const files = Array.from(fileList ?? []);
  if (!files.length) {
    throw new Error('请选择 a1 目录');
  }

  const filesByPath = new Map();
  for (const file of files) {
    const rel = file.webkitRelativePath
      ? stripCommonA1Prefix(file.webkitRelativePath)
      : fallbackPathForPlainFile(file);
    filesByPath.set(rel, file);
  }

  const jsonFile = filesByPath.get('json_results/player_0/player_0.json');
  if (!jsonFile) {
    throw new Error('未找到 json_results/player_0/player_0.json，请选择 a1 目录');
  }

  const frames = normalizeAnnotationsData(await readJsonFile(jsonFile));
  const images = readImageFiles(filesByPath);
  if (!images.length) {
    throw new Error('未找到 images/*.jpg，请选择包含 images 的 a1 目录');
  }
  return sequenceFromFramesAndImages({
    frames,
    images,
    name: localSourceNameFromFiles(files),
    src,
  });
}

export async function loadLocalA1SequenceFromFiles(jsonFile, imageFiles, src = 'local') {
  if (!jsonFile) {
    throw new Error('请选择 player_0.json');
  }
  const images = Array.from(imageFiles ?? [])
    .filter((file) => isJpegName(file.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!images.length) {
    throw new Error('请选择 images/*.jpg');
  }
  const frames = normalizeAnnotationsData(await readJsonFile(jsonFile));
  return sequenceFromFramesAndImages({
    frames,
    images,
    name: 'sequence',
    src,
  });
}
