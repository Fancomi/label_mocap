// Head-point IK uses the spine and neck to move a fixed-length skeleton.
// Trial poses only evaluate joints. A drag always solves from the same pose.
import { mhrFieldsToModelParams } from '../smpl_core/body_model.js';
import { mhrJointParams, mhrSkeleton, MHR_ROOT_JOINT } from '../smpl_core/mhr.js';
import { mhrPoseChannels, MHR_POSE_OFFSET } from '../smpl_core/mhr_pose.js';
import {
  axisAngleToQuat, mat3ToQuat, quatMultiply, quatToAxisAngle, quatToMat3,
} from '../smpl_core/rotations.js';

const AXES = [0, 1, 2];
const TOLERANCE_M = 0.001;
const DERIVATIVE_STEP_RAD = 0.001;
const DAMPING = 0.018;
const MAX_STEP_RAD = 0.26;
const MAX_STEPS = 14;
const INFINITE_LIMITS = [-Infinity, Infinity];
const norm = (v) => Math.hypot(...v);
const sub = (a, b) => AXES.map(i => a[i] - b[i]);
const joint = (joints, index) => AXES.map(i => joints[index * 3 + i]);
const clamp = (value, [min, max]) => Math.max(min, Math.min(max, value));

function rotate(matrix, vector, transpose = false) {
  return AXES.map(row => AXES.reduce(
    (sum, column) => sum + matrix[transpose ? column * 3 + row : row * 3 + column] * vector[column],
    0,
  ));
}

function smplAdapter(chain, joints, worldRot, parents, rotation, fields) {
  const pivots = chain.joints.slice(0, -1);
  const slots = chain.bodyIdx.slice(0, -1);
  const origin = joint(joints, pivots[0]);
  const parent = parents[pivots[0]];
  const fixedParent = mat3ToQuat(worldRot.slice(parent * 9, parent * 9 + 9));
  const local = slots.map(index => rotation.getJointQuat(index).slice());
  const offsets = pivots.map((pivot, i) => rotate(
    worldRot.slice(pivot * 9, pivot * 9 + 9),
    sub(joint(joints, chain.joints[i + 1]), joint(joints, pivot)),
    true,
  ));
  const original = (fields.body_pose ?? rotation.toAxisAngle().body_pose).slice();
  const start = pivots.flatMap(() => [0, 0, 0]);
  const quaternions = values => local.map((q, i) => quatMultiply(q, axisAngleToQuat(values.slice(i * 3, i * 3 + 3))));
  return {
    start,
    limits: start.map(() => INFINITE_LIMITS),
    evaluate(values) {
      let position = origin.slice(), world = fixedParent;
      quaternions(values).forEach((localRotation, i) => {
        world = quatMultiply(world, localRotation);
        const step = rotate(quatToMat3(world), offsets[i]);
        position = AXES.map(axis => position[axis] + step[axis]);
      });
      return position;
    },
    apply(values) {
      const body_pose = original.slice();
      quaternions(values).forEach((q, i) => {
        rotation.setJointQuat(slots[i], q);
        body_pose.splice(slots[i] * 3, 3, ...quatToAxisAngle(q));
      });
      return { body_pose };
    },
  };
}

function mhrAdapter(chain, rotation, fields) {
  const model = chain.model;
  const pose = rotation.toAxisAngle();
  const original = pose.mhr_pose;
  const controlled = new Map();
  chain.joints.slice(0, -1).forEach((pivot, i) => {
    const ranges = new Map(rotation.channelRanges(chain.bodyIdx[i]).map(({ ch, range }) => [ch, range]));
    for (const { ch, param } of mhrPoseChannels(model, pivot)) {
      controlled.set(param, ranges.get(ch) ?? INFINITE_LIMITS);
    }
  });
  const params = [...controlled.keys()];
  const start = params.map(param => original[param - MHR_POSE_OFFSET]);
  const limits = start.map((value, i) => {
    const [lo, hi] = controlled.get(params[i]);
    return [Math.min(lo, value), Math.max(hi, value)];
  });
  const base = mhrJointParams(model, mhrFieldsToModelParams({ ...fields, ...pose }));
  const changes = params.map(() => []);
  const column = new Map(params.map((param, i) => [param, i]));
  model.pt_col.forEach((param, k) => {
    const index = column.get(param);
    if (index !== undefined) changes[index].push([model.pt_row[k], model.pt_val[k]]);
  });
  const head = chain.joints.at(-1);
  const origin = fields.root_pos.slice();
  return {
    start,
    limits,
    evaluate(values) {
      const parameters = base.slice();
      changes.forEach((terms, i) => {
        const delta = values[i] - start[i];
        for (const [row, coefficient] of terms) parameters[row] += coefficient * delta;
      });
      const skel = mhrSkeleton(model, parameters);
      return AXES.map(axis => origin[axis] + (skel.t[head * 3 + axis] - skel.t[MHR_ROOT_JOINT * 3 + axis]) / 100);
    },
    apply(values) {
      const mhr_pose = original.slice();
      params.forEach((param, i) => { mhr_pose[param - MHR_POSE_OFFSET] = values[i]; });
      rotation.setPoseParams(mhr_pose);
      return { mhr_pose };
    },
  };
}

export function beginHeadIK(chain, joints, worldRot, parents, rotation, fields) {
  if (!rotation || !fields) return null;
  return chain.model
    ? mhrAdapter(chain, rotation, fields)
    : smplAdapter(chain, joints, worldRot, parents, rotation, fields);
}

// Solve (J J^T + damping^2 I) in task space, then map back through J^T.
function dampedStep(columns, residual) {
  const system = AXES.map(row => [
    ...AXES.map(column => columns.reduce(
      (sum, derivative) => sum + derivative[row] * derivative[column],
      row === column ? DAMPING * DAMPING : 0,
    )),
    residual[row],
  ]);
  for (const axis of AXES) {
    for (const row of AXES.slice(axis + 1)) {
      const scale = system[row][axis] / system[axis][axis];
      for (let column = axis; column <= 3; column++) system[row][column] -= scale * system[axis][column];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let remainder = system[i][3];
    for (let j = i + 1; j < 3; j++) remainder -= system[i][j] * x[j];
    x[i] = remainder / system[i][i];
  }
  return columns.map(column => AXES.reduce((sum, axis) => sum + column[axis] * x[axis], 0));
}

function jacobian(state, values) {
  return values.map((value, i) => {
    const low = clamp(value - DERIVATIVE_STEP_RAD, state.limits[i]);
    const high = clamp(value + DERIVATIVE_STEP_RAD, state.limits[i]);
    if (high === low) return [0, 0, 0];
    const trial = values.slice();
    trial[i] = low;
    const left = state.evaluate(trial);
    trial[i] = high;
    const right = state.evaluate(trial);
    return sub(right, left).map(delta => delta / (high - low));
  });
}

export function solveHeadIK(state, target) {
  if (!target.every(Number.isFinite)) return null;
  let values = state.start.slice();
  let residual = sub(target, state.evaluate(values));
  for (let i = 0; i < MAX_STEPS && norm(residual) > TOLERANCE_M; i++) {
    const step = dampedStep(jacobian(state, values), residual);
    const magnitude = norm(step);
    if (!Number.isFinite(magnitude) || magnitude < 1e-7) break;
    const cap = Math.min(1, MAX_STEP_RAD / magnitude);
    let improved = false;
    for (const amount of [1, 0.5, 0.25, 0.125]) {
      const trial = values.map((value, j) => clamp(value + cap * amount * step[j], state.limits[j]));
      const error = sub(target, state.evaluate(trial));
      if (norm(error) >= norm(residual) - 1e-7) continue;
      values = trial;
      residual = error;
      improved = true;
      break;
    }
    if (!improved) break;
  }
  return state.apply(values);
}
