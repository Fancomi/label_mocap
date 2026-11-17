import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CameraRig, viewRotation, normalizeRotation } from '../camera_rig.js';

const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);

// sam3d 数据包 calibration/cameras.json 中 orb1 / zcam2 的原生参数(原样)。
const ORB1 = {
  id: 'orb1', width: 1280, height: 720,
  cam_K: { fx: 749.0089721679688, fy: 749.132080078125, cx: 634.9500122070312, cy: 355.586181640625 },
  R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], view_rotation_deg: 90,
};
const ZCAM2 = {
  id: 'zcam2', width: 1920, height: 1080,
  cam_K: { fx: 734.0503399264461, fy: 734.0503399264461, cx: 960, cy: 540 },
  R: [-0.9957939799016373, 0.08221686800183403, -0.040431871186311155,
    0.02779528727618885, -0.14940814273713388, -0.9883848586907199,
    -0.08730275824332008, -0.9853515075848868, 0.1464944876208628],
  t: [0.32085530923108224, 3.815227737200184, 3.5086293311146908], view_rotation_deg: -90,
};

// 原生 OpenCV 投影(参照实现):世界(GL) → 公共(CV) → 原生 → 像素。
function projectNativeRef(c, X) {
  const p = [X[0], -X[1], -X[2]];
  const R = c.R;
  const q = [0, 1, 2].map((r) => R[r * 3] * p[0] + R[r * 3 + 1] * p[1] + R[r * 3 + 2] * p[2] + c.t[r]);
  return [c.cam_K.fx * q[0] / q[2] + c.cam_K.cx, c.cam_K.fy * q[1] / q[2] + c.cam_K.cy];
}

test('normalizeRotation folds -90 to 270 and rejects non-quarter turns', () => {
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(450), 90);
  assert.throws(() => normalizeRotation(45));
});

test('view intrinsics match the bundle upright K (orb1 cw90, zcam2 ccw90)', () => {
  const rig = new CameraRig([ORB1, ZCAM2]);
  const o = rig.view('orb1');
  assert.deepEqual([o.width, o.height], [720, 1280]);
  assert.ok(close([o.K.fx, o.K.fy, o.K.cx, o.K.cy], [749.132080078125, 749.0089721679688, 363.413818359375, 634.9500122070312], 1e-6));
  const z = rig.view('zcam2');
  assert.deepEqual([z.width, z.height], [1080, 1920]);
  assert.ok(close([z.K.fx, z.K.fy, z.K.cx, z.K.cy], [734.0503399264461, 734.0503399264461, 540, 959], 1e-6));
});

test('projecting into the rotated view == rotating the native projection', () => {
  const rig = new CameraRig([ORB1, ZCAM2]);
  const pts = [[1.0, 0.1, -3.4], [0.3, -0.5, -4.8], [1.9, 0.2, -3.7]];
  for (const c of [ORB1, ZCAM2]) {
    for (const X of pts) {
      const viaView = rig.project(c.id, X);
      const viaNative = rig.viewPixelFromNative(c.id, projectNativeRef(c, X));
      assert.ok(close(viaView, viaNative, 1e-6), `${c.id} ${viaView} vs ${viaNative}`);
    }
  }
});

test('pixel and bbox native<->view round trip for every quarter turn', () => {
  for (const deg of [0, 90, 180, 270]) {
    const rig = new CameraRig([{ ...ORB1, view_rotation_deg: deg }]);
    const uv = [100.25, 37.5];
    assert.ok(close(rig.nativePixelFromView('orb1', rig.viewPixelFromNative('orb1', uv)), uv));
    const box = [100, 40, 300, 200];
    const v = rig.bboxViewFromNative('orb1', box);
    assert.ok(close(rig.bboxNativeFromView('orb1', v), box), `deg ${deg}`);
    const { width, height } = viewRotation(deg, 1280, 720);
    assert.ok(v[0] >= 0 && v[1] >= 0 && v[0] + v[2] <= width && v[1] + v[3] <= height);
  }
});

test('camToWorld inverts worldToCam; orb1 sits at the world origin', () => {
  const rig = new CameraRig([ORB1, ZCAM2]);
  assert.ok(close(rig.camToWorld('orb1').t, [0, 0, 0]));
  const X = [0.4, -0.2, -3.9];
  const p = rig.worldToCam('zcam2', X);
  const { R, t } = rig.camToWorld('zcam2');
  const back = [0, 1, 2].map((r) => R[r * 3] * p[0] + R[r * 3 + 1] * p[1] + R[r * 3 + 2] * p[2] + t[r]);
  assert.ok(close(back, X, 1e-9));
});

test('fromDoc returns null for single-view docs without cameras', () => {
  assert.equal(CameraRig.fromDoc({ images: [] }), null);
  assert.ok(CameraRig.fromDoc({ cameras: [ORB1] }) instanceof CameraRig);
});
