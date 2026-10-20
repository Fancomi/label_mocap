import { orderedImageNames, basename } from '../label/src/io/image_order.js';
import { discoverPersons } from '../smpl_edit/person_files.js';

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

const annotationList = (data) => data?.annotations ?? data?.records ?? [];

function normalizeAnnotationsData(data) {
  const annotations = annotationList(data);
  if (!Array.isArray(annotations) || !annotations.length) {
    throw new Error('player_0.json must contain non-empty annotations');
  }
  return annotations.map((annotation, index) => normalizeAnnotationFrame(annotation, index));
}

// 多人物时间轴。personRaws: [{ id, raw }](首个为主人物,其帧轴为准)。
// - 主人物 json 带 images[]:帧轴 = images[] 顺序(帧身份 = 位置,与标注器一致),各人物按 image_id
//   落位;没标注的帧为 null(查看器显示底图、不画人)。仅框无 SMPL 的标注计入「有标注」但不渲染。
// - 否则(旧 records 格式):帧轴 = 主人物 annotations 顺序(兼容旧行为),其余人物按帧号落位。
// 返回 { mode, n, wantNames(i→file_name|undefined), persons:[{ id, frames, marks }] }。
export function buildPersonTimeline(personRaws) {
  const primary = personRaws[0].raw;
  const cocoImages = Array.isArray(primary.images) ? primary.images : [];
  if (cocoImages.length) {
    const n = cocoImages.length;
    const pos = new Map(cocoImages.map((im, i) => [im.id, i]));
    const persons = personRaws.map(({ id, raw }) => {
      const frames = Array(n).fill(null); const marks = new Uint8Array(n);
      for (const a of annotationList(raw)) {
        const i = pos.get(a.image_id);
        if (i === undefined) continue;
        marks[i] = 1;
        if (a && 'body_pose' in a) frames[i] = normalizeAnnotationFrame(a, i);
      }
      return { id, frames, marks };
    });
    if (!persons.some((p) => p.marks.some(Boolean))) throw new Error('player_0.json must contain non-empty annotations');
    return { mode: 'images', n, wantNames: (i) => cocoImages[i]?.file_name, persons };
  }
  const mainFrames = normalizeAnnotationsData(primary);
  const annList = annotationList(primary);
  const n = mainFrames.length;
  const pos = new Map(mainFrames.map((f, i) => [f.frame, i]));
  const persons = personRaws.map(({ id, raw }, k) => {
    if (k === 0) return { id, frames: mainFrames, marks: new Uint8Array(n).fill(1) };
    const frames = Array(n).fill(null); const marks = new Uint8Array(n);
    annotationList(raw).forEach((a, idx) => {
      let f; try { f = normalizeAnnotationFrame(a, idx); } catch { return; }
      const i = pos.get(f.frame);
      if (i !== undefined) { frames[i] = f; marks[i] = 1; }
    });
    return { id, frames, marks };
  });
  // 旧格式按 annotation 的 image_id → images[].file_name 取图(此分支 images[] 为空,恒为 undefined)。
  const fileNameById = new Map(cocoImages.map((im) => [im.id, im.file_name]));
  return { mode: 'records', n, wantNames: (i) => fileNameById.get(annList[i]?.image_id), persons };
}

function sequenceFromTimeline({ timeline, images, name, src = 'local', dims = null }) {
  const rootPositions = timeline.persons[0].frames.filter(Boolean).map((frame) => frame.root_pos);
  const portrait = detectOrientation(rootPositions);
  const image_w = dims?.width ?? DEFAULT_W;
  const image_h = dims?.height ?? DEFAULT_H;
  return {
    src,
    name,
    n_frames: timeline.n,
    portrait,
    meta: {
      n_frames: timeline.n,
      portrait,
      K: { fx: FX, fy: FY, cx: image_w / 2, cy: image_h / 2 },
      image_w,
      image_h,
      kp_count: 24,
    },
    frames: timeline.persons[0].frames,   // 当前人物的逐帧数据(null = 该帧无可渲染 SMPL)
    persons: timeline.persons,            // [{ id, frames, marks }] — 查看器据此切换人物
    images,
  };
}

// 读出主 json 及其同族人物文件(player_N)。readJson(path) → 对象|null。主文件读不到即无标注。
async function readPersonRaws(paths, primaryPath, readJson) {
  const found = discoverPersons(paths, primaryPath);
  const list = found.length ? found : [{ id: 0, path: primaryPath }];
  const out = [];
  for (const { id, path } of list) {
    let raw = null;
    try { raw = await readJson(path); } catch { raw = null; }
    if (raw && typeof raw === 'object') out.push({ id, raw });
  }
  // 主文件排首位(其帧轴为准):若主文件本身不是 player_N(任意命名),它的 id 为 0。
  out.sort((a, b) => (a.id === 0 ? -1 : b.id === 0 ? 1 : a.id - b.id));
  if (!out.length) throw new Error(`无法读取标注 JSON: ${primaryPath}`);
  return out;
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

// 帧→图像匹配：优先该帧的 file_name(images 模式取 images[i],旧格式取 annotation.image_id →
// images[].file_name),命中失败用数字序图像第 i 个兜底。返回与帧轴对齐的 File 数组。
function matchImages(timeline, sortedImages) {
  const byName = new Map(sortedImages.map(({ name, file }) => [name, file]));
  return Array.from({ length: timeline.n }, (_, i) => {
    const want = timeline.wantNames(i);
    return (want && byName.get(basename(want))) ?? sortedImages[i]?.file ?? null;
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
  const primaryPath = jsonFile.webkitRelativePath || jsonFile.name;
  const personRaws = await readPersonRaws([...filesByPath.keys()], primaryPath,
    async (p) => { const f = filesByPath.get(p); return f ? readJsonFile(f) : null; });
  const timeline = buildPersonTimeline(personRaws);
  const images = matchImages(timeline, sortedImages);
  if (!images.some(Boolean)) {
    throw new Error('未找到与 json 匹配的图像，请选择包含图像的目录');
  }
  const dims = await resolveDims(personRaws[0].raw.images, images.find(Boolean));
  return sequenceFromTimeline({ timeline, images, name: dirItemName(files), src, dims });
}

// 视频序列：视频逐帧作背景 + 一份 SMPL 标注 JSON 出 frames。与 label
// openVideoData 语义一致(视频+标注)。videoSource 须有 {width,height,frameCount()}；
// n_frames 取 min(标注帧轴长度, 视频帧数)——以标注为准更安全(frames 是 SMPL 真值)。
// 返回结构与图像序列同形,额外带 videoSource，且 images:null(走视频纹理分支)。
export function loadVideoSequence(videoSource, jsonRaw, { name = 'video', src = 'local' } = {}) {
  const full = buildPersonTimeline([{ id: 0, raw: jsonRaw }]);
  const n = Math.min(full.n, videoSource.frameCount());
  const timeline = {
    ...full, n,
    persons: full.persons.map((p) => ({ id: p.id, frames: p.frames.slice(0, n), marks: p.marks.slice(0, n) })),
  };
  const dims = { width: videoSource.width, height: videoSource.height };
  const seq = sequenceFromTimeline({ timeline, images: null, name, src, dims });
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
  const timeline = buildPersonTimeline([{ id: 0, raw }]);
  const images = matchImages(timeline, sortedImages);
  const dims = await resolveDims(raw.images, images.find(Boolean));
  return sequenceFromTimeline({ timeline, images, name: 'sequence', src, dims });
}

// File System Access 路径：DirSource 已 scan()。逐帧按 file_name 取图（比裸下标对齐更鲁棒），
// 命中失败用 orderedImageNames 的第 i 个兜底。同目录族的 player_N.json 作为其他人物一并读入。
// imageFileByName 返回 File，viewer loadFrame 直接消费。
export async function loadLocalA1SequenceFromDirSource(dirSource, src = 'local') {
  const cls = dirSource.classification ?? {};
  const primary = await dirSource.readJson();
  if (!primary) {
    throw new Error('未找到标注 JSON，请选择含 player_0.json 的目录');
  }
  const paths = dirSource.paths ?? [];
  const personRaws = cls.jsonPath && dirSource.readJsonAt
    ? await readPersonRaws(paths, cls.jsonPath, (p) => (p === cls.jsonPath ? primary : dirSource.readJsonAt(p)))
    : [{ id: 0, raw: primary }];
  const timeline = buildPersonTimeline(personRaws);
  const cocoImages = Array.isArray(primary.images) ? primary.images : [];
  const availableNames = (cls.imagePaths ?? []).map(basename);
  const orderedNames = orderedImageNames({ cocoImages, availableNames });

  const images = [];
  for (let i = 0; i < timeline.n; i++) {
    const wantName = timeline.wantNames(i) ?? orderedNames[i] ?? null;
    images.push(wantName ? await dirSource.imageFileByName(wantName) : null);
  }
  if (!images.some(Boolean)) {
    throw new Error('未找到与 json 匹配的图像，请选择包含图像的目录');
  }
  const dims = await resolveDims(primary.images, images.find(Boolean));
  return sequenceFromTimeline({ timeline, images, name: cls.dataItemName || 'sequence', src, dims });
}
