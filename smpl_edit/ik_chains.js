// smpl_edit/ik_chains.js
import { mhrPoseChannels, mhrParamRanges } from '../smpl_core/mhr_pose.js';
// 骨骼无关的肢体链配置。joints = SMPL 24 关节索引(世界坐标取 lastJoints);
// bodyIdx = body_pose 21 索引(= 关节索引 − 1,关节 0 是 root,不在 body_pose)。
// 换骨骼只在此表加一项,solver/controller 不动。
const CHAINS = {
  smpl: [
    { name: 'L_Arm', joints: [16, 18, 20], bodyIdx: [15, 17, 19] },
    { name: 'R_Arm', joints: [17, 19, 21], bodyIdx: [16, 18, 20] },
    { name: 'L_Leg', joints: [1, 4, 7], bodyIdx: [0, 3, 6] },
    { name: 'R_Leg', joints: [2, 5, 8], bodyIdx: [1, 4, 7] },
    { name: 'Head', kind: 'head', joints: [3, 6, 9, 12, 15], bodyIdx: [2, 5, 8, 11, 14] },
  ],
};

// MHR:按关节名给出,由 resolveChains(body) 解析成骨架索引 + 姿态状态序号。
// 中间关节(肘/膝)只有 1 个弯曲自由度,MhrPoseState 会把 IK 结果投影到该轴并遵守限位。
export const MHR_CHAIN_NAMES = [
  { name: 'L_Arm', joints: ['l_uparm', 'l_lowarm', 'l_wrist'] },
  { name: 'R_Arm', joints: ['r_uparm', 'r_lowarm', 'r_wrist'] },
  // 腿的末端用踝(talocrural,与 l_foot 同位置;l_foot 的自由度是小腿扭转,不是「脚」)。
  { name: 'L_Leg', joints: ['l_upleg', 'l_lowleg', 'l_talocrural'] },
  { name: 'R_Leg', joints: ['r_upleg', 'r_lowleg', 'r_talocrural'] },
  { name: 'Head', kind: 'head', joints: ['c_spine0', 'c_spine1', 'c_spine2', 'c_spine3', 'c_neck', 'c_head'] },
];

// 按名字表解析:joints = 骨架索引,bodyIdx = 姿态状态序号(body.poseJoints 中的位置)。缺关节的链丢弃。
// 有 body.model(MHR)时附 flex:中间关节唯一弯曲自由度的轴与屈曲方向 { ch, sign } ——
// IK 用它当铰链轴,直腿/直臂时也不会选错弯曲平面或反关节。
export function resolveChains(body, table = MHR_CHAIN_NAMES) {
  return table.map(({ name, kind, joints }) => {
    const j = joints.map((n) => body.jointNames.indexOf(n));
    const k = j.map((x) => body.poseJoints.indexOf(x));
    if (![...j, ...k].every((x) => x >= 0)) return null;
    const chain = { name, joints: j, bodyIdx: k };
    if (kind === 'head') return body.model ? { ...chain, kind, model: body.model } : null;
    if (body.model) {
      const chans = mhrPoseChannels(body.model, j[1]);
      if (chans.length === 1) {
        const { ch, param, coef } = chans[0];
        const r = mhrParamRanges(body.model).get(param);
        const flexPositive = !r || r[1] >= -r[0];   // 主要可动方向(膝 0…160°、肘 −29…115° → 正向)
        chain.flex = { ch, sign: Math.sign(coef) * (flexPositive ? 1 : -1) };
      }
    }
    return chain;
  }).filter(Boolean);
}

// skeleton:CHAINS 的键(如 'smpl'),或已解析好的链数组(如 MHR 的 body.ikSkeleton)。
export function chainsFor(skeleton) { return Array.isArray(skeleton) ? skeleton : (CHAINS[skeleton] ?? []); }

// 按骨架关节索引查找末端对应的链。
export function endEffectorChain(skeleton, smplJointIdx) {
  return chainsFor(skeleton).find((c) => c.joints.at(-1) === smplJointIdx) ?? null;
}

// Copy the solver's ordered joint path into a packed world-space line buffer.
export function writeChainPositions(positions, chain, joints) {
  for (let i = 0; i < chain.joints.length; i++) {
    const from = chain.joints[i] * 3;
    for (let axis = 0; axis < 3; axis++) {
      const coordinate = joints[from + axis];
      if (!Number.isFinite(coordinate)) return false;
      positions[i * 3 + axis] = coordinate;
    }
  }
  return true;
}
