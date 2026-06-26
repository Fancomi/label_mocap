// kpt_label/src/hit_test.js
// 命中测试（纯逻辑）。坐标与半径均为图像像素，调用方负责按当前缩放换算。
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
const inRect = (px, py, [x, y, w, h]) => px >= x && px <= x + w && py >= y && py <= y + h;

const CORNERS = { tl: (b) => [b[0], b[1]], tr: (b) => [b[0] + b[2], b[1]],
                  bl: (b) => [b[0], b[1] + b[3]], br: (b) => [b[0] + b[2], b[1] + b[3]] };

// 半径 r 内最近的可见关节索引；无命中 -1。
export function hitKeypoint(person, [px, py], r) {
  let best = -1, bestD = r * r;
  person.keypoints.forEach((k, i) => {
    if (k[2] <= 0) return;
    const d = dist2(px, py, k[0], k[1]);
    if (d <= bestD) { bestD = d; best = i; }
  });
  return best;
}

// 命中的框角名 'tl'|'tr'|'bl'|'br'，无则 null。
export function hitBboxCorner(person, [px, py], r) {
  if (!person.bbox) return null;
  let best = null, bestD = r * r;
  for (const name of Object.keys(CORNERS)) {
    const [cx, cy] = CORNERS[name](person.bbox);
    const d = dist2(px, py, cx, cy);
    if (d <= bestD) { bestD = d; best = name; }
  }
  return best;
}

// 点击命中的人 id：优先框内/近关键点，多人取最近代表距离；无命中 null。
export function hitPerson(persons, [px, py], r) {
  let best = null, bestD = Infinity;
  for (const p of persons) {
    let d = Infinity;
    if (p.bbox && inRect(px, py, p.bbox)) d = 0;
    for (const k of p.keypoints) if (k[2] > 0) d = Math.min(d, dist2(px, py, k[0], k[1]));
    if (d <= bestD && (d === 0 || d <= r * r)) { bestD = d; best = p.id; }
  }
  return best;
}
