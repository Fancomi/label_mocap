import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerspectiveCamera, Texture, Vector2, Vector3 } from '../../smpl_web_viewer/public/vendor/three.module.js';
import { CameraRig } from '../../smpl_edit/camera_rig.js';
import { canvasNormToImage } from '../../smpl_render/view_zoom.js';
import { layoutRects, letterbox, bestGrid, hitRect, FREE_SPLIT, defaultFreeAxes, freeAxisPlacement,
  freeFrontOptions, alignedWindow, zoomAlignedAt, alignedImageOffset, applyAlignedProjection } from '../src/layout.js';

const PORTRAIT = 9 / 16;
const opts = { camIds: ['zcam1', 'zcam2'], W: 1400, H: 1000, aspect: PORTRAIT };

test('mode A: 3D free view on the left, aligned videos on the right', () => {
  const r = layoutRects('A', opts);
  assert.deepEqual(r.map((x) => x.kind), ['free', 'aligned', 'aligned']);
  assert.equal(r[0].w, FREE_SPLIT);
  assert.ok(r.slice(1).every((x) => x.x >= FREE_SPLIT - 1e-12));
});

test('mode B: two portrait videos go side by side, covering the canvas', () => {
  const r = layoutRects('B', opts);
  assert.deepEqual(r.map((x) => x.camId), ['zcam1', 'zcam2']);
  assert.equal(r[0].y, r[1].y);
  assert.ok(Math.abs(r[0].w + r[1].w - 1) < 1e-12);
});

test('mode C: only the focused camera, falls back to the first', () => {
  assert.deepEqual(layoutRects('C', { ...opts, focusId: 'zcam2' }).map((x) => x.camId), ['zcam2']);
  assert.deepEqual(layoutRects('C', { ...opts, focusId: 'nope' }).map((x) => x.camId), ['zcam1']);
});

test('single camera works in every mode', () => {
  for (const m of ['A', 'B', 'C']) assert.ok(layoutRects(m, { ...opts, camIds: ['zcam2'] }).some((x) => x.camId === 'zcam2'));
});

test('bestGrid stacks landscape images and lines up portrait ones', () => {
  assert.equal(bestGrid(2, 1000, 1000, PORTRAIT).cols, 2);
  assert.equal(bestGrid(2, 1000, 1000, 16 / 9).cols, 1);
});

test('letterbox keeps aspect and stays centred inside the rect', () => {
  const rect = { x: 0.5, y: 0, w: 0.5, h: 1 };
  const b = letterbox(rect, 1000, 1000, PORTRAIT);
  assert.ok(Math.abs((b.w * 1000) / (b.h * 1000) - PORTRAIT) < 1e-9);
  assert.ok(Math.abs(b.x - rect.x - (rect.w - b.w) / 2) < 1e-12);
  assert.equal(hitRect(0.75, 0.5, [rect]), rect);
  assert.equal(hitRect(0.25, 0.5, [rect]), null);
});

test('3D observer axes accept signed dataset defaults and preserve the world target', () => {
  assert.deepEqual(defaultFreeAxes({ up: [-1, 0, 0], front: [0, 0, 1] }), { up: '-X', front: 'Z' });
  assert.deepEqual(defaultFreeAxes({ up: '−X', front: '+Z' }), { up: '-X', front: 'Z' });
  assert.deepEqual(defaultFreeAxes({ up: 'X', front: '-X' }, [0.9, -0.1, -0.35]), { up: 'X', front: '-Z' });
  assert.deepEqual(freeFrontOptions('-X'), ['Y', '-Y', 'Z', '-Z']);
  const target = [4, 5, 6];
  const place = freeAxisPlacement('-X', '-Z', target, 2);
  assert.deepEqual(place.target, target);
  assert.deepEqual(place.up, [-1, 0, 0]);
  assert.ok(place.position[0] < target[0] && place.position[2] < target[2]);
  assert.equal(place.position[1], target[1]);
});

const baseWindow = { imageW: 720, imageH: 1280, viewportAspect: 1.6, zoom: 1, panX: 0, panY: 0 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('C cover fills a wide viewport, pans at 1×, and zooms around the cursor', () => {
  const cover = alignedWindow(baseWindow);
  assert.deepEqual(cover, { winX: 0, winY: 415, winW: 720, winH: 450, panX: 0, panY: 0 });
  assert.equal(alignedWindow({ ...baseWindow, panY: 1e5 }).winY, 830);
  const full = alignedWindow({ ...baseWindow, viewportAspect: null });
  assert.deepEqual(full, { winX: 0, winY: 0, winW: 720, winH: 1280, panX: 0, panY: 0 });
  const u = 0.38, v = 0.43, factor = 1.8;
  const [x, y] = canvasNormToImage(u, v, cover);
  const zoomed = alignedWindow({ ...baseWindow, ...zoomAlignedAt(baseWindow, u, v, factor) });
  const [nextX, nextY] = canvasNormToImage(u, v, zoomed);
  close(zoomed.winW / zoomed.winH, baseWindow.viewportAspect);
  close(nextX, x);
  close(nextY, y);
});

test('fit, cover, and pan/zoom share off-center anisotropic projection and pointer rays', () => {
  const { imageW: W, imageH: H } = baseWindow;
  const K = { fx: 720.3, fy: 834.7, cx: 291.2, cy: 705.3 };
  const camera = new PerspectiveCamera(45, 1, 0.01, 200);
  const settings = [
    { ...baseWindow, viewportAspect: null },
    baseWindow,
    { ...baseWindow, zoom: 1.6, panX: -37, panY: 200 },
  ];
  for (const args of settings) {
    const win = alignedWindow(args);
    applyAlignedProjection(camera, W, H, K, win);
    for (const [u, v] of [[0, 0], [0.21, 0.72], [0.5, 0.5], [1, 1]]) {
      const [ix, iy] = canvasNormToImage(u, v, win), x = ix - 0.5, y = iy - 0.5;
      for (const depth of [3.5, 50]) {
        const p = new Vector3((x - K.cx) * depth / K.fx, -(y - K.cy) * depth / K.fy, -depth);
        p.project(camera);
        close(p.x, 2 * u - 1);
        close(p.y, 1 - 2 * v);
      }
      const ray = new Vector3(2 * u - 1, 1 - 2 * v, 0).unproject(camera);
      close(K.cx - K.fx * ray.x / ray.z, x);
      close(K.cy + K.fy * ray.y / ray.z, y);
    }
  }
});

test('a rotated native RGB pixel and a calibrated mesh point project to the same canvas point', () => {
  const native = { id: 'side', width: 1280, height: 720, view_rotation_deg: -90,
    cam_K: { fx: 834.7, fy: 720.3, cx: 573.7, cy: 291.2 }, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
  const rig = new CameraRig([native]);
  const { width: W, height: H, K, rotationDeg } = rig.view('side');
  const [u, v] = [511, 412];
  const [x, y] = rig.viewPixelFromNative('side', [u, v]);
  const rgb = new Texture();
  rgb.center.set(0.5, 0.5);
  rgb.rotation = -rotationDeg * Math.PI / 180;
  rgb.updateMatrix();
  const texel = rgb.transformUv(new Vector2((x + 0.5) / W, 1 - (y + 0.5) / H));
  close(texel.x, (u + 0.5) / native.width);
  close(texel.y, (v + 0.5) / native.height);

  const camera = new PerspectiveCamera(45, 1, 0.01, 200);
  const win = alignedWindow(baseWindow);
  applyAlignedProjection(camera, W, H, K, win);
  const [ox, oy] = alignedImageOffset(W, H, K);
  const mesh = new Vector3((x - K.cx) * 3 / K.fx, (K.cy - y) * 3 / K.fy, -3).project(camera);
  const plane = new Vector3((ox + x + 0.5 - W / 2) * 50 / K.fx, -(oy + y + 0.5 - H / 2) * 50 / K.fy, -50).project(camera);
  close(mesh.x, plane.x);
  close(mesh.y, plane.y);
});
