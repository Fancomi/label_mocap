// smpl_edit/root_handle.js — translate/rotate gizmo for the SMPL root.
import { TransformHandle } from './transform_handle.js';

export class RootHandle extends TransformHandle {
  constructor({ scene, camera, canvas, getStore, getRotation, onEdit, space }) {
    super({ scene, camera, canvas, mode: 'translate', space });
    this._getStore = getStore;
    this._getRotation = getRotation;
    this._onEdit = onEdit;
    this._mode = 'translate';

    this._tc.addEventListener('mouseDown', () => this._getStore().beginEdit());
    this._tc.addEventListener('objectChange', () => {
      if (this._mode === 'rotate') {
        const rot = this._getRotation && this._getRotation();
        if (!rot) return;
        const q = this._proxy.quaternion;
        rot.setRootQuat([q.x, q.y, q.z, q.w]);
        this._getStore().applyFields(rot.toAxisAngle());
      } else {
        const p = this._proxy.position;
        this._getStore().applyFields({ root_pos: [p.x, p.y, p.z] });
      }
      this._onEdit();
    });
    this._tc.addEventListener('mouseUp', () => this._getStore().commitEdit());
  }

  setMode(mode) {
    this._mode = (mode === 'rotate') ? 'rotate' : 'translate';
    this._tc.setMode(this._mode);
  }

  // 手柄朝向取根的世界朝向:「自身轴」即人体自己的前/上/右。
  attach(rootPos) {
    this._pull(rootPos);
    this._mount();
    this._setTcActive(true);
  }

  // 数值面板/撤销等外部改动后让代理跟上标注(自身轴下手柄朝向依赖它);拖拽中不动。
  syncFromState() {
    if (!this._mounted || this.isDragging()) return;
    this._pull(this._getStore().current()?.root_pos);
  }

  _pull(rootPos) {
    if (rootPos) this._proxy.position.set(rootPos[0], rootPos[1], rootPos[2]);
    const rot = this._getRotation && this._getRotation();
    this.setOrientation(rot ? rot.getRootQuat() : null);
  }

  detach() {
    if (!this._mounted) return;
    this._setTcActive(false);
    this._unmount();
  }
}
