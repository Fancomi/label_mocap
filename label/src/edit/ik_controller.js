// label/src/edit/ik_controller.js
// 两段 IK 编排:拖拽开始冻结参考姿势,拖拽中从参考「绝对求解」(非增量累积)。
// 据此根治两类伪影:
//  - 反关节:开始时锁定弯曲侧 pole,整段拖拽不翻面;
//  - 拧(绕骨轴扭转):每步都对冻结的参考世界朝向施加单次最短弧,不累积,无 twist 漂移。
// 写回 RotationState 局部四元数,复用 forwardSmpl/撤销/保存链路;不依赖 three.js。
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
    this._ref = null; // 拖拽参考快照(beginDrag 设置,endDrag 清空)
  }

  setParents(parents) { this._parents = parents; }

  // smplJointIdx 是否可 IK 拖动的末端;是则返回其链,否则 null。
  chainFor(smplJointIdx) { return endEffectorChain(this._getSkeleton(), smplJointIdx); }

  // 拖拽开始:冻结参考姿势——三关节世界坐标、肩/肘世界朝向、肩的父系朝向、
  // 以及锁定的弯曲方向。整段拖拽都基于这份参考,不读取拖拽中变化的状态。
  beginDrag(chain) {
    const joints = this._getLastJoints();
    const worldRot = this._getLastWorldRot();
    if (!joints || !worldRot || !this._parents) { this._ref = null; return; }
    const [jRoot, jMid, jEnd] = chain.joints;
    const root = j3(joints, jRoot);
    const mid = j3(joints, jMid);
    const end = j3(joints, jEnd);
    const pShoulder = this._parents[jRoot];
    this._ref = {
      chain,
      root,
      upper0: sub(mid, root),                                  // 参考上臂世界向量
      lower0: sub(end, mid),                                   // 参考前臂世界向量
      poleLock: sub(mid, root),                                // 锁定弯曲侧方向(防翻面)
      midRef: mid,
      endRef: end,
      shoulderWorld0: mat3ToQuat(m9(worldRot, jRoot)),
      elbowWorld0: mat3ToQuat(m9(worldRot, jMid)),
      parentShoulderWorld: pShoulder >= 0 ? mat3ToQuat(m9(worldRot, pShoulder)) : [0, 0, 0, 1],
    };
  }

  endDrag() { this._ref = null; }

  // 拖拽中:把末端拖到世界点 target。从冻结参考绝对求解,写回肩/肘局部四元数。
  // 同一 target 重复调用结果恒定(纯函数 of 参考+target)→ 无累积、无 twist 漂移。
  solveTo(target) {
    const ref = this._ref;
    const rot = this._getRotation();
    if (!ref || !rot) return;

    const { mid: newMid, end: newEnd } = solveTwoBoneIK({
      root: ref.root, mid: ref.midRef, end: ref.endRef, target, pole: ref.poleLock,
    });
    const newUpper = sub(newMid, ref.root);
    const newLower = sub(newEnd, newMid);

    // 对参考世界朝向施加「参考骨向→新骨向」最短弧:方向对齐、参考 twist 保留。
    const shoulderWorldNew = quatNormalize(quatMultiply(shortestArcQuat(ref.upper0, newUpper), ref.shoulderWorld0));
    const elbowWorldNew = quatNormalize(quatMultiply(shortestArcQuat(ref.lower0, newLower), ref.elbowWorld0));

    // 世界朝向 → 局部:肩的父系冻结;肘的父系是(已转动的)肩的新世界朝向。
    const shoulderLocal = quatNormalize(quatMultiply(quatConjugate(ref.parentShoulderWorld), shoulderWorldNew));
    const elbowLocal = quatNormalize(quatMultiply(quatConjugate(shoulderWorldNew), elbowWorldNew));

    rot.setJointQuat(ref.chain.bodyIdx[0], shoulderLocal);
    rot.setJointQuat(ref.chain.bodyIdx[1], elbowLocal);
    this._getStore().applyFields(rot.toAxisAngle());
    this._onEdit();
  }
}
