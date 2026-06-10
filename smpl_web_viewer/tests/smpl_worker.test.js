import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';

function createWorker() {
  return new Worker(new URL('../src/smpl/smpl_worker.js', import.meta.url), { type: 'module' });
}

function tinyModel() {
  return {
    v_template: new Float32Array([0,0,0, 1,0,0]),
    v_templateShape: [2,3],
    shapedirs: new Float32Array(6),
    shapedirsShape: [2,3,1],
    posedirs: new Float32Array(54),
    posedirsShape: [9,6],
    J_regressor: new Float32Array([1,0]),
    J_regressorShape: [1,2],
    weights: new Float32Array([1,1]),
    weightsShape: [2,1],
    parents: new Int32Array([-1]),
    faces: new Int32Array([0,1,0])
  };
}

test('worker initializes a tiny model and forwards one frame', async () => {
  const worker = createWorker();
  try {
    worker.postMessage({ type: 'init', model: tinyModel() });
    assert.equal((await once(worker, 'message'))[0].type, 'ready');

    worker.postMessage({
      type: 'frame',
      requestId: 1,
      frame: { root_rota: [0,0,0], root_pos: [1,2,3], body_pose: [], betas: [0] }
    });

    const msg = (await once(worker, 'message'))[0];
    assert.equal(msg.type, 'frameResult');
    assert.equal(msg.requestId, 1);
    assert.equal(typeof msg.ms, 'number');
    assert.ok(msg.vertices instanceof ArrayBuffer);
    assert.ok(msg.joints instanceof ArrayBuffer);
    assert.deepEqual(Array.from(new Float32Array(msg.vertices)), [1,2,3, 2,2,3]);
    assert.deepEqual(Array.from(new Float32Array(msg.joints)), [1,2,3]);
  } finally {
    await worker.terminate();
  }
});

test('worker returns an error for frame before init', async () => {
  const worker = createWorker();
  try {
    worker.postMessage({
      type: 'frame',
      requestId: 2,
      frame: { root_rota: [0,0,0], root_pos: [1,2,3], body_pose: [], betas: [0] }
    });

    const msg = (await once(worker, 'message'))[0];
    assert.equal(msg.type, 'error');
    assert.equal(msg.requestId, 2);
    assert.match(msg.message, /not initialized/);
  } finally {
    await worker.terminate();
  }
});
