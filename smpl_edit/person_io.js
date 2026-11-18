// smpl_edit/person_io.js
// 多人物的装载/保存编排(无 DOM;IO 全经回调注入,便于各 app 复用与单测)。
// 文件命名族由 person_files.js 推导;集合状态由 person_set.js 管理。
import { CocoDocument } from './coco_document.js';
import { AnnotationStore } from './annotation_store.js';
import { PersonSet } from './person_set.js';
import { discoverPersons, personTemplate } from './person_files.js';

const isCoco = (o) => typeof o === 'object' && o !== null && Array.isArray(o.images);

const BODY_KEYS = ['body_pose', 'mhr_pose', 'bbox'];
// 快速判断一份 json 能否作为人物标注载入:COCO(images + annotations 数组),标注带人体参数或框。
// 帧数(frameCount 已知时):比序列多 → 不收(无法对上画面);比序列少 → 收,按位置对齐前 N 帧并给出 note
// (如部分 sam/预测结果只覆盖序列前段)。返回 { ok, reason?, note? }。
export function probeAnnotation(raw, frameCount = null) {
  if (!isCoco(raw) || !Array.isArray(raw.annotations)) return { ok: false, reason: '不是 COCO 标注(缺 images/annotations)' };
  const n = raw.images.length;
  if (frameCount != null && n > frameCount) return { ok: false, reason: `${n} 帧,多于序列的 ${frameCount} 帧` };
  if (raw.annotations.length && !raw.annotations.some((x) => BODY_KEYS.some((k) => k in (x ?? {})))) {
    return { ok: false, reason: '标注里没有人体参数或框' };
  }
  const note = frameCount != null && n < frameCount ? `只有 ${n} 帧(序列 ${frameCount} 帧),按位置对齐前 ${n} 帧,其余帧为空(编辑后保存会补齐 images)` : null;
  return note ? { ok: true, note } : { ok: true };
}

// 帧轴补齐到 frameCount:images 少于序列帧数时在末尾补空帧(新 id 接在最大 id 之后),
// 使所有人物共用序列的完整帧轴(进度条覆盖全部点云帧)。只补 images,不动 annotations。
function padImages(raw, frameCount) {
  if (frameCount == null || raw.images.length >= frameCount) return raw;
  let next = raw.images.reduce((m, im) => Math.max(m, Number(im.id) || 0), -1) + 1;
  const images = [...raw.images];
  while (images.length < frameCount) images.push({ id: next++ });
  return { ...raw, images };
}

// 与主标注同目录、不属于 player_N 命名族的其他 json(如 player_pred.json)。manifest 与隐藏文件除外。
const NOT_ANNOTATION = new Set(['manifest.json']);
export function extraJsonCandidates(paths, primaryPath, familyPaths) {
  const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); };
  const dir = dirOf(String(primaryPath));
  const fam = new Set(familyPaths);
  return paths.filter((p) => {
    if (!/\.json$/i.test(p) || fam.has(p) || dirOf(p) !== dir) return false;
    const base = p.slice(dir.length);
    return !base.startsWith('.') && !NOT_ANNOTATION.has(base.toLowerCase());
  }).sort();
}

// 同帧轴的空文档:沿用 images[]/categories,annotations 清空(新建人物 / 无标注序列用)。
// info(含 body_model)与 cameras 也沿用:新人物必须与同数据集同一人体模型、同一相机配置。
export function emptyDocLike(raw) {
  const out = { images: structuredClone(raw?.images ?? []), annotations: [], categories: structuredClone(raw?.categories ?? []) };
  if (raw?.info) out.info = structuredClone(raw.info);
  if (raw?.cameras) out.cameras = structuredClone(raw.cameras);
  return out;
}

// paths:数据源里全部相对路径;primaryPath:0 号人物(主标注)路径(可尚不存在);
// readJson(path) → 对象|null;fallbackRaw:磁盘上一份都没有时 0 号人物用的文档(空帧轴)。
// extras:同时探测主标注同目录的其他 json(如 gt 的 player_0.json 与预测的 player_pred.json 并存),
//   格式合格的也列为人物(编号接在 player_N 之后,显示名 = 文件名);frameCount 用于校验帧数。
// 返回 { persons, skipped: [path], reasons: { path: 原因 }, notes: { path: 提示 }, extras: [path] }
// (skipped = 探测过但不合格的文件;notes = 收了但需要提醒的,如帧数少于序列)。
export async function loadPersonSet({ paths, primaryPath, readJson, fallbackRaw, extras = false, frameCount = null }) {
  const found = discoverPersons(paths, primaryPath);
  const entries = [];
  const skipped = [];
  const reasons = {}, notes = {};
  for (const { id, path } of found) {
    let raw = null;
    try { raw = await readJson(path); } catch (_) { raw = null; }
    if (!isCoco(raw)) { skipped.push(path); reasons[path] = '不是 COCO 标注'; continue; }
    const pr = probeAnnotation(raw, frameCount);
    if (pr.note) notes[path] = pr.note;
    entries.push({ id, path, store: new AnnotationStore(new CocoDocument(padImages(raw, frameCount))) });
  }
  const extraPaths = [];
  if (extras) {
    let next = found.reduce((m, f) => Math.max(m, f.id), -1) + 1;
    for (const path of extraJsonCandidates(paths, primaryPath, found.map((f) => f.path))) {
      let raw = null;
      try { raw = await readJson(path); } catch (_) { raw = null; }
      const pr = probeAnnotation(raw, frameCount);
      if (!pr.ok) { skipped.push(path); reasons[path] = pr.reason; continue; }
      if (pr.note) notes[path] = pr.note;
      const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/i, '');
      entries.push({ id: next++, path, name, store: new AnnotationStore(new CocoDocument(padImages(raw, frameCount))) });
      extraPaths.push(path);
    }
  }
  if (!entries.length) {
    // 尚无标注文件:0 号人物占位于 primaryPath(不算「新建」,未改动则不标脏)。
    // fallbackRaw 可为对象或惰性函数(帧轴要等背景/视频就绪才知道时)。
    const fb = typeof fallbackRaw === 'function' ? fallbackRaw() : fallbackRaw;
    entries.push({ id: 0, path: personTemplate(primaryPath).pathFor(0), store: new AnnotationStore(new CocoDocument(fb)) });
  }
  return { persons: new PersonSet(entries), skipped, reasons, notes, extras: extraPaths };
}

// 新建一个空人物(帧轴照抄当前人物),编号取 nextId,切为当前并对齐到 frame。
export function addEmptyPerson(persons, primaryPath, frame) {
  const id = persons.nextId();
  const base = persons.current().store.document().serialize();
  const store = new AnnotationStore(new CocoDocument(emptyDocLike(base)));
  persons.add({ id, path: personTemplate(primaryPath).pathFor(id), store, isNew: true });
  return persons.select(id, frame);
}

// 改号(文件名随之改为同族第 newId 号)。
export function renumberPerson(persons, primaryPath, id, newId) {
  return persons.renumber(id, newId, personTemplate(primaryPath).pathFor(newId));
}

// 保存:写出所有「脏」人物 + 当前人物(当前人物总写,与单人时「保存即写盘」一致),再删掉已删除人物的文件。
// serialize(store) → 要写的对象;writeJson(path, obj) → 实际写到的路径描述;removeFile(path)。
// 全部成功后 markSaved。返回 { written:[desc], removed:[path] }。
export async function savePersonSet(persons, { serialize, writeJson, removeFile }) {
  const cur = persons.current();
  const written = [];
  for (const p of persons.list()) {
    if (p !== cur && !persons.dirty(p)) continue;
    written.push(await writeJson(p.path, serialize(p.store)));
  }
  const removed = [];
  for (const path of persons.removedPaths()) {
    if (removeFile) await removeFile(path);
    removed.push(path);
  }
  persons.markSaved();
  return { written, removed };
}

// 整数编号输入校验(改号对话框用):返回 number 或抛出可读错误。
export function parsePersonId(text, persons) {
  const s = String(text ?? '').trim();
  if (!/^\d+$/.test(s)) throw new Error('编号须为非负整数');
  const n = Number(s);
  if (persons.has(n)) throw new Error(`player_${n} 已存在`);
  return n;
}
