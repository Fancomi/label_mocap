// smpl_edit/rotation_state.js
import {
  axisAngleToQuat, quatToAxisAngle,
  eulerXYZToQuat, quatToEulerXYZ,
} from '../smpl_core/rotations.js';

const SMPL_JOINTS = 21;

export class RotationState {
  constructor(rootQ, jointQ) {
    this._rootQ = rootQ;
    this._jointQ = jointQ;            // length 21, each [x,y,z,w]
    this._draftEuler = new Map();     // index (-1=root) -> [rx,ry,rz]
  }

  // body_pose 缺省(如 MHR:身体姿态不以每关节轴角存储)→ 只管整体朝向,jointCount = 0。
  static fromAxisAngle({ root_rota, body_pose }) {
    const rootQ = axisAngleToQuat(root_rota);
    const jointQ = [];
    const n = Array.isArray(body_pose) ? SMPL_JOINTS : 0;
    for (let j = 0; j < n; j++) {
      const k = j * 3;
      jointQ.push(axisAngleToQuat([body_pose[k], body_pose[k + 1], body_pose[k + 2]]));
    }
    return new RotationState(rootQ, jointQ);
  }

  get jointCount() { return this._jointQ.length; }

  getJointQuat(j) { return this._jointQ[j]; }
  getRootQuat() { return this._rootQ; }

  setJointQuat(j, q) { this._jointQ[j] = q; this._invalidateExcept(j); }
  setRootQuat(q) { this._rootQ = q; this._invalidateExcept(-1); }

  getJointEuler(j) {
    if (this._draftEuler.has(j)) return this._draftEuler.get(j);
    return quatToEulerXYZ(this._jointQ[j]);
  }
  getRootEuler() {
    if (this._draftEuler.has(-1)) return this._draftEuler.get(-1);
    return quatToEulerXYZ(this._rootQ);
  }

  setJointEuler(j, e) {
    this._jointQ[j] = eulerXYZToQuat(e);
    this._invalidateExcept(j);
    this._draftEuler.set(j, e.slice());
  }
  setRootEuler(e) {
    this._rootQ = eulerXYZToQuat(e);
    this._invalidateExcept(-1);
    this._draftEuler.set(-1, e.slice());
  }

  _invalidateExcept(keep) {
    for (const key of [...this._draftEuler.keys()]) {
      if (key !== keep) this._draftEuler.delete(key);
    }
  }

  // jointCount = 0 时只返回 root_rota(不写出空 body_pose)。
  toAxisAngle() {
    const root_rota = quatToAxisAngle(this._rootQ);
    const n = this._jointQ.length;
    if (n === 0) return { root_rota };
    const body_pose = new Array(n * 3);
    for (let j = 0; j < n; j++) {
      const aa = quatToAxisAngle(this._jointQ[j]);
      body_pose[j * 3] = aa[0]; body_pose[j * 3 + 1] = aa[1]; body_pose[j * 3 + 2] = aa[2];
    }
    return { root_rota, body_pose };
  }
}
