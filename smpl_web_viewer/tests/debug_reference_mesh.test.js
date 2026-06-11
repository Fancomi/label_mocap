import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadReferenceMesh } from '../src/debug/reference_mesh.js';

test('loadReferenceMesh slices frame vertices from f32 bin', async () => {
  const meta = {
    schema: 'smpl-web-debug-reference-mesh-v1',
    bin: 'mesh.f32.bin',
    frameCount: 2,
    vertexCount: 2,
    itemSize: 3,
    frames: [6, 7],
  };
  const bin = new Float32Array([
    1, 2, 3, 4, 5, 6,
    7, 8, 9, 10, 11, 12,
  ]);

  const ref = await loadReferenceMesh(new URL('https://local/ref/meta.json'), async (url) => {
    if (String(url).endsWith('meta.json')) {
      return new TextEncoder().encode(JSON.stringify(meta));
    }
    return new Uint8Array(bin.buffer);
  });

  assert.deepEqual(ref.frames, [6, 7]);
  assert.deepEqual(Array.from(ref.frameVertices(0)), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Array.from(ref.frameVertices(1)), [7, 8, 9, 10, 11, 12]);
  assert.throws(() => ref.frameVertices(2), /outside reference mesh/);
});
