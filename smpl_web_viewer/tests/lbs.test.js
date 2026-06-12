import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPoseRotations, blendShape, forwardSmpl, regressJoints } from '../../smpl_core/lbs.js';

function assertCloseArray(actual, expected, epsilon = 1e-6) {
  const got = Array.from(actual);
  assert.equal(got.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      Math.abs(got[i] - expected[i]) <= epsilon,
      `index ${i}: expected ${expected[i]}, got ${got[i]}`
    );
  }
}

function tinyModel() {
  return {
    v_template: new Float32Array([0,0,0, 1,0,0]),
    v_templateShape: [2,3],
    shapedirs: new Float32Array(2 * 3 * 1),
    shapedirsShape: [2,3,1],
    posedirs: new Float32Array(9 * 2 * 3),
    posedirsShape: [9,6],
    J_regressor: new Float32Array([1,0]),
    J_regressorShape: [1,2],
    weights: new Float32Array([1, 1]),
    weightsShape: [2,1],
    parents: new Int32Array([-1]),
    faces: new Int32Array([0,1,0])
  };
}

test('forwardSmpl applies root translation to verts and joints', () => {
  const out = forwardSmpl(tinyModel(), {
    root_rota: [0,0,0],
    root_pos: [10,20,30],
    body_pose: [],
    betas: [0]
  });
  assert.deepEqual(Array.from(out.joints), [10,20,30]);
  assert.deepEqual(Array.from(out.vertices), [10,20,30, 11,20,30]);
});

test('blendShape applies beta offsets in [V,3,B] order', () => {
  const model = {
    v_template: new Float32Array([0, 0, 0]),
    v_templateShape: [1, 3],
    shapedirs: new Float32Array([1, 2, 3, 4, 5, 6]),
    shapedirsShape: [1, 3, 2]
  };

  assert.deepEqual(Array.from(blendShape(model, [10, 100])), [210, 430, 650]);
});

test('regressJoints applies [J,V] regressor rows to vertices', () => {
  const model = {
    v_templateShape: [2, 3],
    J_regressor: new Float32Array([0.25, 0.75]),
    J_regressorShape: [1, 2]
  };

  assert.deepEqual(Array.from(regressJoints(model, new Float32Array([0,0,0, 10,0,0]))), [7.5, 0, 0]);
});

test('buildPoseRotations chunks body pose and pads missing joints with identity', () => {
  const rots = buildPoseRotations({
    root_rota: [0, 0, 0],
    body_pose: [0, 0, Math.PI / 2]
  }, 3);

  assertCloseArray(rots[0], [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ]);
  assertCloseArray(rots[1], [
    0, -1, 0,
    1, 0, 0,
    0, 0, 1
  ]);
  assertCloseArray(rots[2], [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ]);
});

test('forwardSmpl centers vertices so root joint lands on root_pos', () => {
  const model = tinyModel();
  model.J_regressor = new Float32Array([0, 1]);

  const out = forwardSmpl(model, {
    root_rota: [0,0,0],
    root_pos: [0,0,0],
    body_pose: [],
    betas: [0]
  });

  assert.deepEqual(Array.from(out.joints), [0,0,0]);
  assert.deepEqual(Array.from(out.vertices), [-1,0,0, 0,0,0]);
});

test('forwardSmpl applies pose blend offsets from child rotations before skinning', () => {
  const posedirs = new Float32Array(9 * 3);
  posedirs[3 * 3 + 0] = 2;
  const model = {
    v_template: new Float32Array([0,0,0]),
    v_templateShape: [1,3],
    shapedirs: new Float32Array(1 * 3 * 1),
    shapedirsShape: [1,3,1],
    posedirs,
    posedirsShape: [9,3],
    J_regressor: new Float32Array([1, 1]),
    J_regressorShape: [2,1],
    weights: new Float32Array([1, 0]),
    weightsShape: [1,2],
    parents: new Int32Array([-1, 0]),
    faces: new Int32Array([0,0,0])
  };

  const out = forwardSmpl(model, {
    root_rota: [0,0,0],
    root_pos: [0,0,0],
    body_pose: [0, 0, Math.PI / 2],
    betas: [0]
  });

  assertCloseArray(out.vertices, [2,0,0]);
});

test('forwardSmpl skins vertices with root rotation', () => {
  const out = forwardSmpl(tinyModel(), {
    root_rota: [0,0,Math.PI / 2],
    root_pos: [0,0,0],
    body_pose: [],
    betas: [0]
  });

  assertCloseArray(out.vertices, [0,0,0, 0,1,0]);
});
