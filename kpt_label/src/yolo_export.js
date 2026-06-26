// kpt_label/src/yolo_export.js
// 中间 JSON → Ultralytics YOLO-pose 数据集（纯逻辑，无 IO）。
// 一人一行：class cx cy w h (x y v)*N，全部归一化到 [0,1]。
import { bboxFromKeypoints } from './bbox_geom.js';

const fmt = (n) => String(Math.round(n * 1e6) / 1e6);   // 6 位小数，去浮点尾噪

// 一人 → 一行；无框者用关键点包围盒补，无可见点返回 null。
export function personToYoloLine(person, img, skel) {
  const { width: W, height: H } = img;
  const bbox = person.bbox ?? bboxFromKeypoints(person.keypoints, { width: W, height: H });
  if (!bbox) return null;
  const [bx, by, bw, bh] = bbox;
  const parts = ['0', fmt((bx + bw / 2) / W), fmt((by + bh / 2) / H), fmt(bw / W), fmt(bh / H)];
  for (let i = 0; i < skel.names.length; i++) {
    const [x, y, v] = person.keypoints[i] ?? [0, 0, 0];
    if (v > 0) parts.push(fmt(x / W), fmt(y / H), String(v));
    else parts.push('0', '0', '0');
  }
  return parts.join(' ');
}

// 一图所有人 → 多行文本；无人空串。
export function imageLabelText(persons, img, skel) {
  return persons.map((p) => personToYoloLine(p, img, skel)).filter(Boolean).join('\n');
}

// dataset.yaml 文本。hasVal=false 时 val 指向 train 以免 ultralytics 报错。
export function datasetYaml(skel, { hasVal }) {
  const names = skel.names.map((n, i) => `  ${i}: ${n}`).join('\n');
  return [
    'path: .',
    'train: images/train',
    `val: images/${hasVal ? 'val' : 'train'}`,
    'nc: 1',
    'names:',
    names,
    `kpt_shape: [${skel.names.length}, 3]`,
    `flip_idx: [${skel.flip_idx.join(', ')}]`,
    '',
  ].join('\n');
}

// 完整导出包：每图分配 split，产出 label 文件清单 + yaml + 图像→split 映射。
// valRatio∈[0,1]：确定性地每隔 round(1/valRatio) 取一张进 val（非随机，可复现）。
export function buildExport(doc, skel, { valRatio = 0 } = {}) {
  const stem = (f) => f.replace(/\.[^.]+$/, '');
  const step = valRatio > 0 ? Math.max(2, Math.round(1 / valRatio)) : 0;
  const images = doc.images.map((im, i) => ({
    file_name: im.file_name,
    split: step && (i % step === 0) ? 'val' : 'train',
  }));
  const hasVal = images.some((im) => im.split === 'val');
  const labelFiles = doc.annotations.map((ann) => {
    const im = doc.images[ann.image_idx];
    const split = images[ann.image_idx].split;
    return {
      path: `labels/${split}/${stem(im.file_name)}.txt`,
      text: imageLabelText(ann.persons, im, skel),
    };
  });
  return { images, labelFiles, yaml: datasetYaml(skel, { hasVal }) };
}
