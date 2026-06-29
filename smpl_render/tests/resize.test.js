import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeBackingSize, resolveCameraAspect, policiesForMode,
} from '../resize.js';

// ── policiesForMode：模式 → 策略 ────────────────────────────────────────────
test('policiesForMode maps 2d→letterbox/image, 3d→fill/container', () => {
  assert.deepEqual(policiesForMode('2d'), { bufferPolicy: 'letterbox', aspectPolicy: 'image' });
  assert.deepEqual(policiesForMode('3d'), { bufferPolicy: 'fill', aspectPolicy: 'container' });
  // 非 2d 一律按自由处理
  assert.deepEqual(policiesForMode('anything'), { bufferPolicy: 'fill', aspectPolicy: 'container' });
});

// ── computeBackingSize：fill 填满 / letterbox 内接 ──────────────────────────
test('computeBackingSize fill fills the whole container', () => {
  assert.deepEqual(
    computeBackingSize({ containerW: 800, containerH: 600, imageAspect: 16 / 9, bufferPolicy: 'fill' }),
    { cssW: 800, cssH: 600 });
});

test('computeBackingSize letterbox fits height when container is wider than image', () => {
  // 容器 800×600(4:3=1.333) 比图像 16:9(1.778) 窄 → 容器更"高瘦" → 顶宽
  const r = computeBackingSize({ containerW: 800, containerH: 600, imageAspect: 16 / 9, bufferPolicy: 'letterbox' });
  assert.equal(r.cssW, 800);
  assert.equal(r.cssH, Math.round(800 / (16 / 9)));   // 450
});

test('computeBackingSize letterbox fits width when container is taller than image', () => {
  // 容器 400×800(0.5) 比图像 1.0 窄 → 顶宽
  const r = computeBackingSize({ containerW: 400, containerH: 800, imageAspect: 1, bufferPolicy: 'letterbox' });
  assert.equal(r.cssW, 400);
  assert.equal(r.cssH, 400);
});

test('computeBackingSize letterbox fits height when container wider than image aspect', () => {
  // 容器 1600×600(2.667) 比图像 16:9(1.778) 宽 → 顶高
  const r = computeBackingSize({ containerW: 1600, containerH: 600, imageAspect: 16 / 9, bufferPolicy: 'letterbox' });
  assert.equal(r.cssH, 600);
  assert.equal(r.cssW, Math.round(600 * (16 / 9)));   // 1067
});

// ── resolveCameraAspect：image=图像比例 / container=buffer 实际比例 ──────────
test('resolveCameraAspect image returns imageAspect, container returns css ratio', () => {
  assert.equal(resolveCameraAspect({ aspectPolicy: 'image', imageAspect: 16 / 9, cssW: 800, cssH: 450 }), 16 / 9);
  assert.equal(resolveCameraAspect({ aspectPolicy: 'container', imageAspect: 16 / 9, cssW: 800, cssH: 600 }), 800 / 600);
});

// ── letterbox bug 修复锁死：3D 自由 ⇒ 填满 + 容器比例(不再被图像比例钉死) ─────
test('free3d uses fill buffer and container aspect (letterbox bug fixed)', () => {
  const { bufferPolicy, aspectPolicy } = policiesForMode('3d');
  // 竖屏容器 600×900，图像 16:9 → 3D 下 buffer 填满容器、aspect=容器比例(非 16:9)
  const { cssW, cssH } = computeBackingSize({ containerW: 600, containerH: 900, imageAspect: 16 / 9, bufferPolicy });
  assert.deepEqual({ cssW, cssH }, { cssW: 600, cssH: 900 });
  const aspect = resolveCameraAspect({ aspectPolicy, imageAspect: 16 / 9, cssW, cssH });
  assert.equal(aspect, 600 / 900);             // 跟随容器，不被图像比例锁死
  assert.notEqual(aspect, 16 / 9);
});

test('aligned2d keeps image aspect for both buffer and camera', () => {
  const { bufferPolicy, aspectPolicy } = policiesForMode('2d');
  const { cssW, cssH } = computeBackingSize({ containerW: 600, containerH: 900, imageAspect: 16 / 9, bufferPolicy });
  assert.ok(Math.abs(cssW / cssH - 16 / 9) < 0.01);   // letterbox 后 buffer 比例≈图像比例(整数舍入)
  // aspectPolicy='image' 直接返回精确图像比例，不受舍入影响。
  assert.equal(resolveCameraAspect({ aspectPolicy, imageAspect: 16 / 9, cssW, cssH }), 16 / 9);
});
