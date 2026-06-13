// label/src/edit/occlusion_raycast.js
import * as THREE from 'three';
// For each of 24 joints, cast a ray from the camera toward the joint world pos;
// if the mesh is hit closer than the joint (minus eps), the joint is occluded (1).
// Returns Array(slots) with 1=occluded, 0=visible. Joints behind camera → 0.
export function computeOcclusion(jointsFlat, meshObject, camera, slots = 52, eps = 0.02) {
  const out = new Array(slots).fill(0);
  const ray = new THREE.Raycaster();
  const camPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  const n = Math.min(24, Math.floor(jointsFlat.length / 3));
  for (let j = 0; j < n; j++) {
    const jp = new THREE.Vector3(jointsFlat[j * 3], jointsFlat[j * 3 + 1], jointsFlat[j * 3 + 2]);
    const dir = jp.clone().sub(camPos);
    const dist = dir.length();
    if (dist < 1e-6) { out[j] = 0; continue; }
    dir.normalize();
    ray.set(camPos, dir);
    const hits = ray.intersectObject(meshObject, false);
    out[j] = (hits.length && hits[0].distance < dist - eps) ? 1 : 0;
  }
  return out;
}
