// smpl_edit/person_io.js
// 多人物的装载/保存编排(无 DOM;IO 全经回调注入,便于各 app 复用与单测)。
// 文件命名族由 person_files.js 推导;集合状态由 person_set.js 管理。
import { CocoDocument } from './coco_document.js';
import { AnnotationStore } from './annotation_store.js';
import { PersonSet } from './person_set.js';
import { discoverPersons, personTemplate } from './person_files.js';

const isCoco = (o) => typeof o === 'object' && o !== null && Array.isArray(o.images);

// 同帧轴的空文档:沿用 images[]/categories,annotations 清空(新建人物 / 无标注序列用)。
export function emptyDocLike(raw) {
  return { images: structuredClone(raw?.images ?? []), annotations: [], categories: structuredClone(raw?.categories ?? []) };
}

// paths:数据源里全部相对路径;primaryPath:0 号人物(主标注)路径(可尚不存在);
// readJson(path) → 对象|null;fallbackRaw:磁盘上一份都没有时 0 号人物用的文档(空帧轴)。
// 返回 { persons: PersonSet, skipped: [path] }(skipped = 不是 COCO 格式、未加载的同族文件)。
export async function loadPersonSet({ paths, primaryPath, readJson, fallbackRaw }) {
  const found = discoverPersons(paths, primaryPath);
  const entries = [];
  const skipped = [];
  for (const { id, path } of found) {
    let raw = null;
    try { raw = await readJson(path); } catch (_) { raw = null; }
    if (!isCoco(raw)) { skipped.push(path); continue; }
    entries.push({ id, path, store: new AnnotationStore(new CocoDocument(raw)) });
  }
  if (!entries.length) {
    // 尚无标注文件:0 号人物占位于 primaryPath(不算「新建」,未改动则不标脏)。
    // fallbackRaw 可为对象或惰性函数(帧轴要等背景/视频就绪才知道时)。
    const fb = typeof fallbackRaw === 'function' ? fallbackRaw() : fallbackRaw;
    entries.push({ id: 0, path: personTemplate(primaryPath).pathFor(0), store: new AnnotationStore(new CocoDocument(fb)) });
  }
  return { persons: new PersonSet(entries), skipped };
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
