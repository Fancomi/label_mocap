import { axisAngleToMat3, mat4FromRt, mat4Mul, transformPoint } from './math3d.js';

function vertexCount(model) {
  return model.v_templateShape[0];
}

function jointCount(model) {
  return model.J_regressorShape[0];
}

export function buildPoseRotations(frame, joints) {
  const out = new Array(joints);
  out[0] = axisAngleToMat3(frame.root_rota);

  for (let j = 1; j < joints; j++) {
    const k = (j - 1) * 3;
    const src = k + 2 < frame.body_pose.length
      ? [frame.body_pose[k], frame.body_pose[k + 1], frame.body_pose[k + 2]]
      : [0, 0, 0];
    out[j] = axisAngleToMat3(src);
  }

  return out;
}

export function blendShape(model, betas) {
  const verts = vertexCount(model);
  const betaCount = model.shapedirsShape[2];
  const out = new Float32Array(model.v_template);

  for (let v = 0; v < verts; v++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let b = 0; b < betaCount; b++) {
        sum += (betas[b] ?? 0) * model.shapedirs[(v * 3 + c) * betaCount + b];
      }
      out[v * 3 + c] += sum;
    }
  }

  return out;
}

export function regressJoints(model, vertices) {
  const joints = jointCount(model);
  const verts = vertexCount(model);
  const out = new Float32Array(joints * 3);

  for (let j = 0; j < joints; j++) {
    for (let v = 0; v < verts; v++) {
      const w = model.J_regressor[j * verts + v];
      out[j * 3 + 0] += w * vertices[v * 3 + 0];
      out[j * 3 + 1] += w * vertices[v * 3 + 1];
      out[j * 3 + 2] += w * vertices[v * 3 + 2];
    }
  }

  return out;
}

function buildPoseOffsets(model, rot, verts) {
  const poseRows = model.posedirsShape[0];
  const vertexCols = model.posedirsShape[1];
  const feature = new Float32Array(Math.min(poseRows, Math.max(0, (rot.length - 1) * 9)));
  const identity = [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ];

  for (let j = 1; j < rot.length; j++) {
    const dst = (j - 1) * 9;
    if (dst >= feature.length) {
      break;
    }
    for (let k = 0; k < 9 && dst + k < feature.length; k++) {
      feature[dst + k] = rot[j][k] - identity[k];
    }
  }

  const out = new Float32Array(verts * 3);
  for (let p = 0; p < feature.length; p++) {
    const f = feature[p];
    if (f === 0) {
      continue;
    }
    const row = p * vertexCols;
    for (let c = 0; c < out.length && c < vertexCols; c++) {
      out[c] += f * model.posedirs[row + c];
    }
  }

  return out;
}

function transformVector(m, p) {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  return new Float32Array([
    m[0] * x + m[1] * y + m[2] * z,
    m[4] * x + m[5] * y + m[6] * z,
    m[8] * x + m[9] * y + m[10] * z
  ]);
}

export function forwardSmpl(model, frame, options = {}) {
  const verts = vertexCount(model);
  const jointsN = jointCount(model);
  const vShaped = blendShape(model, frame.betas);
  const joints = regressJoints(model, vShaped);
  const rot = buildPoseRotations(frame, jointsN);
  const poseOffsets = buildPoseOffsets(model, rot, verts);
  const vPosed = new Float32Array(vShaped);
  for (let i = 0; i < vPosed.length; i++) {
    vPosed[i] += poseOffsets[i];
  }
  const transforms = new Array(jointsN);
  const relTransforms = new Array(jointsN);

  for (let j = 0; j < jointsN; j++) {
    const parent = model.parents[j];
    const rel = [
      joints[j * 3 + 0] - (parent >= 0 ? joints[parent * 3 + 0] : 0),
      joints[j * 3 + 1] - (parent >= 0 ? joints[parent * 3 + 1] : 0),
      joints[j * 3 + 2] - (parent >= 0 ? joints[parent * 3 + 2] : 0),
    ];
    const local = mat4FromRt(rot[j], rel);
    transforms[j] = parent >= 0 ? mat4Mul(transforms[parent], local) : local;

    const jp = transformVector(transforms[j], [
      joints[j * 3 + 0],
      joints[j * 3 + 1],
      joints[j * 3 + 2],
    ]);
    relTransforms[j] = new Float32Array(transforms[j]);
    relTransforms[j][3] -= jp[0];
    relTransforms[j][7] -= jp[1];
    relTransforms[j][11] -= jp[2];
  }

  const outVerts = new Float32Array(verts * 3);
  const rootOffset = [
    transforms[0][3],
    transforms[0][7],
    transforms[0][11],
  ];
  for (let v = 0; v < verts; v++) {
    const p = [vPosed[v * 3], vPosed[v * 3 + 1], vPosed[v * 3 + 2]];
    let x = 0;
    let y = 0;
    let z = 0;

    for (let j = 0; j < jointsN; j++) {
      const w = model.weights[v * jointsN + j];
      if (w === 0) {
        continue;
      }
      const q = transformPoint(relTransforms[j], p);
      x += w * q[0];
      y += w * q[1];
      z += w * q[2];
    }

    outVerts[v * 3 + 0] = x - rootOffset[0] + frame.root_pos[0];
    outVerts[v * 3 + 1] = y - rootOffset[1] + frame.root_pos[1];
    outVerts[v * 3 + 2] = z - rootOffset[2] + frame.root_pos[2];
  }

  const outJoints = new Float32Array(jointsN * 3);
  for (let j = 0; j < jointsN; j++) {
    outJoints[j * 3 + 0] = transforms[j][3] - rootOffset[0] + frame.root_pos[0];
    outJoints[j * 3 + 1] = transforms[j][7] - rootOffset[1] + frame.root_pos[1];
    outJoints[j * 3 + 2] = transforms[j][11] - rootOffset[2] + frame.root_pos[2];
  }

  let worldRot;
  if (options.worldRot) {
    worldRot = new Float32Array(jointsN * 9);
    for (let j = 0; j < jointsN; j++) {
      const T = transforms[j];
      const o = j * 9;
      worldRot[o + 0] = T[0]; worldRot[o + 1] = T[1]; worldRot[o + 2] = T[2];
      worldRot[o + 3] = T[4]; worldRot[o + 4] = T[5]; worldRot[o + 5] = T[6];
      worldRot[o + 6] = T[8]; worldRot[o + 7] = T[9]; worldRot[o + 8] = T[10];
    }
  }
  return options.worldRot ? { vertices: outVerts, joints: outJoints, worldRot } : { vertices: outVerts, joints: outJoints };
}
