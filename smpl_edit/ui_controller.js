// label/src/ui/ui_controller.js
// One edit mode active at a time. Modes: 'pose' | 'root' | 'bbox' | 'beta'.
// readOnly collapses to 'view' (no interaction, no selection).
const MODES = ['pose', 'root', 'bbox', 'beta'];

export class UIController {
  constructor({ readOnly = false } = {}) {
    this._readOnly = readOnly;
    this._mode = readOnly ? 'view' : 'pose';
    this._joint = null;
    this._listeners = new Set();
  }

  get mode() { return this._mode; }
  get selectedJoint() { return this._joint; }
  get readOnly() { return this._readOnly; }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _notify() { for (const fn of this._listeners) fn(); }

  setReadOnly(v) {
    this._readOnly = v;
    if (v) { this._mode = 'view'; this._joint = null; }
    else if (this._mode === 'view') { this._mode = 'pose'; }
    this._notify();
  }

  setMode(mode) {
    if (this._readOnly) return;
    if (!MODES.includes(mode)) return;
    this._mode = mode;
    if (mode !== 'pose') this._joint = null;
    this._notify();
  }

  selectJoint(index) {
    if (this._readOnly) return;
    this._joint = index;
    this._mode = 'pose';
    this._notify();
  }

  clearSelection() { this._joint = null; this._notify(); }

  isInteractionActive(mode) { return !this._readOnly && this._mode === mode; }
}
