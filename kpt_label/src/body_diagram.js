// kpt_label/src/body_diagram.js
// 数据驱动的 SVG 人体图图例：选关节用。layout 归一化坐标映射到 viewBox 100x110。
const NS = 'http://www.w3.org/2000/svg';
const VW = 100, VH = 110;

export class BodyDiagram {
  // host: 容器元素；skel: 骨架配置；onPick(index): 选中关节回调。
  constructor(host, skel, onPick) {
    this._skel = skel;
    this._onPick = onPick;
    this._svg = document.createElementNS(NS, 'svg');
    this._svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
    this._svg.classList.add('body-diagram');
    host.appendChild(this._svg);
    this._dots = [];
    this._build();
  }

  _xy(p) { return [p.x * VW, p.y * VH]; }

  _build() {
    const { layout, edges } = this._skel;
    for (const [a, b] of edges) {
      const [ax, ay] = this._xy(layout[a]);
      const [bx, by] = this._xy(layout[b]);
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', ax); ln.setAttribute('y1', ay);
      ln.setAttribute('x2', bx); ln.setAttribute('y2', by);
      ln.setAttribute('stroke', '#555'); ln.setAttribute('stroke-width', '1');
      this._svg.appendChild(ln);
    }
    layout.forEach((p, i) => {
      const [cx, cy] = this._xy(p);
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', '3.5');
      c.style.cursor = 'pointer';
      c.addEventListener('click', () => this._onPick(i));
      this._svg.appendChild(c);
      this._dots[i] = c;
    });
  }

  // 按当前选中人的 keypoints + 待放置索引刷新着色。
  // kpts: Array(N) of [x,y,v] 或 null（无选中人）；armed: 待放置关节索引或 -1。
  update(kpts, armed = -1) {
    this._dots.forEach((c, i) => {
      const v = kpts ? kpts[i][2] : 0;
      const fill = v === 2 ? '#39d353' : v === 1 ? '#e3a008' : '#444';
      c.setAttribute('fill', fill);
      c.setAttribute('stroke', i === armed ? '#fff' : 'none');
      c.setAttribute('stroke-width', i === armed ? '2' : '0');
    });
  }
}
