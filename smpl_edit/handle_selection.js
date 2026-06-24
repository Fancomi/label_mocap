// smpl_edit/handle_selection.js
// 极向量/末端柄的「单活动」选择状态机。纯逻辑,无 DOM / 无 three.js。
// active: 'end' | 'pole';绑定到一条链。换链时重置回 'end';同链跨 sync 保持。
export class HandleSelection {
  constructor() {
    this._active = 'end';
    this._chain = null;
  }

  active() { return this._active; }

  // 点选切换:仅接受 'end' / 'pole',其余忽略。
  select(which) {
    if (which === 'end' || which === 'pole') this._active = which;
  }

  // 绑定当前 IK 肢体链名。换了链 → 重置回 'end';同链 → 保持当前选择。
  bindChain(chainName) {
    if (chainName !== this._chain) {
      this._chain = chainName;
      this._active = 'end';
    }
  }

  // 关 IK / 离开 pose / 无选中:回到初始态。
  reset() {
    this._active = 'end';
    this._chain = null;
  }
}
