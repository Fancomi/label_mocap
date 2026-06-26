import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COCO17, sideOf, jointColor, edgeColor, SIDE_COLOR } from '../src/skeleton.js';

test('sideOf 按前缀判定左/右/中线', () => {
  assert.equal(sideOf('left_shoulder'), 'L');
  assert.equal(sideOf('right_ankle'), 'R');
  assert.equal(sideOf('nose'), 'C');
});

test('jointColor 取对应侧颜色', () => {
  assert.equal(jointColor(COCO17, COCO17.names.indexOf('left_wrist')), SIDE_COLOR.L);
  assert.equal(jointColor(COCO17, COCO17.names.indexOf('right_wrist')), SIDE_COLOR.R);
  assert.equal(jointColor(COCO17, COCO17.names.indexOf('nose')), SIDE_COLOR.C);
});

test('edgeColor：同侧取该侧，含中线取另一端，左右横连取中线', () => {
  const i = (n) => COCO17.names.indexOf(n);
  assert.equal(edgeColor(COCO17, i('left_shoulder'), i('left_elbow')), SIDE_COLOR.L);   // 同左
  assert.equal(edgeColor(COCO17, i('nose'), i('left_eye')), SIDE_COLOR.L);              // 含中线→左
  assert.equal(edgeColor(COCO17, i('left_shoulder'), i('right_shoulder')), SIDE_COLOR.C); // 横连→中线
});
