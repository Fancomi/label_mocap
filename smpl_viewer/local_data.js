import { orderedImageNames, basename } from '../label/src/io/image_order.js';

// 工厂默认焦距/主点(初值)；真实图像尺寸由 configureForImage 在加载时学得。
const FX = 1850;
const FY = 1850;
const CX = 960;
const CY = 540;
const DEFAULT_W = 1920;
const DEFAULT_H = 1080;

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

function isImageName(name) {
  return /\.(jpe?g|png|bmp)$/i.test(name);
}

function splitPath(path) {
  return String(path).split('/').filter(Boolean);
}

// 从目录的相对路径中识别 json 与图像(去 a1 硬限制)：json 优先 player_0.json，
// 否则任意 .json；图像按 basename 数字序，返回 [{name, file}]。
function classifyFiles(filesByPath) {
  const entries = [...filesByPath.entries()];
  const jsonEntry = entries.find(([p]) => basename(p) === 'player_0.json')
    ?? entries.find(([p]) => /\.json$/i.test(p));
  const images = entries
    .filter(([p]) => isImageName(p))
    .sort(([a], [b]) => basename(a).localeCompare(basename(b), undefined, { numeric: true }))
    .map(([p, file]) => ({ name: basename(p), file }));
  return { jsonFile: jsonEntry?.[1] ?? null, images };
}

// 目录名：取 json/图像所在子目录的上一级，回退首段。
function dirItemName(files) {
  const rel = files.find((f) => f.webkitRelativePath)?.webkitRelativePath;
  const parts = rel ? splitPath(rel) : [];
  return parts.length > 1 ? parts[0] : (parts[0] ?? 'sequence');
}

async function readJsonFile(file) {
  return JSON.parse(await file.text());
}

function normalizeAnnotationsData(data) {
  const annotations = data.annotations ?? data.records;
  if (!Array.isArray(annotations) || !annotations.length) {
    throw new Error('player_0.json must contain non-empty annotations');
  }
  return annotations.map((annotation, index) => normalizeAnnotationFrame(annotation, index));
}

function sequenceFromFramesAndImages({ frames, images, name, src = 'local', dims = null }) {
  const portrait = detectOrientation(frames.map((frame) => frame.root_pos));
  const image_w = dims?.width ?? DEFAULT_W;
  const image_h = dims?.height ?? DEFAULT_H;
  return {
    src,
    name,
    n_frames: frames.length,
    portrait,
    meta: {
      n_frames: frames.length,
      portrait,
      K: { fx: FX, fy: FY, cx: image_w / 2, cy: image_h / 2 },
      image_w,
      image_h,
      kp_count: 24,
    },
    frames,
    images,
  };
}

// 用 createImageBitmap 读 File 自然像素尺寸(不渲染、不占显存)；失败返回 null。
async function decodeImageDims(file) {
  try {
    const bmp = await createImageBitmap(file);
    const dims = { width: bmp.width, height: bmp.height };
    bmp.close();
    return dims;
  } catch { return null; }
}

// 解析首帧真实尺寸：优先 json images[0].width/height，否则解码首帧图像 File。
async function resolveDims(rawImages, firstImageFile) {
  const info = Array.isArray(rawImages) ? rawImages[0] : null;
  if (info && Number.isFinite(info.width) && Number.isFinite(info.height)
      && info.width > 0 && info.height > 0) {
    return { width: info.width, height: info.height };
  }
  return firstImageFile ? decodeImageDims(firstImageFile) : null;
}

// 帧→图像匹配：优先 annotation.image_id → json images[].file_name，命中失败用
// 数字序图像第 i 个兜底。返回与 frames 对齐的 File 数组。
function matchImages(frames, raw, sortedImages) {
  const annList = raw.annotations ?? raw.records ?? [];
  const cocoImages = Array.isArray(raw.images) ? raw.images : [];
  const fileNameById = new Map(cocoImages.map((im) => [im.id, basename(im.file_name ?? '')]));
  const byName = new Map(sortedImages.map(({ name, file }) => [name, file]));
  return frames.map((_, i) => {
    const want = fileNameById.get(annList[i]?.image_id);
    return (want && byName.get(want)) ?? sortedImages[i]?.file ?? null;
  });
}

export async function loadLocalA1SequenceFromFileList(fileList, src = 'local') {
  const files = Array.from(fileList ?? []);
  if (!files.length) {
    throw new Error('请选择数据目录');
  }
  const filesByPath = new Map(files.map((f) => [f.webkitRelativePath || f.name, f]));
  const { jsonFile, images: sortedImages } = classifyFiles(filesByPath);
  if (!jsonFile) {
    throw new Error('未找到标注 JSON，请选择含 player_0.json 的目录');
  }
  const raw = await readJsonFile(jsonFile);
  const frames = normalizeAnnotationsData(raw);
  const images = matchImages(frames, raw, sortedImages);
  if (!images.some(Boolean)) {
    throw new Error('未找到与 json 匹配的图像，请选择包含图像的目录');
  }
  const dims = await resolveDims(raw.images, images.find(Boolean));
  return sequenceFromFramesAndImages({
    frames,
    images,
    name: dirItemName(files),
    src,
    dims,
  });
}

// 视频序列：视频逐帧作背景 + 一份 SMPL 标注 JSON 出 frames。与 label
// openVideoData 语义一致(视频+标注)。videoSource 须有 {width,height,frameCount()}；
// n_frames 取 min(标注帧数, 视频帧数)——以标注帧数为准更安全(frames 是 SMPL 真值)。
// 返回结构与图像序列同形,额外带 videoSource，且 images:null(走视频纹理分支)。
export function loadVideoSequence(videoSource, jsonRaw, { name = 'video', src = 'local' } = {}) {
  const allFrames = normalizeAnnotationsData(jsonRaw);
  const vCount = videoSource.frameCount();
  const n = Math.min(allFrames.length, vCount);
  const frames = allFrames.slice(0, n);
  const dims = { width: videoSource.width, height: videoSource.height };
  const seq = sequenceFromFramesAndImages({ frames, images: null, name, src, dims });
  seq.videoSource = videoSource;
  return seq;
}

export async function loadLocalA1SequenceFromFiles(jsonFile, imageFiles, src = 'local') {
  if (!jsonFile) {
    throw new Error('请选择 player_0.json');
  }
  const sortedImages = Array.from(imageFiles ?? [])
    .filter((file) => isImageName(file.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((file) => ({ name: basename(file.name), file }));
  if (!sortedImages.length) {
    throw new Error('请选择图像文件');
  }
  const raw = await readJsonFile(jsonFile);
  const frames = normalizeAnnotationsData(raw);
  const images = matchImages(frames, raw, sortedImages);
  const dims = await resolveDims(raw.images, images.find(Boolean));
  return sequenceFromFramesAndImages({
    frames,
    images,
    name: 'sequence',
    src,
    dims,
  });
}

// File System Access 路径：DirSource 已 scan()。逐帧用 annotation.image_id → file_name
// 取图（比裸下标对齐更鲁棒，annotations 与 images[] 错序也正确），命中失败用
// orderedImageNames 的第 i 个兜底。imageFileByName 返回 File，viewer loadFrame 直接消费。
export async function loadLocalA1SequenceFromDirSource(dirSource, src = 'local') {
  const cls = dirSource.classification ?? {};
  const raw = await dirSource.readJson();
  if (!raw) {
    throw new Error('未找到标注 JSON，请选择含 player_0.json 的目录');
  }
  const frames = normalizeAnnotationsData(raw);
  const annList = raw.annotations ?? raw.records ?? [];
  const cocoImages = Array.isArray(raw.images) ? raw.images : [];
  const fileNameById = new Map(cocoImages.map((im) => [im.id, im.file_name]));
  const availableNames = (cls.imagePaths ?? []).map(basename);
  const orderedNames = orderedImageNames({ cocoImages, availableNames });

  const images = [];
  for (let i = 0; i < frames.length; i++) {
    const wantName = fileNameById.get(annList[i]?.image_id) ?? orderedNames[i] ?? null;
    images.push(wantName ? await dirSource.imageFileByName(wantName) : null);
  }
  if (!images.some(Boolean)) {
    throw new Error('未找到与 json 匹配的图像，请选择包含图像的目录');
  }
  const dims = await resolveDims(raw.images, images.find(Boolean));
  return sequenceFromFramesAndImages({
    frames,
    images,
    name: cls.dataItemName || 'sequence',
    src,
    dims,
  });
}
