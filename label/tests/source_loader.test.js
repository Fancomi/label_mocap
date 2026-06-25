import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertHasContent, isPortrait } from '../src/io/source_loader.js';

test('有背景无数据 → 通过校验', () => {
  assert.doesNotThrow(() => assertHasContent({ bgCount: 2, dataFrameIndices: [] }));
});

test('有数据无背景 → 通过校验', () => {
  assert.doesNotThrow(() => assertHasContent({ bgCount: 0, dataFrameIndices: [0, 2] }));
});

test('既无背景也无数据 → 抛错', () => {
  assert.throws(() => assertHasContent({ bgCount: 0, dataFrameIndices: [] }), /无可标注内容/);
});

test('含 manifest.json → 劝退到点云标注器(即便有背景/png 帧也优先拦)', () => {
  // 有背景也照样劝退:点云的 png 帧会被当图像识别,但有 manifest 即判定为点云序列
  assert.throws(
    () => assertHasContent({ bgCount: 176, dataFrameIndices: [], hint: { hasManifest: true } }),
    /点云/,
  );
  assert.throws(
    () => assertHasContent({ bgCount: 0, dataFrameIndices: [], hint: { hasManifest: true } }),
    /点云/,
  );
});

test('isPortrait true when image height > width', () => {
  assert.equal(isPortrait({ width: 1080, height: 1920 }), true);
  assert.equal(isPortrait({ width: 1920, height: 1080 }), false);
});
