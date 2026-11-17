// smpl_edit/pose_gizmo.js
import { TransformHandle } from './transform_handle.js';
import { worldGizmoFromLocal, localFromWorldGizmo, incrementalTarget } from './gizmo_frame.js';

// Per-joint rotation gizmo. Displays at the joint's WORLD orientation and maps
// drags back to the joint LOCAL quaternion using the parent world rotation, so
// the on-screen rings align with what the user sees and edits don't jump.
// 世界轴/自身轴只改 TC 的显示与拖拽轴:代理始终持有关节世界朝向,映射回局部的公式两种参考系下相同。
export class PoseGizmo extends TransformHandle {
  // onLimit(hit):拖拽中是否被关节限位/可动轴挡住(状态变化时回调),宿主据此提示。
  constructor({ scene, camera, canvas, getRotation, getStore, onEdit, space, onLimit }) {
    super({ scene, camera, canvas, mode: 'rotate', space });
    this._onLimit = onLimit;
    this._atLimit = false;
    this._getRotation = getRotation;
    this._getStore = getStore;
    this._onEdit = onEdit;
    this._jointBody = null;       // body-pose index (0..20)
    this._qParentWorld = [0, 0, 0, 1];
    this._tc.addEventListener('dragging-changed', (e) => {
      this._prevTarget = null;   // 每次拖拽从头累计
      if (e.value) this._getStore().beginEdit();
      else { this._getStore().commitEdit(); this._setAtLimit(false); }
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
    const qTarget = localFromWorldGizmo(this._qParentWorld, [q.x, q.y, q.z, q.w]);
    const rot = this._getRotation();
    // 增量求解:TC 给的是「按下时朝向 + 累计转角」的绝对目标。被限位挡住后若仍按绝对目标求解,
    // 累计转角一旦超过限位 180°,最短旋转换向,关节会在两端之间来回跳(观感像万向节死锁)。
    // 改为把这一步的增量作用到关节「实际」朝向上:挡住时每步都只是贴着限位,往回拖立即离开限位。
    // 精确执行的姿态状态(SMPL)下 实际 = 上一步目标,结果与绝对求解完全相同。
    const qLocal = incrementalTarget(this._prevTarget, qTarget, rot.getJointQuat(this._jointBody));
    this._prevTarget = qTarget;
    rot.setJointQuat(this._jointBody, qLocal);
    // 姿态状态可能没完全照做(MHR:限位 / 只有部分轴可动)。手柄回到关节实际朝向 ——
    // 到了限位就「转不下去」,往回拖立即生效(TC 每步都从按下时的朝向 + 累计角度重算,回写不影响后续拖拽)。
    const actual = rot.getJointQuat(this._jointBody);
    const d = Math.abs(qLocal[0] * actual[0] + qLocal[1] * actual[1] + qLocal[2] * actual[2] + qLocal[3] * actual[3]);
    this._setAtLimit(2 * Math.acos(Math.min(1, d)) > 0.5 * Math.PI / 180);
    this.setOrientation(worldGizmoFromLocal(this._qParentWorld, actual));
    this._getStore().applyFields(rot.toAxisAngle());
    this._onEdit();
  }

  _setAtLimit(v) {
    if (v === this._atLimit) return;
    this._atLimit = v;
    this._onLimit?.(v);
  }
}
