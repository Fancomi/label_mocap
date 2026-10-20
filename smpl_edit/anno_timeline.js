// smpl_edit/anno_timeline.js
// 进度条下方的「有/无标注」可视化条 + 已标注计数 + 上/下一有标注帧按钮(DOM 组件,三个 app 共用)。
// 纯逻辑(掩码/游程/跳转)在 frame_marks.js;本文件只管画和事件。
// 多人物时每人一行:当前人物一行粗且亮,其余细而暗。条与 slider 同一映射(帧值→x),
// 并画当前帧光标;在条上点击/拖动即跳帧(onSeek)。
import { markRuns, countMarked } from './frame_marks.js';

// 原生 range 的拇指中心不会走到轨道两端,两侧各缩进约半个拇指宽,让条与拇指对齐。
const THUMB_HALF = 8;
const ROW_CUR = 10, ROW_OTHER = 4, ROW_GAP = 2;
const COLOR = { empty: '#1d232c', cur: '#2fbf71', other: '#4a7fa8', cursor: '#ffffff' };

export class AnnoTimeline {
  // host: 容器元素(组件往里填);onSeek(i):点击/拖动条;onJump(dir):上/下一有标注帧(-1/+1)。
  constructor({ host, onSeek, onJump }) {
    this._onSeek = onSeek; this._onJump = onJump;
    this._n = 0; this._cur = 0; this._rows = [];
    host.classList.add('anno-timeline');
    host.innerHTML = '';
    this._canvas = document.createElement('canvas');
    // 各 app 的全局 `canvas { position:absolute; … }` 是给主渲染画布的,这里显式还原为文档流内。
    this._canvas.style.cssText = 'display:block;position:static;transform:none;width:100%;cursor:pointer;border-radius:2px';
    this._info = document.createElement('div');
    this._info.style.cssText = 'font-size:11px;color:#9ab;display:flex;justify-content:space-between;gap:6px';
    const row = document.createElement('div'); row.className = 'row';
    this._prev = document.createElement('button'); this._prev.textContent = '⇤ 上一标注'; this._prev.title = '跳到上一个有标注的帧';
    this._next = document.createElement('button'); this._next.textContent = '下一标注 ⇥'; this._next.title = '跳到下一个有标注的帧';
    row.append(this._prev, this._next);
    host.append(this._canvas, this._info, row);
    this._prev.addEventListener('click', () => this._onJump?.(-1));
    this._next.addEventListener('click', () => this._onJump?.(+1));
    this._bindScrub();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this._draw()).observe(this._canvas);
    this._draw();
  }

  // rows: [{ mask: Uint8Array, active: bool, label }];current:当前帧。
  setData({ n, current, rows }) {
    this._n = n; this._cur = current; this._rows = rows ?? [];
    this._draw();
  }

  setCurrent(i) { if (i !== this._cur) { this._cur = i; this._draw(); } }

  _activeRow() { return this._rows.find((r) => r.active) ?? this._rows[0] ?? null; }

  // 帧值 v ∈ [0, n-1] → css x,与 range 的拇指中心同一映射。
  _x(v, W) {
    const span = Math.max(1, this._n - 1);
    return THUMB_HALF + (v / span) * Math.max(1, W - 2 * THUMB_HALF);
  }

  _frameAt(clientX) {
    const r = this._canvas.getBoundingClientRect();
    const span = Math.max(1, this._n - 1);
    const t = (clientX - r.left - THUMB_HALF) / Math.max(1, r.width - 2 * THUMB_HALF);
    return Math.max(0, Math.min(this._n - 1, Math.round(t * span)));
  }

  _bindScrub() {
    const c = this._canvas;
    let down = false;
    c.addEventListener('pointerdown', (e) => {
      if (!this._n) return;
      down = true; c.setPointerCapture(e.pointerId);
      this._onSeek?.(this._frameAt(e.clientX));
    });
    c.addEventListener('pointermove', (e) => {
      if (!this._n) return;
      const i = this._frameAt(e.clientX);
      const a = this._activeRow();
      c.title = `第 ${i + 1} 帧 · ${a && a.mask[i] ? '有标注' : '无标注'}`;
      if (down && i !== this._cur) this._onSeek?.(i);
    });
    const up = (e) => { down = false; try { c.releasePointerCapture(e.pointerId); } catch (_) { /* 未捕获 */ } };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  _draw() {
    const c = this._canvas;
    const rows = this._rows.length ? this._rows : [{ mask: new Uint8Array(0), active: true }];
    const H = rows.reduce((h, r) => h + (r.active ? ROW_CUR : ROW_OTHER), 0) + ROW_GAP * (rows.length - 1);
    const W = c.clientWidth || 0;
    c.style.height = `${H}px`;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    c.width = Math.max(1, Math.round(W * dpr)); c.height = Math.max(1, Math.round(H * dpr));
    const g = c.getContext('2d'); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const n = this._n;
    let y = 0;
    for (const r of rows) {
      const h = r.active ? ROW_CUR : ROW_OTHER;
      g.fillStyle = COLOR.empty; g.fillRect(0, y, W, h);
      if (n > 0) {
        g.fillStyle = r.active ? COLOR.cur : COLOR.other;
        for (const [s, e] of markRuns(r.mask)) {
          const x0 = Math.max(0, this._x(s - 0.5, W)), x1 = Math.min(W, this._x(e - 0.5, W));
          g.fillRect(x0, y, Math.max(1, x1 - x0), h);   // 单帧也至少 1px 可见
        }
      }
      y += h + ROW_GAP;
    }
    if (n > 0) {
      const x = this._x(this._cur, W);
      g.fillStyle = COLOR.cursor; g.fillRect(Math.round(x) - 1, 0, 2, H);
    }
    const a = this._activeRow();
    const cnt = a ? countMarked(a.mask) : 0;
    const here = a && n ? (a.mask[this._cur] ? '本帧 ✅' : '本帧 —') : '';
    this._info.innerHTML = '';
    const l = document.createElement('span'); l.textContent = n ? `已标注 ${cnt} / ${n} 帧` : '已标注 —';
    const rgt = document.createElement('span'); rgt.textContent = here;
    this._info.append(l, rgt);
    const hasAny = cnt > 0;
    this._prev.disabled = !hasAny; this._next.disabled = !hasAny;
  }
}
