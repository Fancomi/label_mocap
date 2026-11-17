// smpl_core/body_model.js — 人体模型适配层:app 与 smpl_edit 只认这个接口,不认具体模型。
//
// BodyModel {
//   name, jointCount, parents, jointNames, faces,
//   bones: [[a, b, group]],    // group 同 label/pcd 场景配色:0 躯干 / 1 左臂 / 2 右臂 / 3 左腿 / 4 右腿
//   rootJoint,                 // 整体位姿手柄所在关节
//   presenceKey, fieldKeys,    // 该模型在标注里的「是否存在」代表键 / 全部参数键(不含 bbox 等通用键)
//   defaultFields(),           // 新建标注的初始参数
//   forward(fields, { worldRot }) → { vertices(V×3 米), joints(J×3 米), worldRot?(J×9 行主序) }
//   // ── 编辑器配置(app 里不再写死关节数/索引)──
//   displayJoints,             // 画关节球/可点选的骨架关节索引
//   poseJoints, poseLabels,    // 姿态 tab 的关节按钮:第 k 个按钮 → 骨架关节 poseJoints[k]
//   canEditPose,               // 姿态 tab 是否可用
//   supportsHands, showHands,  // 是否有可开关的手部关节 / 当前是否显示
//   shapeGroups,               // 体型 tab 滑块分组 [{ title, key, indices, labels, min, max, step, open }]
//   ikSkeleton,                // smpl_edit/ik_chains.js 的骨架名;null = 无 IK
//   cloudInference,            // 是否支持云端 GVHMR(只出 SMPL)
//   keypointJoints, keypointSlots,  // 保存时重投影 keypoints / 遮挡:用哪些关节、写多少槽
//   angleReadouts,             // 左栏关节角读数 [label, a, vertex, b]
//   jointScale(j),             // 关节 j 的显示尺寸系数(关节球、选中后的手柄);手指等精细关节 < 1
// }
// 共同语义:root_pos = 根关节(骨盆)世界位置(米);root_rota = 整体朝向(轴角),绕骨盆旋转静止姿态。
// 世界系 = 主相机系(Y 上、−Z 深度)。
import { forwardSmpl } from './lbs.js';
import { JOINT_NAMES } from './joint_names.js';
import { axisAngleToQuat, quatToEulerXYZ, quatToMat3 } from './rotations.js';
import { forwardMhrModel, mhrRestShape, MHR_MODEL_PARAMS, MHR_ROOT_JOINT } from './mhr.js';
import { mhrPoseChannels } from './mhr_pose.js';

// 运行时资产(相对 smpl_web_viewer/public/models/)。
export const BODY_ASSETS = { smpl: 'smpl_neutral.meta.json', mhr: 'mhr_lod1.meta.json' };

export function createBody(name, model) {
  if (name === 'smpl') return createSmplBody(model);
  if (name === 'mhr') return createMhrBody(model);
  throw new Error(`不支持的人体模型: ${name}`);
}

export function bodyModelNameOf(rawDoc) {
  return rawDoc?.info?.body_model ?? 'smpl';
}

// 不依赖模型资产的字段契约:标注文档层(CocoDocument/AnnotationStore)只需要这部分。
export const BODY_SCHEMAS = {
  smpl: {
    presenceKey: 'body_pose',
    fieldKeys: ['root_pos', 'root_rota', 'body_pose', 'betas'],
    defaultFields: () => ({
      root_pos: [0, 0, -4], root_rota: [0, 0, 0],
      body_pose: Array(63).fill(0), betas: Array(10).fill(0),
    }),
  },
  mhr: {
    presenceKey: 'mhr_pose',
    fieldKeys: ['root_pos', 'root_rota', 'mhr_pose', 'mhr_scale', 'mhr_shape'],
    defaultFields: () => ({
      root_pos: [0, 0, -4], root_rota: [0, 0, 0],
      mhr_pose: Array(130).fill(0), mhr_scale: Array(68).fill(0), mhr_shape: Array(45).fill(0),
    }),
  },
};

export function bodySchemaOf(rawDoc) {
  const name = bodyModelNameOf(rawDoc);
  const schema = BODY_SCHEMAS[name];
  if (!schema) throw new Error(`不支持的人体模型: ${name}`);
  return schema;
}

const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

// 读数沿用既有标注员习惯的左右命名(与 SMPL 关节名左右相反,勿「修正」)。
const SMPL_ANGLES = [
  ['R-Elbow', 16, 18, 20], ['L-Elbow', 17, 19, 21],
  ['R-Knee', 1, 4, 7], ['L-Knee', 2, 5, 8],
  ['R-Shoulder', 9, 16, 18], ['L-Shoulder', 9, 17, 19],
  ['R-Hip', 0, 1, 4], ['L-Hip', 0, 2, 5],
  ['Spine', 0, 6, 12],
];

const SMPL_BONES = [
  [0, 3, 0], [3, 6, 0], [6, 9, 0], [9, 12, 0], [12, 15, 0],
  [9, 13, 1], [13, 16, 1], [16, 18, 1], [18, 20, 1], [20, 22, 1],
  [9, 14, 2], [14, 17, 2], [17, 19, 2], [19, 21, 2], [21, 23, 2],
  [0, 1, 3], [1, 4, 3], [4, 7, 3], [7, 10, 3],
  [0, 2, 4], [2, 5, 4], [5, 8, 4], [8, 11, 4],
];

export function createSmplBody(model) {
  return {
    name: 'smpl',
    jointCount: model.J_regressorShape[0],
    parents: model.parents,
    jointNames: JOINT_NAMES,
    faces: model.faces,
    bones: SMPL_BONES,
    rootJoint: 0,
    ...BODY_SCHEMAS.smpl,
    forward: (fields, opts) => forwardSmpl(model, fields, opts),
    displayJoints: range(0, 24),
    poseJoints: range(1, 22),
    poseLabels: JOINT_NAMES.slice(1, 22),
    canEditPose: true,
    supportsHands: false, showHands: false,
    shapeGroups: [{ title: '体型 β', key: 'betas', indices: range(0, 10), labels: range(0, 10).map((i) => `β${i}`), min: -5, max: 5, step: 0.1, open: true }],
    ikSkeleton: 'smpl',
    cloudInference: true,
    keypointJoints: range(0, 24),
    keypointSlots: 52,
    angleReadouts: SMPL_ANGLES,
    jointScale: () => 1,
  };
}

// 显示用骨架:去掉 twist/null 辅助关节与口眼内部关节;父关节被去掉时接到最近的保留祖先。
const MHR_HIDDEN = /(_proc|_null)$|^c_(teeth|tongue|jaw)|_eye$|^body_world$/;
const MHR_LEG = /_(upleg|lowleg|foot|talocrural|subtalar|transversetarsal|ball)$/;
const MHR_FINGER = /_(pinky|ring|middle|index|thumb)\d$/;
const MHR_FINGER_SCALE = 0.35;
// 姿态 tab 的控制关节(每个都有系数为 1 的直驱参数;见设计文档「编辑映射」)。
// l_wrist_twist = 前臂扭转(rx),l_foot = 小腿扭转 + 足内外翻,l_talocrural = 踝屈伸,l_ball = 脚趾。
const MHR_POSE_JOINTS = [
  'c_spine0', 'c_spine1', 'c_spine2', 'c_spine3', 'c_neck', 'c_head',
  'l_clavicle', 'l_uparm', 'l_lowarm', 'l_wrist_twist', 'l_wrist',
  'r_clavicle', 'r_uparm', 'r_lowarm', 'r_wrist_twist', 'r_wrist',
  'l_upleg', 'l_lowleg', 'l_foot', 'l_talocrural', 'l_subtalar', 'l_transversetarsal', 'l_ball',
  'r_upleg', 'r_lowleg', 'r_foot', 'r_talocrural', 'r_subtalar', 'r_transversetarsal', 'r_ball',
];
const MHR_ANGLES = [   // 左右命名同 SMPL_ANGLES 的既有习惯
  ['R-Elbow', 'l_uparm', 'l_lowarm', 'l_wrist'], ['L-Elbow', 'r_uparm', 'r_lowarm', 'r_wrist'],
  ['R-Knee', 'l_upleg', 'l_lowleg', 'l_foot'], ['L-Knee', 'r_upleg', 'r_lowleg', 'r_foot'],
  ['R-Shoulder', 'c_spine3', 'l_uparm', 'l_lowarm'], ['L-Shoulder', 'c_spine3', 'r_uparm', 'r_lowarm'],
  ['R-Hip', 'root', 'l_upleg', 'l_lowleg'], ['L-Hip', 'root', 'r_upleg', 'r_lowleg'],
  ['Spine', 'root', 'c_spine3', 'c_head'],
];

// 体型 tab:身体体型、骨长缩放常显;头部、柔性长度折叠;手部只在 showHands 时出现。表情不开放。
// 范围按交付数据实测幅度(体型 ≤2.2、缩放 ≤1.0、柔性 ≤1.3)留余量。
function mhrShapeGroups(paramNames, showHands) {
  const scaleName = (i) => paramNames[136 + i].replace(/^scale_/, '');
  const scaleIdx = (re) => range(0, 68).filter((i) => re.test(scaleName(i)));
  const shapeLabels = (a, b) => range(a, b).map((i) => `s${String(i).padStart(2, '0')}`);
  const groups = [
    { title: '身体体型', key: 'mhr_shape', indices: range(0, 20), labels: shapeLabels(0, 20), min: -3, max: 3, step: 0.05, open: true },
    { title: '骨长缩放', key: 'mhr_scale', indices: scaleIdx(/^(spine|neck|shoulder|uparms|lowarms|hip|uplegs|lowlegs|knee|ankle|foot)/), min: -1.5, max: 1.5, step: 0.01, open: true },
    { title: '头部体型', key: 'mhr_shape', indices: range(20, 40), labels: shapeLabels(20, 40), min: -3, max: 3, step: 0.05, open: false },
    { title: '柔性长度', key: 'mhr_pose', indices: range(124, 130), labels: paramNames.slice(130, 136).map((n) => n.replace(/_flexible$/, '')), min: -2, max: 2, step: 0.01, open: false },
  ];
  if (showHands) {
    groups.push(
      { title: '手部体型', key: 'mhr_shape', indices: range(40, 45), labels: shapeLabels(40, 45), min: -3, max: 3, step: 0.05, open: false },
      { title: '手部缩放', key: 'mhr_scale', indices: scaleIdx(/hands$|^[lr]_(index|middle|ring|pinky|thumb)/), min: -1.5, max: 1.5, step: 0.01, open: false });
  }
  for (const g of groups) g.labels ??= g.indices.map(scaleName);
  return groups;
}

// 姿态按钮上的中文名(分组已标明左右,按钮上不再重复)。由近及远:髋→膝→小腿扭转→踝→距下→足中→趾。
const MHR_PART = {
  c_spine0: '腰椎', c_spine1: '下胸椎', c_spine2: '中胸椎', c_spine3: '上胸椎', c_neck: '颈', c_head: '头',
  clavicle: '锁骨', uparm: '肩', lowarm: '肘', wrist_twist: '前臂扭转', wrist: '腕',
  upleg: '髋', lowleg: '膝', foot: '小腿扭转', talocrural: '踝 屈伸', subtalar: '足 内外翻', transversetarsal: '足中部', ball: '脚趾',
};
const MHR_DIGIT = { thumb: '拇指', index: '食指', middle: '中指', ring: '无名指', pinky: '小指' };
export function mhrJointLabel(name) {
  if (MHR_PART[name]) return MHR_PART[name];
  const part = name.replace(/^[lr]_/, '');
  if (MHR_PART[part]) return MHR_PART[part];
  const m = /^(thumb|index|middle|ring|pinky)(\d)$/.exec(part);
  return m ? `${MHR_DIGIT[m[1]]} ${m[2]}` : name;
}

// 手默认关闭:关节球/骨骼/keypoints 都不含手指;showHands 打开后才出现。
// keep(j) = false 的关节也不显示(不可调节的关节不出现在画面上,如 pinky0)。
export function mhrDisplayJoints(names, { showHands = false, keep = () => true } = {}) {
  return names.map((n, j) => j).filter((j) => !MHR_HIDDEN.test(names[j]) && (showHands || !MHR_FINGER.test(names[j])) && keep(j));
}

function mhrBoneGroup(name) {
  const side = name.startsWith('l_') ? 1 : name.startsWith('r_') ? 2 : 0;
  return side && MHR_LEG.test(name) ? side + 2 : side;
}

function mhrBones(names, parents, display) {
  const keep = names.map(() => false);
  for (const j of display) keep[j] = true;
  const bones = [];
  for (let j = 0; j < names.length; j++) {
    if (!keep[j]) continue;
    let p = parents[j];
    while (p >= 0 && !keep[p]) p = parents[p];
    if (p < 0) continue;
    bones.push([p, j, mhrBoneGroup(names[j])]);
  }
  return bones;
}

// MHR 标注字段 → 204 维 model_params。平移恒为 0:整体位置由 root_pos 在模型系之外施加。
export function mhrFieldsToModelParams(fields) {
  const mp = new Float64Array(MHR_MODEL_PARAMS);
  mp.set(quatToEulerXYZ(axisAngleToQuat(fields.root_rota)), 3);
  mp.set(fields.mhr_pose, 6);
  mp.set(fields.mhr_scale, 136);
  return mp;
}

export function createMhrBody(model, { showHands = false } = {}) {
  const names = model.meta.joint_names;
  const idx = (n) => { const j = names.indexOf(n); if (j < 0) throw new Error(`MHR 无关节 ${n}`); return j; };
  // 只显示可调节的关节(有直驱参数)与根关节:看得见就点得着。
  const keep = (j) => j === MHR_ROOT_JOINT || mhrPoseChannels(model, j).length > 0;
  const display = mhrDisplayJoints(names, { showHands, keep });
  // 训练标签的关节集合不随显示/可调节性变化(含手指,65 个),保证数据格式稳定。
  const labelJoints = mhrDisplayJoints(names, { showHands: true });
  // 手开启时,手指关节(有直驱参数的)追加到姿态按钮末尾。
  const fingerJoints = showHands
    ? names.map((n, j) => j).filter((j) => MHR_FINGER.test(names[j]) && mhrPoseChannels(model, j).length)
    : [];
  const poseJoints = [...MHR_POSE_JOINTS.map(idx), ...fingerJoints];
  const nJ = model.parentsShape[0];
  let restKey = null; let rest = null;   // 体型不变时复用静止网格(identity 混合是主要开销)
  const restFor = (shape) => {
    const key = shape.join(',');
    if (key !== restKey) { rest = mhrRestShape(model, shape); restKey = key; }
    return rest;
  };
  return {
    name: 'mhr',
    jointCount: nJ,
    parents: model.parents,
    jointNames: names,
    faces: model.faces,
    bones: mhrBones(names, model.parents, display),
    rootJoint: MHR_ROOT_JOINT,
    ...BODY_SCHEMAS.mhr,
    displayJoints: display,
    poseJoints,
    poseLabels: poseJoints.map((j) => mhrJointLabel(names[j])),
    canEditPose: true,
    supportsHands: true, showHands,
    model,   // 编辑层(smpl_edit/pose_state.js)求解 MHR 关节参数要用 PT
    shapeGroups: mhrShapeGroups(model.meta.parameter_names, showHands),
    ikSkeleton: null,   // 由 smpl_edit 层(ik_chains.js#resolveChains)在装配时填入,内核不依赖编辑层
    cloudInference: false,
    // 训练标签的关节集合固定(含手指),不随「手部」显示开关变化,保证各帧槽位一致。
    keypointJoints: labelJoints,
    keypointSlots: labelJoints.length,
    angleReadouts: MHR_ANGLES.map(([label, ...js]) => [label, ...js.map(idx)]),
    // 手指关节小而密:关节球与选中后的旋转手柄都缩小,避免互相遮挡、便于精细调整。
    // wrist_twist 与 wrist 重合,一样缩小,免得盖住相邻指节。
    jointScale: (j) => (MHR_FINGER.test(names[j]) || /_twist$/.test(names[j]) ? MHR_FINGER_SCALE : 1),
    forward(fields, { worldRot = false } = {}) {
      const { vertices, skeleton } = forwardMhrModel(model, null, mhrFieldsToModelParams(fields),
        { rest: restFor(fields.mhr_shape) });
      // 根关节绕自身旋转,其模型系位置与姿态无关:世界 = (p − root)/100 + root_pos
      const r = MHR_ROOT_JOINT * 3;
      const ox = skeleton.t[r], oy = skeleton.t[r + 1], oz = skeleton.t[r + 2];
      const [px, py, pz] = fields.root_pos;
      for (let i = 0; i < vertices.length; i += 3) {
        vertices[i] = (vertices[i] - ox) / 100 + px;
        vertices[i + 1] = (vertices[i + 1] - oy) / 100 + py;
        vertices[i + 2] = (vertices[i + 2] - oz) / 100 + pz;
      }
      const joints = new Float32Array(nJ * 3);
      for (let j = 0; j < nJ; j++) {
        joints[j * 3] = (skeleton.t[j * 3] - ox) / 100 + px;
        joints[j * 3 + 1] = (skeleton.t[j * 3 + 1] - oy) / 100 + py;
        joints[j * 3 + 2] = (skeleton.t[j * 3 + 2] - oz) / 100 + pz;
      }
      if (!worldRot) return { vertices, joints };
      const wr = new Float32Array(nJ * 9);
      for (let j = 0; j < nJ; j++) wr.set(quatToMat3(Array.from(skeleton.q.subarray(j * 4, j * 4 + 4))), j * 9);
      return { vertices, joints, worldRot: wr };
    },
  };
}
