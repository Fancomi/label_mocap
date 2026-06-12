// label/src/edit/edit_controller.js
export class EditController {
  constructor({ readOnly = false } = {}) {
    this._tool = 'none';
    this._joint = null;
    this._readOnly = readOnly;
    this._listeners = new Set();
  }

  get tool() { return this._tool; }
  get selectedJoint() { return this._joint; }
  get readOnly() { return this._readOnly; }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _notify() { for (const fn of this._listeners) fn(); }

  setReadOnly(v) { this._readOnly = v; if (v) { this._tool = 'none'; this._joint = null; } this._notify(); }

  setTool(tool) {
    if (this._readOnly) return;
    this._tool = tool;
    if (tool !== 'pose') this._joint = null;
    this._notify();
  }

  selectJoint(index) {
    if (this._readOnly) return;
    this._joint = index;
    this._tool = 'pose';
    this._notify();
  }

  clearSelection() { this._joint = null; this._notify(); }
}
