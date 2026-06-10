import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forwardSmpl } from '../src/smpl/lbs.js';

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
