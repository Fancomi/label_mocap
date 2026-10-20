// smpl_edit/frame_marks.js
// 「每帧有/无标注」的纯逻辑(无 DOM):掩码构建、计数、跳到上/下一个有标注帧、游程(画条用)。
// 掩码 = Uint8Array(n),1 = 该帧(按帧位置,非 image_id)有标注。

export function buildMask(n, has) {
  const m = new Uint8Array(Math.max(0, n | 0));
  for (let i = 0; i < m.length; i++) m[i] = has(i) ? 1 : 0;
  return m;
}

export function countMarked(mask) {
  let c = 0;
  for (let i = 0; i < mask.length; i++) c += mask[i] ? 1 : 0;
  return c;
}

// 从 from 出发沿 dir(+1 / -1)找下一个有标注帧(不含 from 本身,不回绕)。找不到返回 -1。
export function findMarked(mask, from, dir) {
  const step = dir < 0 ? -1 : 1;
  for (let i = from + step; i >= 0 && i < mask.length; i += step) if (mask[i]) return i;
  return -1;
}

// 有标注帧的连续区间 [[start, endExclusive], ...],按帧序。
export function markRuns(mask) {
  const runs = [];
  let s = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && s < 0) s = i;
    else if (!mask[i] && s >= 0) { runs.push([s, i]); s = -1; }
  }
  if (s >= 0) runs.push([s, mask.length]);
  return runs;
}

// 已标注摘要文本(多人物时逐人列出),供状态栏「已加载 N 帧」后面接。
// persons: [{ label, count }]
export function markedSummary(persons) {
  if (!persons.length) return '已标注 0 帧';
  if (persons.length === 1) return `已标注 ${persons[0].count} 帧`;
  return `已标注 ${persons.map((p) => `${p.label} ${p.count} 帧`).join(' / ')}`;
}
