// smpl_edit/joint_figure.js — 关节选择面板:人形图(SVG,同 kpt_label 的人体图)+ 分组按钮。
// 布局由人体模型的静止姿态算出(不手写坐标),SMPL/MHR 通用;MHR 另有左脚、右脚面板,手部开启时再有左手、右手。
// 人形「面向屏幕」:人物左侧在屏幕右侧(静止姿态里左侧在 +x,故 x 直接用)。
const NS = 'http://www.w3.org/2000/svg';
const GROUP_COLOR = ['#d4b800', '#4da6ff', '#ff7733', '#33cc66', '#cc44cc'];   // 同场景骨骼配色
const GROUP_TITLE = ['躯干', '左臂', '右臂', '左腿', '右腿'];
const FINGER = /_(pinky|ring|middle|index|thumb)\d$/;
const CAPTION = { body: '面向屏幕:人物左侧在右', lhand: '掌心朝前,手指朝上', rhand: '掌心朝前,手指朝上', lfoot: '侧视:脚尖朝右,脚底朝下', rfoot: '侧视:脚尖朝右,脚底朝下' };

// 骨架关节 j 所属分组(骨骼表里以 j 为子关节的那根骨的颜色组;根关节 = 躯干)。
function groupOf(body) {
  const g = new Map(body.bones.map(([, b, grp]) => [b, grp]));
  return (j) => g.get(j) ?? 0;
}

// 把 2D 点集缩放进 [pad, 1−pad]²,保持比例、居中。
function fit(pts, pad = 0.08) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = (1 - 2 * pad) / Math.max(x1 - x0, y1 - y0, 1e-9);
  const ox = (1 - (x1 - x0) * s) / 2, oy = (1 - (y1 - y0) * s) / 2;
  return pts.map(([x, y]) => [ox + (x - x0) * s, oy + (y - y0) * s]);
}

// 与另一关节重合(< 1cm,如 MHR 的 wrist_twist 与 wrist、foot 与 talocrural)的点要挪开,免得叠在一起点不到:
// 有子关节(在本面板里)就朝子关节挪,链条保持顺直;否则朝父关节挪。最多挪 4cm / 40% 骨长。
function spread(joints, list, parents, J) {
  const P = (j) => [J[j * 3], J[j * 3 + 1], J[j * 3 + 2]];
  const inList = new Set(list);
  const up = (j) => { let p = parents[j]; while (p >= 0 && !inList.has(p)) p = parents[p]; return p; };
  const out = new Map(list.map((j) => [j, P(j)]));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const j of list) {
    const p = out.get(j);
    if (!list.some((o) => o !== j && o < j && dist(p, out.get(o)) < 0.01)) continue;
    const child = list.find((c) => up(c) === j && dist(P(c), p) >= 0.01);
    let to = child != null ? P(child) : null;
    if (!to) { let par = parents[j]; while (par >= 0 && dist(P(par), p) < 0.01) par = parents[par]; if (par >= 0) to = P(par); }
    if (!to) continue;
    const L = dist(to, p);
    out.set(j, p.map((v, d) => v + (to[d] - v) / L * Math.min(0.04, L * 0.4)));
  }
  return out;
}

// 去拥挤:按关节顺序(父在子前)检查,离已放好的点太近就沿「父→子」方向把它连同后代推远,
// 直到间距 ≥ dmin(脚、手指这类短骨链在人形图里会被拉开,形状仍沿原方向)。
function declutter(xy, joints, parents, dmin) {
  const at = new Map(joints.map((j, i) => [j, i]));
  const parentIdx = joints.map((j) => { let p = parents[j]; while (p >= 0 && !at.has(p)) p = parents[p]; return p >= 0 ? at.get(p) : -1; });
  const desc = (i) => joints.map((_, k) => k).filter((k) => { for (let p = parentIdx[k]; p >= 0; p = parentIdx[p]) if (p === i) return true; return false; });
  for (let i = 0; i < joints.length; i++) {
    const p = parentIdx[i];
    if (p < 0) continue;
    for (let it = 0; it < 12; it++) {
      const tooClose = xy.some((q, k) => k < i && Math.hypot(q[0] - xy[i][0], q[1] - xy[i][1]) < dmin);
      if (!tooClose) break;
      let dx = xy[i][0] - xy[p][0], dy = xy[i][1] - xy[p][1];
      const L = Math.hypot(dx, dy);
      if (L < 1e-6) { dx = 0; dy = 1; } else { dx /= L; dy /= L; }
      const step = Math.max(dmin * 0.5, L * 0.3);
      for (const k of [i, ...desc(i)]) xy[k] = [xy[k][0] + dx * step, xy[k][1] + dy * step];
    }
  }
  return fit(xy);
}

// 面板列表 [{ key, title, joints:[骨架关节], xy:[[x,y]∈[0,1]], edges:[[ia, ib]] }]。纯函数。
export function figureLayouts(body) {
  const J = body.forward({ ...body.defaultFields(), root_pos: [0, 0, 0], root_rota: [0, 0, 0] }).joints;
  const names = body.jointNames;
  const shown = body.displayJoints;
  const isFinger = (j) => FINGER.test(names[j] ?? '');
  const panel = (key, title, joints, to2d) => {
    const pos = spread(J, joints, body.parents, J);
    const xy = declutter(fit(joints.map((j) => to2d(pos.get(j)))), joints, body.parents, 0.065);
    const idx = new Map(joints.map((j, i) => [j, i]));
    const edges = body.bones.filter(([a, b]) => idx.has(a) && idx.has(b)).map(([a, b]) => [idx.get(a), idx.get(b)]);
    return { key, title, joints, xy, edges, caption: CAPTION[key] };
  };
  // 身体:正面略俯视(前方 z 往下),脚尖不再和脚踝叠在一点。
  // MHR 的脚有 4 个以上关节,单独成「左脚 / 右脚」面板(侧视:脚尖朝屏幕右、脚底在下);身体图只画到踝。
  const FOOT = /^[lr]_(talocrural|subtalar|transversetarsal|ball)$/;
  const footOf = (side) => shown.filter((j) => FOOT.test(names[j] ?? '') && names[j].startsWith(`${side}_`));
  const footPanels = ['l', 'r'].map((side) => ({ side, distal: footOf(side), ankle: names.indexOf(`${side}_foot`) }))
    .filter((f) => f.distal.length >= 2 && f.ankle >= 0);
  const inFoot = new Set(footPanels.flatMap((f) => f.distal));
  const out = [panel('body', '身体', shown.filter((j) => !isFinger(j) && !inFoot.has(j)), ([x, y, z]) => [x, -y + 0.35 * z])];
  for (const [side, key, title] of [['l', 'lhand', '左手'], ['r', 'rhand', '右手']]) {
    const fingers = shown.filter((j) => isFinger(j) && names[j].startsWith(`${side}_`));
    const wrist = names.indexOf(`${side}_wrist`);
    if (!fingers.length || wrist < 0) continue;
    const P = (j) => [J[j * 3], J[j * 3 + 1], J[j * 3 + 2]];
    const sub = (a, b) => a.map((v, d) => v - b[d]);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const norm = (a) => { const n = Math.hypot(...a) || 1; return a.map((v) => v / n); };
    const w = P(wrist);
    const up = norm(sub(P(names.indexOf(`${side}_middle1`)), w));            // 腕 → 中指根 = 屏幕上
    const th = sub(P(names.indexOf(`${side}_thumb1`)), P(names.indexOf(`${side}_pinky1`)));
    const lat = norm(sub(th, up.map((v) => v * dot(th, up))));               // 小指 → 拇指
    // 解剖位(掌心朝前):拇指朝外侧 → 左手拇指在屏幕右,右手拇指在屏幕左。
    const sx = side === 'l' ? 1 : -1;
    out.push(panel(key, title, [wrist, ...fingers], (p) => { const d = sub(p, w); return [sx * dot(d, lat), -dot(d, up)]; }));
  }
  for (const f of footPanels) {
    out.push(panel(f.side === 'l' ? 'lfoot' : 'rfoot', f.side === 'l' ? '左脚' : '右脚', [f.ankle, ...f.distal], ([, y, z]) => [z, -y]));
  }
  return out;
}

// 姿态按钮分组 [{ title, color, ks:[姿态按钮序号] }],按骨骼配色组;MHR 手指单列左手/右手。
export function poseGroups(body) {
  const grp = groupOf(body);
  const names = body.jointNames;
  const groups = [...GROUP_TITLE.map((title, g) => ({ title, color: GROUP_COLOR[g], ks: [] })),
    { title: '左手', color: GROUP_COLOR[1], ks: [] }, { title: '右手', color: GROUP_COLOR[2], ks: [] }];
  body.poseJoints.forEach((j, k) => {
    const n = names[j] ?? '';
    if (FINGER.test(n)) groups[n.startsWith('l_') ? 5 : 6].ks.push(k);
    else groups[grp(j)].ks.push(k);
  });
  return groups.filter((g) => g.ks.length);
}

const svgEl = (tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

// DOM:host 里放面板切换条 + SVG 人形 + 分组按钮。onPick(骨架关节 j)。
// buttons() 返回按姿态序号 k 排列的按钮数组(IK 插件等按 k 读写它们)。
export class JointFigure {
  constructor({ figureHost, gridHost, onPick, onSelectPose }) {
    this._figureHost = figureHost;
    this._gridHost = gridHost;
    this._onPick = onPick;
    this._onSelectPose = onSelectPose;
    this._buttons = [];
    this._dots = [];
    this._panel = 'body';
  }

  buttons() { return this._buttons; }

  setBody(body) {
    this._body = body;
    this._layouts = figureLayouts(body);
    if (!this._layouts.some((l) => l.key === this._panel)) this._panel = 'body';
    this._renderFigure();
    this._renderGrid();
  }

  _renderFigure() {
    const host = this._figureHost;
    host.innerHTML = '';
    if (this._layouts.length > 1) {
      const bar = document.createElement('div');
      bar.className = 'row figure-tabs';
      for (const l of this._layouts) {
        const b = document.createElement('button');
        b.textContent = l.title;
        b.classList.toggle('on', l.key === this._panel);
        b.addEventListener('click', () => { this._panel = l.key; this._renderFigure(); this._paintSelected(); });
        bar.appendChild(b);
      }
      host.appendChild(bar);
    }
    const lay = this._layouts.find((l) => l.key === this._panel);
    const W = 100, H = 110;
    const svg = svgEl('svg', { viewBox: `0 -8 ${W} ${H + 8}` });
    svg.classList.add('body-diagram');
    const t = svgEl('text', { x: 4, y: -2, 'font-size': 5, fill: '#778' });
    t.textContent = lay.caption ?? '';
    svg.appendChild(t);
    const grp = groupOf(this._body);
    const P = (i) => [lay.xy[i][0] * W, lay.xy[i][1] * H];
    for (const [a, b] of lay.edges) {
      const [ax, ay] = P(a), [bx, by] = P(b);
      svg.appendChild(svgEl('line', { x1: ax, y1: ay, x2: bx, y2: by, stroke: GROUP_COLOR[grp(lay.joints[b])], 'stroke-width': 1, opacity: 0.6 }));
    }
    const r = lay.key === 'body' ? 3 : 2.6;
    this._dots = lay.joints.map((j, i) => {
      const [cx, cy] = P(i);
      const pickable = j === this._body.rootJoint || this._body.poseJoints.includes(j);
      const c = svgEl('circle', { cx, cy, r, fill: GROUP_COLOR[grp(j)], 'fill-opacity': pickable ? 1 : 0.25 });
      const title = svgEl('title', {});
      const k = this._body.poseJoints.indexOf(j);
      title.textContent = (k >= 0 ? `${this._body.poseLabels[k]} · ` : '') + this._body.jointNames[j] + (j === this._body.rootJoint ? '(整体)' : '');
      c.appendChild(title);
      if (pickable) { c.style.cursor = 'pointer'; c.addEventListener('click', () => this._onPick(j)); }
      svg.appendChild(c);
      return { j, c };
    });
    host.appendChild(svg);
  }

  _renderGrid() {
    const host = this._gridHost;
    host.innerHTML = '';
    this._buttons.length = 0;
    for (const g of poseGroups(this._body)) {
      const h = document.createElement('div');
      h.className = 'joint-group-title';
      h.textContent = g.title;
      h.style.color = g.color;
      host.appendChild(h);
      const box = document.createElement('div');
      box.className = 'joint-grid';
      for (const k of g.ks) {
        const b = document.createElement('button');
        b.textContent = this._body.poseLabels[k];
        b.title = this._body.jointNames[this._body.poseJoints[k]];
        b.addEventListener('click', () => this._onSelectPose(k));
        box.appendChild(b);
        this._buttons[k] = b;
      }
      host.appendChild(box);
    }
  }

  // 高亮:selected = 骨架关节 j(或 null)。人形里选中关节白圈,若在另一面板则自动切过去。
  // 只在选择「变化」时自动切面板;用户手动点面板标签后,即便选中关节不在该面板也不再被拉回。
  setSelected(j) {
    const changed = j !== this._selected;
    this._selected = j;
    const lay = this._layouts?.find((l) => l.key === this._panel);
    if (changed && j != null && lay && !lay.joints.includes(j)) {
      const other = this._layouts.find((l) => l.key !== 'body' && l.joints.includes(j));
      if (other) { this._panel = other.key; this._renderFigure(); }
    }
    this._paintSelected();
  }

  _paintSelected() {
    const j = this._selected;
    for (const { j: jj, c } of this._dots) {
      c.setAttribute('stroke', jj === j ? '#fff' : 'none');
      c.setAttribute('stroke-width', jj === j ? 1.6 : 0);
    }
  }
}
