// smpl_edit/gizmo_frame.js
// Map between a joint's LOCAL quaternion and the WORLD quaternion a gizmo shows.
// SMPL: a joint's world rotation = Wparent · Rlocal. So:
//   gizmo world quat  = qParentWorld * qLocal
//   qLocal            = qParentWorld⁻¹ * gizmo world quat
import { quatMultiply, quatConjugate, quatNormalize, mat3ToQuat } from '../smpl_core/rotations.js';

// forwardSmpl 的扁平 worldRot(每关节 9 个数的行主序 3×3)中取第 j 个关节的世界四元数。
export function jointWorldQuat(worldRot, j) {
  return mat3ToQuat(worldRot.slice(j * 9, j * 9 + 9));
}

export function worldGizmoFromLocal(qParentWorld, qLocal) {
  return quatNormalize(quatMultiply(qParentWorld, qLocal));
}

export function localFromWorldGizmo(qParentWorld, qWorld) {
  return quatNormalize(quatMultiply(quatConjugate(qParentWorld), qWorld));
}
