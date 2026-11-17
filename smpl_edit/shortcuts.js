// smpl_edit/shortcuts.js — 各标注器统一的快捷键(label / pcd_label / mhr_label 共用一张表)。
// 宿主只提供动作回调;某个动作不提供 = 该页没有这个快捷键(提示里也不列)。
//   Ctrl/⌘+Z 撤销 · 空格 播放/暂停 · ← → 上/下一帧 · [ ] 上/下一有标注帧
//   F 居中选中关节(未选则当前人物;3D,保持视角朝向,一次性) · R 重置当前视图(朝向/缩放)
export const SHORTCUTS = [
  { action: 'undo', keys: 'Ctrl/⌘+Z', label: '撤销' },
  { action: 'play', keys: '空格', label: '播放 / 暂停' },
  { action: 'prevFrame', keys: '← / →', label: '上 / 下一帧', pair: 'nextFrame' },
  { action: 'prevMarked', keys: '[ / ]', label: '上 / 下一有标注帧', pair: 'nextMarked' },
  { action: 'focus', keys: 'F', label: '居中选中的关节;未选关节则居中当前人物(3D,保持朝向)' },
  { action: 'reset', keys: 'R', label: '重置当前视图' },
];

// 键盘事件 → 动作名(纯函数,不看焦点)。
export function matchShortcut(e) {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (mod && !e.shiftKey && !e.altKey && (k === 'z' || k === 'Z')) return 'undo';
  if (mod || e.altKey) return null;
  if (k === ' ' || e.code === 'Space') return 'play';
  if (k === 'ArrowLeft') return 'prevFrame';
  if (k === 'ArrowRight') return 'nextFrame';
  if (k === '[') return 'prevMarked';
  if (k === ']') return 'nextMarked';
  if (k === 'f' || k === 'F') return 'focus';
  if (k === 'r' || k === 'R') return 'reset';
  return null;
}

// 焦点在文本/数字输入框里时把键留给输入框(含其自身的撤销);在滑块/按钮上时快捷键照常生效。
export function isTypingTarget(t) {
  return !!t?.matches?.('input[type=number],input[type=text],input:not([type]),textarea,select,[contenteditable]');
}

// actions:{ [action]: fn };enabled():是否已加载数据且未忙(拖拽中等)。
export function bindShortcuts({ actions, enabled = () => true, target = window }) {
  const onKey = (e) => {
    const a = matchShortcut(e);
    if (!a || !actions[a] || !enabled(a) || isTypingTarget(e.target)) return;
    e.preventDefault();
    if (a !== 'undo') e.target?.blur?.();   // 空格/方向键别再驱动刚点过的按钮或滑块
    actions[a]();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}

// 快捷键提示(HTML):只列该页提供了的动作。
export function shortcutHintHtml(actions, extra = []) {
  const rows = SHORTCUTS.filter((s) => actions[s.action] && (!s.pair || actions[s.pair]))
    .map((s) => `<div><b>${s.keys}</b> ${s.label}</div>`);
  return [...rows, ...extra.map((x) => `<div>${x}</div>`)].join('');
}
