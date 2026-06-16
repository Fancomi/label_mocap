// label/src/edit/ik_controller.js
// 编排两段 IK:末端目标 → 解 → 世界旋转 delta → 局部四元数 → 写回 RotationState。
// 复用现有 forwardSmpl({worldRot})/撤销/保存链路;不直接依赖 three.js。
import { solveTwoBoneIK, shortestArcQuat } from './ik_solver.js';
import { endEffectorChain } from './ik_chains.js';
import { mat3ToQuat, quatConjugate, quatMultiply, quatNormalize } from '../../../smpl_core/rotations.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const j3 = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
const m9 = (arr, i) => arr.slice(i * 9, i * 9 + 9);

export class IKController {
  constructor({ getRotation, getStore, getLastJoints, getLastWorldRot, getSkeleton, onEdit }) {
    this._getRotation = getRotation;
    this._getStore = getStore;
    this._getLastJoints = getLastJoints;
    this._getLastWorldRot = getLastWorldRot;
    this._getSkeleton = getSkeleton || (() => 'smpl');
    this._onEdit = onEdit;
    this._parents = null;
  }

  setParents(parents) { this._parents = parents; }

  // smplJointIdx 是否可 IK 拖动的末端;是则返回其链,否则 null。
  chainFor(smplJointIdx) { return endEffectorChain(this._getSkeleton(), smplJointIdx); }

  // 把末端关节拖到世界点 target,解 IK 并写回肩/肘局部四元数。
  solveTo(chain, target) {
    const rot = this._getRotation();
    const joints = this._getLastJoints();
    const worldRot = this._getLastWorldRot();
    if (!rot || !joints || !worldRot || !this._parents) return;
    const [jRoot, jMid, jEnd] = chain.joints;
    const root = j3(joints, jRoot);
    const mid = j3(joints, jMid);
    const end = j3(joints, jEnd);

    // 自动 pole:传入当前肘点,solver 内部投影到垂直于肩腕轴的分量,保持弯曲平面。
    const out = solveTwoBoneIK({ root, mid, end, target, pole: mid });

    // 上臂段:旧骨向(root→mid)→新骨向(root→out.mid),叠加到肩(jRoot)局部。
    this._applySegment(chain.bodyIdx[0], jRoot, sub(mid, root), sub(out.mid, root), rot, worldRot);
    // 前臂段:旧骨向(mid→end)→新骨向(out.mid→out.end),叠加到肘(jMid)局部。
    this._applySegment(chain.bodyIdx[1], jMid, sub(end, mid), sub(out.end, out.mid), rot, worldRot);

    this._getStore().applyFields(rot.toAxisAngle());
    this._onEdit();
  }

  _applySegment(bodyIdx, smplJointIdx, oldBone, newBone, rot, worldRot) {
    const qDeltaWorld = shortestArcQuat(oldBone, newBone);
    const parentQ = this._parentWorldQuat(smplJointIdx, worldRot);
    const pInv = quatConjugate(parentQ);
    // 世界 delta 投到该关节局部空间:q_local_new = (P⁻¹·ΔW·P)·q_local_old
    const qDeltaLocal = quatNormalize(quatMultiply(pInv, quatMultiply(qDeltaWorld, parentQ)));
    const qOld = rot.getJointQuat(bodyIdx);
    rot.setJointQuat(bodyIdx, quatNormalize(quatMultiply(qDeltaLocal, qOld)));
  }

  // 关节 smplJointIdx 的父关节世界旋转四元数。worldRot[j] 是关节 j 自身世界旋转;
  // 父世界旋转取 worldRot[parents[j]]。根的父(-1)用单位四元数。
  _parentWorldQuat(smplJointIdx, worldRot) {
    const p = this._parents[smplJointIdx];
    if (p == null || p < 0) return [0, 0, 0, 1];
    return mat3ToQuat(m9(worldRot, p));
  }
}
