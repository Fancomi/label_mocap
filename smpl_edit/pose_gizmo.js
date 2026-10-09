// smpl_edit/pose_gizmo.js
import { TransformHandle } from './transform_handle.js';
import { worldGizmoFromLocal, localFromWorldGizmo } from './gizmo_frame.js';

// Per-joint rotation gizmo. Displays at the joint's WORLD orientation and maps
// drags back to the joint LOCAL quaternion using the parent world rotation, so
// the on-screen rings align with what the user sees and edits don't jump.
// 世界轴/自身轴只改 TC 的显示与拖拽轴:代理始终持有关节世界朝向,映射回局部的公式两种参考系下相同。
export class PoseGizmo extends TransformHandle {
  constructor({ scene, camera, canvas, getRotation, getStore, onEdit, space }) {
    super({ scene, camera, canvas, mode: 'rotate', space });
    this._getRotation = getRotation;
    this._getStore = getStore;
    this._onEdit = onEdit;
    this._jointBody = null;       // body-pose index (0..20)
    this._qParentWorld = [0, 0, 0, 1];
    this._tc.addEventListener('dragging-changed', (e) => {
      if (e.value) this._getStore().beginEdit();
      else this._getStore().commitEdit();
    });
    this._tc.addEventListener('objectChange', () => this._onDrag());
  }

  // qParentWorld: [x,y,z,w] parent joint world rotation. worldPos: [x,y,z].
  attach(jointBody, worldPos, qParentWorld) {
    this._jointBody = jointBody;
    this._qParentWorld = qParentWorld;
    this._proxy.position.set(worldPos[0], worldPos[1], worldPos[2]);
    this.syncOrientation();
    this._mount();
    this._setTcActive(true);
  }

  // 数值面板/撤销等外部改动关节后让代理朝向跟上(自身轴与下次拖拽起点都依赖它);拖拽中不动。
  syncFromState() {
    if (this._jointBody === null || this.isDragging()) return;
    this.syncOrientation();
  }

  syncOrientation() {
    const qLocal = this._getRotation().getJointQuat(this._jointBody);
    this.setOrientation(worldGizmoFromLocal(this._qParentWorld, qLocal));
  }

  detach() {
    this._jointBody = null;
    if (!this._mounted) return;
    this._setTcActive(false);
    this._unmount();
  }

  _onDrag() {
    if (this._jointBody === null) return;
    const q = this._proxy.quaternion;
    const qLocal = localFromWorldGizmo(this._qParentWorld, [q.x, q.y, q.z, q.w]);
    this._getRotation().setJointQuat(this._jointBody, qLocal);
    this._getStore().applyFields(this._getRotation().toAxisAngle());
    this._onEdit();
  }
}
