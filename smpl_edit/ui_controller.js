// smpl_edit/ui_controller.js
// One edit mode active at a time. Modes default to pose/root/bbox/beta; callers
// (e.g. point-cloud annotator) may restrict via the `modes` option.
const DEFAULT_MODES = ['pose', 'root', 'bbox', 'beta'];

export class UIController {
  constructor({ readOnly = false, modes = DEFAULT_MODES } = {}) {
    this._modes = modes;
    this._readOnly = readOnly;
    this._mode = readOnly ? 'view' : modes[0];
    this._joint = null;
    this._released = false;   // 「取消调整」:点到人体以外 → 本模式不挂任何手柄,视角可自由拖动
    this._listeners = new Set();
  }

  get released() { return this._released; }
  // 点空白处:清掉关节选择并收起手柄(整体模式也收起);再点关节/人体/tab 恢复。
  release() { if (this._readOnly) return; this._joint = null; this._released = true; this._notify(); }

  get mode() { return this._mode; }
  get selectedJoint() { return this._joint; }
  get readOnly() { return this._readOnly; }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _notify() { for (const fn of this._listeners) fn(); }

  setReadOnly(v) {
    this._readOnly = v;
    if (v) { this._mode = 'view'; this._joint = null; }
    else if (this._mode === 'view') { this._mode = this._modes[0]; }
    this._notify();
  }

  setMode(mode) {
    if (this._readOnly) return;
    if (!this._modes.includes(mode)) return;
    this._mode = mode;
    this._released = false;
    if (mode !== 'pose') this._joint = null;
    this._notify();
  }

  selectJoint(index) {
    if (this._readOnly) return;
    this._joint = index;
    this._mode = 'pose';
    this._released = false;
    this._notify();
  }

  clearSelection() { this._joint = null; this._notify(); }

  isInteractionActive(mode) { return !this._readOnly && this._mode === mode; }
}
