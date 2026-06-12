import { forwardSmpl } from '../smpl_core/lbs.js';

let model = null;

function sendError(requestId, message) {
  self.postMessage({ type: 'error', requestId, message });
}

self.addEventListener('message', (event) => {
  const msg = event.data;

  if (msg.type === 'init') {
    model = msg.model;
    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'frame') {
    if (!model) {
      sendError(msg.requestId, 'worker not initialized');
      return;
    }

    try {
      const t0 = performance.now();
      const out = forwardSmpl(model, msg.frame);
      self.postMessage({
        type: 'frameResult',
        requestId: msg.requestId,
        ms: performance.now() - t0,
        vertices: out.vertices.buffer,
        joints: out.joints.buffer,
      }, [out.vertices.buffer, out.joints.buffer]);
    } catch (err) {
      sendError(msg.requestId, err instanceof Error ? err.message : String(err));
    }
  }
});
