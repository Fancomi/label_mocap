// kpt_label/src/body_diagram.js
// 数据驱动的 SVG 人体图图例：选关节用。
// 人体「面向屏幕」（对齐 Maya humanIK）：显示时镜像 x —— 人物右半身落屏幕左、左半身落屏幕右。
// 左右用骨架配色区分（与图像画布同一套 SIDE_COLOR），不靠文本；关节名默认隐藏，可开关。
import { jointColor, edgeColor, SIDE_COLOR } from './skeleton.js';

const NS = 'http://www.w3.org/2000/svg';
const VW = 100, VH = 110, HEAD = 12;   // HEAD：顶部留白带，放侧标

const el = (tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

export class BodyDiagram {
  // host: 容器；skel: 骨架配置；handlers: { onPick(i), onToggle(i) }。
  constructor(host, skel, { onPick, onToggle } = {}) {
    this._skel = skel;
    this._onPick = onPick;
    this._onToggle = onToggle;
    this._showLabel = false;
    this._lastArmed = -1;
    this._svg = el('svg', { viewBox: `0 ${-HEAD} ${VW} ${VH + HEAD}` });
    this._svg.classList.add('body-diagram');
    host.appendChild(this._svg);
    this._dots = [];
    this._build();
  }

  // 镜像 x：人物右(原 x<0.5) → 屏幕左。
  _xy(p) { return [(1 - p.x) * VW, p.y * VH]; }

  _text(x, y, str, { size = 6, fill = '#778' } = {}) {
    const t = el('text', { x, y, 'font-size': size, fill, 'text-anchor': 'middle' });
    t.textContent = str;
    this._svg.appendChild(t);
    return t;
  }

  _build() {
    const { layout, edges, names } = this._skel;
    // 顶部侧标（镜像后：屏幕左=人物右），用对应侧色强化记忆。
    this._text(VW * 0.22, -HEAD + 6, '人物右侧', { fill: SIDE_COLOR.R });
    this._text(VW * 0.78, -HEAD + 6, '人物左侧', { fill: SIDE_COLOR.L });
    this._caption = this._text(VW / 2, -1, '', { size: 7, fill: '#9ecbff' });
    for (const [a, b] of edges) {
      const [ax, ay] = this._xy(layout[a]);
      const [bx, by] = this._xy(layout[b]);
      this._svg.appendChild(el('line', { x1: ax, y1: ay, x2: bx, y2: by, stroke: edgeColor(this._skel, a, b), 'stroke-width': 1, opacity: 0.6 }));
    }
    layout.forEach((p, i) => {
      const [cx, cy] = this._xy(p);
      const c = el('circle', { cx, cy, r: 3.5, fill: jointColor(this._skel, i) });
      c.style.cursor = 'pointer';
      const title = el('title', {});
      title.textContent = names[i];
      c.appendChild(title);
      c.addEventListener('click', () => this._onPick?.(i));
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); this._onToggle?.(i); });
      this._svg.appendChild(c);
      this._dots[i] = c;
    });
  }

  setLabelVisible(b) { this._showLabel = b; this._renderCaption(); }
  _renderCaption() {
    this._caption.textContent = (this._showLabel && this._lastArmed >= 0) ? this._skel.names[this._lastArmed] : '';
  }

  // 刷新：fill 用侧色，可见性用不透明度/描边区分；armed 白圈高亮。
  // kpts: Array(N) of [x,y,v] 或 null（无选中人）；armed: 待标/选中关节索引或 -1。
  update(kpts, armed = -1) {
    this._lastArmed = armed;
    this._dots.forEach((c, i) => {
      const v = kpts ? kpts[i][2] : 0;
      // v=2 实心；v=1 空心（侧色描边）；v=0 淡显。
      c.setAttribute('fill-opacity', v === 2 ? 1 : v === 1 ? 0 : 0.22);
      const ringed = i === armed;
      c.setAttribute('stroke', ringed ? '#fff' : jointColor(this._skel, i));
      c.setAttribute('stroke-width', ringed ? 2 : v === 1 ? 1.4 : 0);
    });
    this._renderCaption();
  }
}
