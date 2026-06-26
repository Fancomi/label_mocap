import assert from 'node:assert/strict';
import { test } from 'node:test';
import { personToYoloLine, imageLabelText, datasetYaml, buildExport } from '../src/yolo_export.js';
import { COCO17 } from '../src/skeleton.js';

const IMG = { width: 100, height: 200 };

test('personToYoloLine：归一化 bbox(中心) + 关键点，字段数 = 5 + N*3', () => {
  const p = { bbox: [10, 20, 30, 40], keypoints: Array.from({ length: 17 }, () => [0, 0, 0]) };
  p.keypoints[0] = [50, 100, 2];
  const nums = personToYoloLine(p, IMG, COCO17).split(' ').map(Number);
  assert.equal(nums.length, 5 + 17 * 3);
  assert.equal(nums[0], 0);
  assert.ok(Math.abs(nums[1] - 0.25) < 1e-9);
  assert.ok(Math.abs(nums[2] - 0.20) < 1e-9);
  assert.ok(Math.abs(nums[3] - 0.30) < 1e-9);
  assert.ok(Math.abs(nums[4] - 0.20) < 1e-9);
  assert.ok(Math.abs(nums[5] - 0.50) < 1e-9);
  assert.ok(Math.abs(nums[6] - 0.50) < 1e-9);
  assert.equal(nums[7], 2);
});

test('personToYoloLine：v=0 点输出 0 0 0', () => {
  const p = { bbox: [0, 0, 10, 10], keypoints: Array.from({ length: 17 }, () => [0, 0, 0]) };
  const nums = personToYoloLine(p, IMG, COCO17).split(' ').map(Number);
  assert.deepEqual(nums.slice(5, 8), [0, 0, 0]);
});

test('personToYoloLine：无框者用关键点包围盒补齐', () => {
  const kpts = Array.from({ length: 17 }, () => [0, 0, 0]);
  kpts[0] = [20, 40, 2]; kpts[1] = [60, 120, 2];
  const nums = personToYoloLine({ bbox: null, keypoints: kpts }, IMG, COCO17).split(' ').map(Number);
  assert.ok(Math.abs(nums[1] - 0.40) < 1e-9);
  assert.ok(Math.abs(nums[2] - 0.40) < 1e-9);
});

test('personToYoloLine：无框且无可见点 → null', () => {
  const p = { bbox: null, keypoints: Array.from({ length: 17 }, () => [0, 0, 0]) };
  assert.equal(personToYoloLine(p, IMG, COCO17), null);
});

test('imageLabelText：多人多行；无人空串', () => {
  const persons = [
    { bbox: [0, 0, 10, 10], keypoints: Array.from({ length: 17 }, () => [0, 0, 0]) },
    { bbox: [50, 50, 10, 10], keypoints: Array.from({ length: 17 }, () => [0, 0, 0]) },
  ];
  assert.equal(imageLabelText(persons, IMG, COCO17).split('\n').length, 2);
  assert.equal(imageLabelText([], IMG, COCO17), '');
});

test('datasetYaml：含 kpt_shape/flip_idx/names/nc/train/val', () => {
  const y = datasetYaml(COCO17, { hasVal: true });
  assert.match(y, /kpt_shape: \[17, 3\]/);
  assert.match(y, /flip_idx: \[0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15\]/);
  assert.match(y, /nc: 1/);
  assert.match(y, /train: images\/train/);
  assert.match(y, /val: images\/val/);
});

test('datasetYaml：无 val 时 val 指向 train', () => {
  assert.match(datasetYaml(COCO17, { hasVal: false }), /val: images\/train/);
});

test('buildExport：valRatio=0 全 train；标签与图像一一对应、无人空 txt', () => {
  const doc = {
    schema: 'kpt-label/v1', skeleton: 'coco17',
    images: [{ file_name: 'a.jpg', width: 100, height: 200 },
             { file_name: 'b.jpg', width: 100, height: 200 }],
    annotations: [
      { image_idx: 0, persons: [{ bbox: [0, 0, 10, 10], keypoints: Array.from({ length: 17 }, () => [0, 0, 0]) }] },
      { image_idx: 1, persons: [] },
    ],
  };
  const out = buildExport(doc, COCO17, { valRatio: 0 });
  const files = Object.fromEntries(out.labelFiles.map((f) => [f.path, f.text]));
  assert.ok('labels/train/a.txt' in files);
  assert.equal(files['labels/train/b.txt'], '');
  assert.equal(out.images[0].split, 'train');
  assert.match(out.yaml, /val: images\/train/);
});

test('buildExport：valRatio=0.5 时部分进 val', () => {
  const doc = {
    schema: 'kpt-label/v1', skeleton: 'coco17',
    images: Array.from({ length: 4 }, (_, i) => ({ file_name: `${i}.jpg`, width: 100, height: 100 })),
    annotations: Array.from({ length: 4 }, (_, i) => ({ image_idx: i, persons: [] })),
  };
  const out = buildExport(doc, COCO17, { valRatio: 0.5 });
  assert.equal(out.images.filter((im) => im.split === 'val').length, 2);
  assert.match(out.yaml, /val: images\/val/);
});
