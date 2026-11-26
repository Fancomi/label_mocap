import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMimeType, recordingName, recordingSize, placeRect } from '../recorder.js';

test('pickMimeType prefers mp4, falls back to webm, empty when nothing is supported', () => {
  assert.equal(pickMimeType((m) => m.startsWith('video/webm')), 'video/webm;codecs=vp9');
  assert.equal(pickMimeType(() => true), 'video/mp4;codecs=avc1');
  assert.equal(pickMimeType(() => false), '');
});

test('recordingName stamps local time and picks the extension from the mime type', () => {
  const d = new Date(2026, 10, 26, 9, 5, 7);
  assert.equal(recordingName('label', 'video/mp4;codecs=avc1', d), 'label-20261126-090507.mp4');
  assert.equal(recordingName('mhr_label', 'video/webm;codecs=vp9', d), 'mhr_label-20261126-090507.webm');
});

test('recordingSize rounds to even pixels', () => {
  assert.deepEqual(recordingSize(1001, 561, 1), { w: 1002, h: 562 });
  assert.deepEqual(recordingSize(998, 1000, 2), { w: 1996, h: 2000 });
});

test('placeRect keeps the canvas where it sits in the frame, scaled to the output', () => {
  // 2D 留边:画布在容器中间一条。
  assert.deepEqual(placeRect({ x: 0, y: 219.5, w: 998, h: 561 }, 998, 1000, 1996, 2000), { x: 0, y: 439, w: 1996, h: 1122 });
  // 容器变宽后:按比例缩放并居中。
  const r = placeRect({ x: 0, y: 0, w: 1200, h: 1000 }, 1200, 1000, 1000, 1000);
  assert.ok(Math.abs(r.y - (1000 - 1000 / 1.2) / 2) < 1e-9 && Math.abs(r.w - 1000) < 1e-9);
});
