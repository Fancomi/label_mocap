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

function onceMessage(worker) {
  return Promise.race([
    once(worker, 'message').then(([msg]) => msg),
    once(worker, 'error').then(([err]) => {
      throw err;
    })
  ]);
}

test('worker initializes a tiny model and forwards one frame', async () => {
  const worker = createWorker();
  try {
    worker.postMessage({ type: 'init', model: tinyModel() });
    assert.equal((await onceMessage(worker)).type, 'ready');

    worker.postMessage({
      type: 'frame',
      requestId: 1,
      frame: { root_rota: [0,0,0], root_pos: [1,2,3], body_pose: [], betas: [0] }
    });

    const msg = await onceMessage(worker);
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

    const msg = await onceMessage(worker);
    assert.equal(msg.type, 'error');
    assert.equal(msg.requestId, 2);
    assert.match(msg.message, /not initialized/);
  } finally {
    await worker.terminate();
  }
});

test('worker reports frame errors and continues processing frames', async () => {
  const worker = createWorker();
  try {
    worker.postMessage({ type: 'init', model: tinyModel() });
    assert.equal((await onceMessage(worker)).type, 'ready');

    worker.postMessage({
      type: 'frame',
      requestId: 3,
      frame: { root_pos: [1,2,3], body_pose: [], betas: [0] }
    });

    const errorMsg = await onceMessage(worker);
    assert.equal(errorMsg.type, 'error');
    assert.equal(errorMsg.requestId, 3);
    assert.match(errorMsg.message, /root_rota|undefined|Cannot/);

    worker.postMessage({
      type: 'frame',
      requestId: 4,
      frame: { root_rota: [0,0,0], root_pos: [1,2,3], body_pose: [], betas: [0] }
    });

    const frameMsg = await onceMessage(worker);
    assert.equal(frameMsg.type, 'frameResult');
    assert.equal(frameMsg.requestId, 4);
    assert.deepEqual(Array.from(new Float32Array(frameMsg.vertices)), [1,2,3, 2,2,3]);
  } finally {
    await worker.terminate();
  }
});
