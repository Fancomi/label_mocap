import { forwardSmpl } from './lbs.js';

let port;

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  port = self;
} else {
  const { parentPort } = await import('node:worker_threads');
  port = {
    postMessage: (msg, transfer) => parentPort.postMessage(msg, transfer),
    addEventListener: (_type, cb) => parentPort.on('message', (data) => cb({ data }))
  };
}

let model = null;

function sendError(requestId, message) {
  port.postMessage({ type: 'error', requestId, message });
}

port.addEventListener('message', (event) => {
  const msg = event.data;

  if (msg.type === 'init') {
    model = msg.model;
    port.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'frame') {
    if (!model) {
      sendError(msg.requestId, 'worker not initialized');
      return;
    }

    const t0 = performance.now();
    const out = forwardSmpl(model, msg.frame);
    port.postMessage({
      type: 'frameResult',
      requestId: msg.requestId,
      ms: performance.now() - t0,
      vertices: out.vertices.buffer,
      joints: out.joints.buffer
    }, [out.vertices.buffer, out.joints.buffer]);
  }
});
