// smpl_edit/person_files.js
// 多人物 = 每人一个 COCO 文件(player_N.json)。本模块只做纯路径推导(无 IO):
// 由「主标注文件路径」推出同一命名族里第 N 号人物的路径,以及反查某路径是几号人物。
// 三种命名族:
//   a/player_0/player_0.json   → a/player_N/player_N.json   (diving json_results 布局)
//   a/player_0.json            → a/player_N.json            (同目录平铺,如点云序列目录)
//   a/<name>.json              → 0 号即本文件,其余 a/<name>_player_N.json
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const personLabel = (id) => `player_${id}`;

export function personTemplate(primaryPath) {
  const p = String(primaryPath);
  let m = /^(.*?)player_(\d+)\/player_\2\.json$/.exec(p);
  if (m) {
    const pre = m[1];
    const re = new RegExp(`^${esc(pre)}player_(\\d+)/player_\\1\\.json$`);
    return { pathFor: (n) => `${pre}player_${n}/player_${n}.json`, idOf: (q) => { const k = re.exec(q); return k ? Number(k[1]) : null; } };
  }
  m = /^(.*\/)?player_(\d+)\.json$/.exec(p);
  if (m) {
    const dir = m[1] ?? '';
    const re = new RegExp(`^${esc(dir)}player_(\\d+)\\.json$`);
    return { pathFor: (n) => `${dir}player_${n}.json`, idOf: (q) => { const k = re.exec(q); return k ? Number(k[1]) : null; } };
  }
  const stem = p.replace(/\.json$/i, '');
  const re = new RegExp(`^${esc(stem)}_player_(\\d+)\\.json$`);
  return {
    pathFor: (n) => (n === 0 ? p : `${stem}_player_${n}.json`),
    idOf: (q) => { if (q === p) return 0; const k = re.exec(q); return k ? Number(k[1]) : null; },
  };
}

// 主标注路径未知时(目录里只有 player_1.json 之类),按任一 player_N 文件推出同族 0 号路径。
// 找不到返回 null。
export function inferPrimaryPath(paths) {
  const hit = paths.find((p) => /(^|\/)player_\d+\.json$/.test(p));
  return hit ? personTemplate(hit).pathFor(0) : null;
}

// 在 paths 里找出与 primaryPath 同族的全部人物文件,按 id 升序 [{id, path}]。同 id 取先见者。
export function discoverPersons(paths, primaryPath) {
  if (!primaryPath) return [];
  const t = personTemplate(primaryPath);
  const byId = new Map();
  for (const path of paths) {
    const id = t.idOf(path);
    if (id != null && !byId.has(id)) byId.set(id, path);
  }
  return [...byId.entries()].sort((a, b) => a[0] - b[0]).map(([id, path]) => ({ id, path }));
}
