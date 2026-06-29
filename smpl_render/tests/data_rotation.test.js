import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rotateKn, withDataRotation } from '../data_rotation.js';

const K = { fx: 1850, fy: 1900, cx: 960, cy: 540 };
const W = 1920, H = 1080;

test('rotateKn n=0 is identity', () => {
  assert.deepEqual(rotateKn(K, W, H, 0), { fx: 1850, fy: 1900, cx: 960, cy: 540, w: 1920, h: 1080 });
});

test('rotateKn n=4 returns to original', () => {
  assert.deepEqual(rotateKn(K, W, H, 4), { fx: 1850, fy: 1900, cx: 960, cy: 540, w: 1920, h: 1080 });
});

test('rotateKn n=1 swaps focal and dims, maps principal point', () => {
  // 1×CW: cx→h-cy=1080-540=540, cy→cx=960, fx↔fy, w↔h
  assert.deepEqual(rotateKn(K, W, H, 1), { fx: 1900, fy: 1850, cx: 540, cy: 960, w: 1080, h: 1920 });
});

test('rotateKn n=2 is point-symmetric (dims unchanged, principal mirrored)', () => {
  const r = rotateKn(K, W, H, 2);
  assert.equal(r.w, 1920); assert.equal(r.h, 1080);
  assert.equal(r.fx, 1850); assert.equal(r.fy, 1900);
  assert.equal(r.cx, W - K.cx);   // 960
  assert.equal(r.cy, H - K.cy);   // 540
});

test('rotateKn negative wraps modulo 4', () => {
  assert.deepEqual(rotateKn(K, W, H, -1), rotateKn(K, W, H, 3));
});

test('withDataRotation attaches setDataRotation/getDataRotation and tracks _dataRotN', () => {
  // 用最小桩对象模拟 CameraModes 的相关字段与 setIntrinsics 尾巴。
  const cam = {
    K: { ...K }, imageW: W, imageH: H, _dataRotN: 0,
    setIntrinsics() { this._applied = (this._applied || 0) + 1; },
  };
  withDataRotation(cam);
  assert.equal(cam.getDataRotation(), 0);
  cam.setDataRotation(1);
  assert.equal(cam.getDataRotation(), 1);
  assert.deepEqual({ fx: cam.K.fx, fy: cam.K.fy, cx: cam.K.cx, cy: cam.K.cy, w: cam.imageW, h: cam.imageH },
    { fx: 1900, fy: 1850, cx: 540, cy: 960, w: 1080, h: 1920 });
  // 再转到 3：从当前(1)走 delta=2 步，等价于直接对原始转 3。
  cam.setDataRotation(3);
  assert.deepEqual({ cx: cam.K.cx, cy: cam.K.cy, w: cam.imageW, h: cam.imageH },
    { cx: rotateKn(K, W, H, 3).cx, cy: rotateKn(K, W, H, 3).cy, w: 1080, h: 1920 });
});
