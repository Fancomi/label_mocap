import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bytesToBase64 } from '../src/io/image_bytes.js';

test('bytesToBase64 encodes a known byte sequence', () => {
  // "Man" => "TWFu"  (classic base64 test vector)
  const bytes = new Uint8Array([0x4d, 0x61, 0x6e]);
  assert.equal(bytesToBase64(bytes), 'TWFu');
});

test('bytesToBase64 handles empty input', () => {
  assert.equal(bytesToBase64(new Uint8Array([])), '');
});

test('bytesToBase64 pads correctly for non-3-multiple length', () => {
  // "M" => "TQ=="
  assert.equal(bytesToBase64(new Uint8Array([0x4d])), 'TQ==');
});
