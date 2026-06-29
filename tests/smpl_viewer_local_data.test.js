import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  detectOrientation,
  loadLocalA1SequenceFromFileList,
  loadLocalA1SequenceFromFiles,
  loadLocalA1SequenceFromDirSource,
  loadVideoSequence,
  normalizeAnnotationFrame,
  sequenceLabel,
} from '../smpl_viewer/local_data.js';

function validAnnotation(overrides = {}) {
  return {
    image_id: 7,
    root_pos: [1, 2, -5],
    root_rota: [0.1, 0.2, 0.3],
    body_pose: Array(63).fill(0),
    betas: Array(10).fill(0),
    ...overrides,
  };
}

test('normalizeAnnotationFrame maps json_results annotation to SMPL web frame', () => {
  const frame = normalizeAnnotationFrame(validAnnotation(), 3);

  assert.equal(frame.frame, 7);
  assert.deepEqual(frame.root_pos, [1, 2, -5]);
  assert.deepEqual(frame.root_rota, [0.1, 0.2, 0.3]);
  assert.equal(frame.body_pose.length, 63);
  assert.equal(frame.betas.length, 10);
  assert.deepEqual(Object.keys(frame), ['frame', 'root_pos', 'root_rota', 'body_pose', 'betas']);
});

test('normalizeAnnotationFrame falls back to sequence index for missing image id', () => {
  const annotation = validAnnotation();
  delete annotation.image_id;

  assert.equal(normalizeAnnotationFrame(annotation, 3).frame, 3);
});

test('detectOrientation mirrors legacy diving heuristic', () => {
  const wide = Array.from({ length: 60 }, (_, i) => [i, i % 2, -5]);
  const tall = Array.from({ length: 60 }, (_, i) => [i % 2, i, -5]);
  assert.equal(detectOrientation(wide), true);
  assert.equal(detectOrientation(tall), false);
});

test('sequenceLabel matches legacy src/name display', () => {
  assert.equal(sequenceLabel({ src: '10m', name: 'abc', n_frames: 12, portrait: true }), '10m/abc (12f, portrait)');
  assert.equal(sequenceLabel({ src: '10m', name: 'abc', n_frames: 12, portrait: false }), '10m/abc (12f)');
});

test('viewer html uses relative paths for pages subdirectory hosting', async () => {
  const html = await readFile(new URL('../smpl_viewer/viewer.html', import.meta.url), 'utf8');
  assert.match(html, /src="\.\/viewer\.js"/);
  assert.match(html, /"three": "\.\/vendor\/three\.module\.js"/);
  assert.doesNotMatch(html, /src="\/viewer\.js"/);
  assert.doesNotMatch(html, /"\/smpl_viewer\//);
  assert.doesNotMatch(html, /"\/smpl_web_viewer\//);
});

test('file-list loader reads selected a1 directory without directory handles', async () => {
  const files = [
    fakeFile('a1/json_results/player_0/player_0.json', JSON.stringify({
      annotations: [validAnnotation({ image_id: 0 }), validAnnotation({ image_id: 1 })],
    })),
    fakeFile('a1/images/000001.jpg', 'jpg-1'),
    fakeFile('a1/images/000002.jpg', 'jpg-2'),
  ];

  const seq = await loadLocalA1SequenceFromFileList(files);
  assert.equal(seq.name, 'a1');
  assert.equal(seq.n_frames, 2);
  assert.equal(seq.images.length, 2);
  assert.deepEqual(seq.frames.map((frame) => frame.frame), [0, 1]);
});

test('file-list loader accepts manually selected json and images', async () => {
  const files = [
    fakeFile('', JSON.stringify({ annotations: [validAnnotation({ image_id: 4 })] }), 'player_0.json'),
    fakeFile('', 'jpg-1', '000001.jpg'),
  ];

  const seq = await loadLocalA1SequenceFromFileList(files);
  assert.equal(seq.name, 'sequence');
  assert.equal(seq.n_frames, 1);
  assert.equal(seq.images.length, 1);
  assert.equal(seq.frames[0].frame, 4);
});

test('separate-file loader matches images to frames by index', async () => {
  const json = fakeFile('', JSON.stringify({ records: [validAnnotation({ image_id: 9 })] }), 'player_0.json');
  const images = [
    fakeFile('', 'jpg-2', '000002.jpg'),
    fakeFile('', 'jpg-1', '000001.jpg'),
    fakeFile('', 'ignore', 'notes.txt'),
  ];

  const seq = await loadLocalA1SequenceFromFiles(json, images);
  assert.equal(seq.name, 'sequence');
  assert.equal(seq.n_frames, 1);
  // images 与 frames 对齐：单帧 → 取数字序第 0 张（无 file_name 命中，走下标兜底）。
  assert.deepEqual(seq.images.map((file) => file.name), ['000001.jpg']);
  assert.equal(seq.frames[0].frame, 9);
});

function fakeFile(path, text, name = path.split('/').at(-1)) {
  return {
    name,
    webkitRelativePath: path,
    async text() {
      return text;
    },
  };
}

function fakeDirSource({ json, files = {} }) {
  const imagePaths = Object.keys(files).filter((p) => /\.(jpe?g|png|bmp)$/i.test(p));
  return {
    classification: { imagePaths, dataItemName: 'a1' },
    async readJson() { return json; },
    async imageFileByName(name) {
      const want = name.split('/').pop();
      const hit = imagePaths.find((p) => p.split('/').pop() === want);
      return hit ? fakeFile(hit, files[hit]) : null;
    },
  };
}

test('dir-source loader maps each frame by image_id → file_name (order-independent)', async () => {
  const src = fakeDirSource({
    json: {
      images: [{ id: 0, file_name: '000001.jpg' }, { id: 1, file_name: '000002.jpg' }],
      annotations: [validAnnotation({ image_id: 1 }), validAnnotation({ image_id: 0 })],
    },
    files: { 'images/000001.jpg': 'jpg-1', 'images/000002.jpg': 'jpg-2' },
  });

  const seq = await loadLocalA1SequenceFromDirSource(src);
  assert.equal(seq.name, 'a1');
  assert.equal(seq.n_frames, 2);
  assert.deepEqual(seq.frames.map((f) => f.frame), [1, 0]);
  assert.deepEqual(seq.images.map((f) => f.name), ['000002.jpg', '000001.jpg']);
});

test('dir-source loader falls back to numeric order when json lacks file_name', async () => {
  const src = fakeDirSource({
    json: { annotations: [validAnnotation({ image_id: 0 }), validAnnotation({ image_id: 1 })] },
    files: { 'images/000002.jpg': 'jpg-2', 'images/000001.jpg': 'jpg-1' },
  });

  const seq = await loadLocalA1SequenceFromDirSource(src);
  assert.deepEqual(seq.images.map((f) => f.name), ['000001.jpg', '000002.jpg']);
});

test('dir-source loader throws when no image matches the json', async () => {
  const src = fakeDirSource({
    json: { annotations: [validAnnotation({ image_id: 0 })] },
    files: {},
  });

  await assert.rejects(loadLocalA1SequenceFromDirSource(src), /未找到与 json 匹配的图像/);
});

test('loaders read real image dims from json images[].width/height', async () => {
  const json = {
    images: [{ id: 0, file_name: '000001.jpg', width: 720, height: 1280 }],
    annotations: [validAnnotation({ image_id: 0 })],
  };
  // DirSource 路径
  const dirSeq = await loadLocalA1SequenceFromDirSource(fakeDirSource({
    json, files: { 'images/000001.jpg': 'jpg-1' },
  }));
  assert.equal(dirSeq.meta.image_w, 720);
  assert.equal(dirSeq.meta.image_h, 1280);
  assert.equal(dirSeq.meta.K.cx, 360);   // 主点居中到真实尺寸
  assert.equal(dirSeq.meta.K.cy, 640);

  // file-list 路径
  const listSeq = await loadLocalA1SequenceFromFileList([
    fakeFile('a1/player_0.json', JSON.stringify(json)),
    fakeFile('a1/images/000001.jpg', 'jpg-1'),
  ]);
  assert.equal(listSeq.meta.image_w, 720);
  assert.equal(listSeq.meta.image_h, 1280);
});

test('file-list loader accepts arbitrary directory layout (no a1 hardcode)', async () => {
  // json 不在 json_results/player_0/ 下，图像不在 images/ 下 —— 仍应识别。
  const seq = await loadLocalA1SequenceFromFileList([
    fakeFile('mydata/anno/player_0.json', JSON.stringify({
      annotations: [validAnnotation({ image_id: 0 })],
    })),
    fakeFile('mydata/frames/000001.jpg', 'jpg-1'),
  ]);
  assert.equal(seq.name, 'mydata');
  assert.equal(seq.n_frames, 1);
  assert.equal(seq.images.filter(Boolean).length, 1);
});

// 视频序列:注入 fake videoSource(只读 width/height/frameCount)+ fake json,断言
// meta.image_w/h 跟随视频尺寸、n_frames 取 min(标注帧数, 视频帧数)、带 videoSource、
// images 为 null(走视频纹理分支)。
function fakeVideoSource({ width, height, frameCount }) {
  return {
    width,
    height,
    frameCount() { return frameCount; },
    texture: {},
  };
}

test('loadVideoSequence drives dims from video and caps n_frames by annotations', () => {
  const json = {
    annotations: [
      validAnnotation({ image_id: 0 }),
      validAnnotation({ image_id: 1 }),
      validAnnotation({ image_id: 2 }),
    ],
  };
  // 视频帧数(100) > 标注帧数(3) → 以标注帧数为准。
  const vs = fakeVideoSource({ width: 720, height: 1280, frameCount: 100 });
  const seq = loadVideoSequence(vs, json, { name: 'clip.mp4' });

  assert.equal(seq.name, 'clip.mp4');
  assert.equal(seq.n_frames, 3);
  assert.equal(seq.meta.image_w, 720);
  assert.equal(seq.meta.image_h, 1280);
  assert.equal(seq.meta.K.cx, 360);   // 主点居中到视频尺寸
  assert.equal(seq.meta.K.cy, 640);
  assert.equal(seq.images, null);
  assert.equal(seq.videoSource, vs);
  assert.equal(seq.frames.length, 3);
});

test('loadVideoSequence caps n_frames by video when video is shorter', () => {
  const json = {
    annotations: Array.from({ length: 10 }, (_, i) => validAnnotation({ image_id: i })),
  };
  // 视频帧数(4) < 标注帧数(10) → 取 4。
  const vs = fakeVideoSource({ width: 1920, height: 1080, frameCount: 4 });
  const seq = loadVideoSequence(vs, json);
  assert.equal(seq.n_frames, 4);
  assert.equal(seq.frames.length, 4);
  assert.equal(seq.meta.image_w, 1920);
  assert.equal(seq.meta.image_h, 1080);
});
