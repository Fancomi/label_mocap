// smpl_edit/person_panel.js
// 人物切换面板(DOM 组件,标注器共用):人物列表(点选切换,带已标注帧数)+ 新建 / 改号 / 删除。
// 只负责展示与收集意图,增删改的状态与 IO 由宿主经回调完成(PersonSet + 各 app 的 source)。
// readOnly(查看器)时只显示切换,不显示增删改。
import { personLabel } from './person_files.js';

export class PersonPanel {
  // host: 容器;onSelect(id);onAdd();onRenumber(id);onRemove(id)。
  constructor({ host, onSelect, onAdd, onRenumber, onRemove, readOnly = false }) {
    this._h = { onSelect, onAdd, onRenumber, onRemove };
    this._readOnly = readOnly;
    host.innerHTML = '';
    this._list = document.createElement('div');
    this._list.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
    host.appendChild(this._list);
    if (!readOnly) {
      const row = document.createElement('div'); row.className = 'row';
      const mk = (label, title, fn) => { const b = document.createElement('button'); b.textContent = label; b.title = title; b.addEventListener('click', fn); row.appendChild(b); return b; };
      this._add = mk('＋ 新建', '新建一个人物(空标注)', () => this._h.onAdd?.());
      this._ren = mk('✎ 改号', '修改当前人物编号(文件名随之改为 player_N)', () => this._cur != null && this._h.onRenumber?.(this._cur));
      this._del = mk('🗑 删除', '删除当前人物(保存时删除其标注文件)', () => this._cur != null && this._h.onRemove?.(this._cur));
      host.appendChild(row);
    }
    this._cur = null;
    this.render([], null);
  }

  // persons: [{ id, count, dirty }];current: 当前人物 id。
  render(persons, current) {
    this._cur = current;
    this._list.innerHTML = '';
    if (!persons.length) {
      const s = document.createElement('span'); s.style.color = '#789'; s.textContent = '—'; this._list.appendChild(s);
    }
    for (const p of persons) {
      const b = document.createElement('button');
      b.textContent = `${personLabel(p.id)}${p.dirty ? ' *' : ''} (${p.count})`;
      b.title = `${personLabel(p.id)}:已标注 ${p.count} 帧${p.dirty ? ' · 有未保存修改' : ''}`;
      b.style.flex = '0 0 auto';
      b.classList.toggle('on', p.id === current);
      b.addEventListener('click', () => { if (p.id !== this._cur) this._h.onSelect?.(p.id); });
      this._list.appendChild(b);
    }
    if (!this._readOnly) {
      const none = current == null;
      this._add.disabled = !persons.length && none;
      this._ren.disabled = none;
      this._del.disabled = none || persons.length <= 1;
    }
  }
}
