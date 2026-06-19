// smpl_edit/ik_chains.js
// 骨骼无关的肢体链配置。joints = SMPL 24 关节索引(世界坐标取 lastJoints);
// bodyIdx = body_pose 21 索引(= 关节索引 − 1,关节 0 是 root,不在 body_pose)。
// 换骨骼只在此表加一项,solver/controller 不动。
const CHAINS = {
  smpl: [
    { name: 'L_Arm', joints: [16, 18, 20], bodyIdx: [15, 17, 19] },
    { name: 'R_Arm', joints: [17, 19, 21], bodyIdx: [16, 18, 20] },
    { name: 'L_Leg', joints: [1, 4, 7], bodyIdx: [0, 3, 6] },
    { name: 'R_Leg', joints: [2, 5, 8], bodyIdx: [1, 4, 7] },
  ],
};

export function chainsFor(skeleton) { return CHAINS[skeleton] ?? []; }

// 给定 SMPL 关节索引,若它是某链末端(第 3 个关节),返回该链;否则 null。
export function endEffectorChain(skeleton, smplJointIdx) {
  return chainsFor(skeleton).find((c) => c.joints[2] === smplJointIdx) ?? null;
}
