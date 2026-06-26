// kpt_label/src/skeleton.js
// 配置驱动的关键点骨架定义。换骨架只需新增一个同形对象并在 REGISTRY 注册。
// names.length 自动驱动 YOLO 的 kpt_shape=[N,3]。
export const COCO17 = {
  id: 'coco17',
  names: [
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  ],
  edges: [
    [0, 1], [0, 2], [1, 3], [2, 4],
    [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
    [5, 11], [6, 12], [11, 12],
    [11, 13], [13, 15], [12, 14], [14, 16],
  ],
  flip_idx: [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15],
  layout: [
    { name: 'nose', x: 0.50, y: 0.10 },
    { name: 'left_eye', x: 0.45, y: 0.07 },
    { name: 'right_eye', x: 0.55, y: 0.07 },
    { name: 'left_ear', x: 0.40, y: 0.10 },
    { name: 'right_ear', x: 0.60, y: 0.10 },
    { name: 'left_shoulder', x: 0.38, y: 0.25 },
    { name: 'right_shoulder', x: 0.62, y: 0.25 },
    { name: 'left_elbow', x: 0.30, y: 0.42 },
    { name: 'right_elbow', x: 0.70, y: 0.42 },
    { name: 'left_wrist', x: 0.26, y: 0.58 },
    { name: 'right_wrist', x: 0.74, y: 0.58 },
    { name: 'left_hip', x: 0.43, y: 0.55 },
    { name: 'right_hip', x: 0.57, y: 0.55 },
    { name: 'left_knee', x: 0.42, y: 0.75 },
    { name: 'right_knee', x: 0.58, y: 0.75 },
    { name: 'left_ankle', x: 0.42, y: 0.95 },
    { name: 'right_ankle', x: 0.58, y: 0.95 },
  ],
};

const REGISTRY = { coco17: COCO17 };

export function getSkeleton(id = 'coco17') {
  return REGISTRY[id] ?? COCO17;
}
