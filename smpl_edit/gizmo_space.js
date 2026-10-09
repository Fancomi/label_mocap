// smpl_edit/gizmo_space.js
// 手柄参考系的唯一状态源(纯逻辑,无 DOM/three):'world' 沿世界轴,'local' 沿对象自身轴。
// 所有 SMPL 编辑手柄(整体平移/旋转、关节旋转、IK 末端/极向量)订阅同一个实例,切一次全体生效。
export const GIZMO_SPACES = [
  { id: 'world', label: '世界轴', tip: '沿世界 XYZ 轴拖动' },
  { id: 'local', label: '自身轴', tip: '沿对象自身轴拖动(整体/关节/肢端各自的朝向)' },
];

export const normalizeSpace = (s) => (s === 'local' ? 'local' : 'world');

export class GizmoSpace {
  constructor(initial = 'world') {
    this._space = normalizeSpace(initial);
    this._listeners = new Set();
  }

  get() { return this._space; }

  set(space) {
    const next = normalizeSpace(space);
    if (next === this._space) return;
    this._space = next;
    for (const fn of this._listeners) fn(next);
  }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
}
