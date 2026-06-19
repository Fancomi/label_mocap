import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeXYZ } from '../src/scene/point_cloud_decode.js';

function rgbaFrame(encs) {
  const out = new Uint8ClampedArray(3 * 4);
  encs.forEach((e, i) => {
    out[i * 4 + 0] = (e >> 16) & 0xff;
    out[i * 4 + 1] = (e >> 8) & 0xff;
    out[i * 4 + 2] = e & 0xff;
    out[i * 4 + 3] = 255;
  });
  return out;
}

test('decodeXYZ decodes one valid point', () => {
  const encX = Math.round((1.0 + 256) * 1000);
  const encY = Math.round((-2.0 + 256) * 1000);
  const encZ = Math.round((0.5 + 256) * 1000);
  const px = rgbaFrame([encX, encY, encZ]);
  const r = decodeXYZ(px, { pointWidth: 1, pointHeight: 1, scale: 1000, center: 256, channels: 4 });
  assert.equal(r.count, 1);
  assert.ok(Math.abs(r.positions[0] - 1.0) < 1e-3);
  assert.ok(Math.abs(r.positions[1] - (-2.0)) < 1e-3);
  assert.ok(Math.abs(r.positions[2] - 0.5) < 1e-3);
});

test('decodeXYZ skips points whose encoded value is 0 in any band', () => {
  const px = rgbaFrame([0, 0, 0]);
  const r = decodeXYZ(px, { pointWidth: 1, pointHeight: 1, scale: 1000, center: 256, channels: 4 });
  assert.equal(r.count, 0);
  assert.equal(r.positions.length, 0);
});
