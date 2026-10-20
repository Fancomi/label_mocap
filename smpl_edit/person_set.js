// smpl_edit/person_set.js
// 多人物标注集合(纯逻辑,无 DOM/IO):每个人物 = { id, path, store(AnnotationStore), isNew }。
// 同一时刻只有一个「当前人物」接受编辑;各人物的 undo 栈互相独立(各自的 store)。
// 删除只记账(removedPaths),真正删盘由宿主在「保存」时执行 —— 与其他编辑一样,未保存前
// 「重置」即可反悔。dirty(p) = 内存与磁盘不一致(store 有改动,或是新建/改号/整份替换)。
export class PersonSet {
  constructor(entries = []) {
    this._list = [];
    this._cur = null;
    this._removed = [];
    for (const e of entries) this.add(e);
  }

  list() { return [...this._list].sort((a, b) => a.id - b.id); }
  size() { return this._list.length; }
  has(id) { return this._list.some((p) => p.id === id); }
  get(id) { return this._list.find((p) => p.id === id) ?? null; }
  currentId() { return this._cur; }
  current() { return this.get(this._cur); }
  nextId() { return this._list.reduce((m, p) => Math.max(m, p.id), -1) + 1; }

  add({ id, path, store, isNew = false }) {
    if (this.has(id)) throw new Error(`人物 ${id} 已存在`);
    this._list.push({ id, path, store, isNew, savedRev: isNew ? -1 : store.revision() });
    // 若同路径此前被删过(删了又建回同号),就不再删盘。
    this._removed = this._removed.filter((p) => p !== path);
    if (this._cur == null) this._cur = id;
    return this.get(id);
  }

  // 切到 id;给了 frame 则新人物的 store 对齐到该帧(切人不跳帧)。
  select(id, frame) {
    const p = this.get(id);
    if (!p) throw new Error(`人物 ${id} 不存在`);
    this._cur = id;
    if (frame != null) p.store.setFrame(Math.max(0, Math.min(frame, p.store.frameCount() - 1)));
    return p;
  }

  // 删除人物。至少保留一人。已落盘的(非 isNew)记入 removedPaths 待保存时删除。
  // 删的是当前人物时,改选相邻(优先后一个)。返回删除后的当前人物。
  remove(id) {
    if (this._list.length <= 1) throw new Error('至少保留一个人物');
    const sorted = this.list();
    const idx = sorted.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`人物 ${id} 不存在`);
    const victim = sorted[idx];
    this._list = this._list.filter((p) => p.id !== id);
    if (!victim.isNew && victim.path) this._removed.push(victim.path);
    if (this._cur === id) this._cur = (sorted[idx + 1] ?? sorted[idx - 1]).id;
    return this.current();
  }

  // 改号:id → newId,文件路径随之改为 newPath。旧文件(已落盘的)保存时删除,新路径按新建写出。
  renumber(id, newId, newPath) {
    const p = this.get(id);
    if (!p) throw new Error(`人物 ${id} 不存在`);
    if (newId === id) return p;
    if (this.has(newId)) throw new Error(`人物 ${newId} 已存在`);
    if (!p.isNew && p.path) this._removed.push(p.path);
    this._removed = this._removed.filter((q) => q !== newPath);
    p.id = newId; p.path = newPath; p.isNew = true; p.savedRev = -1;
    if (this._cur === id) this._cur = newId;
    return p;
  }

  // 整份替换某人物的标注(如手动加载 JSON):视为未保存修改。
  replaceStore(id, store) { const p = this.get(id); if (p) { p.store = store; p.savedRev = -1; } return p; }
  dirty(p) { return p.isNew || p.store.revision() !== p.savedRev; }
  anyDirty() { return this._removed.length > 0 || this._list.some((p) => this.dirty(p)); }
  removedPaths() { return [...this._removed]; }
  // 保存成功后调用:清删除账,全部人物记为已落盘。
  markSaved() {
    this._removed = [];
    for (const p of this._list) { p.isNew = false; p.savedRev = p.store.revision(); }
  }
}
