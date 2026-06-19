// label/src/edit/gizmo_frame.js
// Map between a joint's LOCAL quaternion and the WORLD quaternion a gizmo shows.
// SMPL: a joint's world rotation = Wparent · Rlocal. So:
//   gizmo world quat  = qParentWorld * qLocal
//   qLocal            = qParentWorld⁻¹ * gizmo world quat
import { quatMultiply, quatConjugate, quatNormalize } from '../smpl_core/rotations.js';

export function worldGizmoFromLocal(qParentWorld, qLocal) {
  return quatNormalize(quatMultiply(qParentWorld, qLocal));
}

export function localFromWorldGizmo(qParentWorld, qWorld) {
  return quatNormalize(quatMultiply(quatConjugate(qParentWorld), qWorld));
}
