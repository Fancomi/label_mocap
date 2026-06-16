# SMPL 标注器 IK 关节调整 — 设计文档

- 日期: 2026-06-16
- 状态: 设计已与用户逐节确认,待评审
- 分支: `feat-ik-joint-drag`
- 范围: 在标注器姿势编辑中新增 IK(逆运动学)拖拽 —— 拖动末端关节(腕/踝),自动反解中间关节朝向。骨骼无关设计,为将来 SMPLX/MHR/SKEL 预留。

## 1. 背景与目标

现有姿势编辑是逐关节旋转 gizmo(M2/M3)。用户想"把手腕/脚踝拖到图上某个位置",逐关节调很费力。IK 让用户直接拖末端,程序反解肩-肘 / 髋-膝的朝向。

设计文档 spec 最初(2026-06-12)把 IK 列为 v2 非目标;本次正式实现,作为姿势编辑的增强,复用现有旋转内核与撤销/保存链路。

### 非目标(本次不做)

- 显式肘/膝朝向控制(用自动 pole 即可)
- FABRIK 等长链迭代 IK(两段解析足够覆盖四肢;长链留将来)
- 脊柱/手指 IK
- 多人

### 工程化原则

- IK 求解器与骨骼/three.js 完全解耦,纯函数可测
- 骨骼差异收敛到一份配置,换骨骼不改求解器/控制器
- 写回唯一源头 `RotationState`,复用 `forwardSmpl` 驱动与撤销/保存

## 2. 架构(骨骼无关三层)

```
label/src/edit/
├── ik_solver.js      # 纯数学:两段解析 IK + pole。零 three.js / 零 SMPL
├── ik_chains.js      # 骨骼配置:每种骨骼的肢体链 + 末端关节集合
└── ik_controller.js  # 编排:拖拽 → 取链 → 解 → 写回 RotationState(浏览器)
```

### 2.1 `ik_solver.js`(纯函数,可单测)

```
solveTwoBoneIK({ root, mid, end, target, pole }) → { upperQuat, lowerAngle }
```
- 输入:root/mid/end/target/pole 均为三维点(数组 `[x,y,z]`),世界系
- `upperQuat`:根段(肩)应有的世界朝向四元数 `[x,y,z,w]`,使肢体平面朝向 target 且过 pole
- `lowerAngle`:中段关节(肘)的弯曲角(弧度),由余弦定理:`acos((a²+b²−d²)/(2ab))`,a=上臂长、b=前臂长、d=clamp 后的根到目标距离
- 完全不认识 SMPL,对任何两段肢体成立

### 2.2 `ik_chains.js`(骨骼描述,扩展点)

```
IK_CHAINS = {
  smpl: [
    { name:'L_Arm', joints:[16,18,20], bodyIdx:[15,17,19] },  // 肩肘腕 SMPL索引 + body_pose索引
    { name:'R_Arm', joints:[17,19,21], bodyIdx:[16,18,20] },
    { name:'L_Leg', joints:[1,4,7],    bodyIdx:[0,3,6] },
    { name:'R_Leg', joints:[2,5,8],    bodyIdx:[1,4,7] },
  ],
  // 将来:smplx:[...], skel:[...] —— 只加配置
}
export function chainsFor(skeleton)        // 返回该骨骼的链数组
export function endEffectorJoint(skeleton, smplJointIdx)  // 该 SMPL 关节是否某链末端,是则返回其链
```
- `joints` 是 SMPL 24 关节索引(世界坐标取 `lastJoints`);`bodyIdx` 是 body_pose 的 21 索引(写回 `RotationState.setJointQuat` 用)
- 注意:SMPL body_pose 索引 = SMPL 关节索引 − 1(关节 0 是 root)
- 换骨骼 = 加一份链定义,solver/controller 不动

### 2.3 `ik_controller.js`(编排,浏览器)

持有回调(getRotation/getStore/getCam/getLastJoints/getLastWorldRot/onEdit),不 import app 单例。职责:
- 判定一个被拖的关节是否末端(查 `endEffectorJoint`)
- 拖拽中:算 target → 取链三关节世界坐标 → `solveTwoBoneIK` → 世界朝向换算成肩/肘**局部四元数** → `setJointQuat` 写回 → `onEdit()`
- 一次拖拽 = 一个撤销单元(begin/commit,复用 store 事务)

## 3. 数据流

```
拖末端关节(腕/踝)
  → 算 target(3D 点;3D 与 2D 两种来源,见 §4)
  → 取该链三关节当前世界坐标(肩/肘/腕)← getLastJoints()
  → solveTwoBoneIK → upperQuat(世界) + lowerAngle
  → 世界→局部:肩局部 q = qParentWorld⁻¹·upperQuat;肘局部 q = 绕弯曲轴 lowerAngle
  → RotationState.setJointQuat(bodyIdx[0], 肩局部)、setJointQuat(bodyIdx[1], 肘局部)
  → onEdit → forwardSmpl → 场景刷新(现有 applyAnnotation 链路)
```

世界→局部换算复用 pose gizmo 已验证的机制:用上次 `forwardSmpl({worldRot:true})` 输出的父关节世界旋转,`q_local = mat3ToQuat(parentWorldRot)⁻¹ · q_world`。

## 4. 3D 与 2D 拖拽

### 3D 自由视角
末端关节挂平移 gizmo(复用 TransformControls translate,类似 RootHandle)。拖出的代理 3D 位置即 `target`。

### 2D 对齐视角
图像平面拖末端关节:屏幕点 → 反投影到"末端关节当前深度的平面"得到 target —— x/y 跟手,**深度(沿视线)锁定为该关节当前深度值**。因为 2D 正对视角下深度方向退化(投影成点),与之前 root 深度手柄同一处理逻辑,保持一致。

## 5. 自动 pole(弯曲平面保持)

两段 IK 有"肘往哪弯"的多解。pole 取**当前姿势下肘相对'肩-腕连线'的垂直偏移方向**:
```
pole = mid − (root + proj(mid−root onto (end−root)))   // 肘到肩腕轴的垂足指向肘
```
拖动中用这个 pole 定弯曲平面,肘不突然翻面;若 pole 退化(肘恰在肩腕轴上,如肢体伸直),回退到一个稳定的默认轴(如上一帧 pole 或肢体局部 X)。

## 6. 入口与互斥

姿势 Tab 加「IK 拖拽」开关(`#ik-toggle`):
- **开**:拖**末端关节**(腕/踝,由 `endEffectorJoint` 判定)→ IK 反解;选中间关节仍可单关节旋转
- **关**:全部走原来的单关节旋转 gizmo
- IK gizmo 引擎时锁 OrbitControls,复用渲染循环每帧 `isEngaged()` 门控
- 与 root/bbox/beta 的互斥沿用 UIController 现状(IK 是姿势模式内的子开关,不新增 Tab)

## 7. 错误处理

- **目标不可达**(d > a+b):d clamp 到 a+b,肘伸直(角=π),肢体指向目标,不报错
- **目标过近**(d < |a−b|):d clamp 到 |a−b|,肘最大弯曲,无 NaN
- **退化**(肩腕重合 d≈0、或臂长为 0):跳过解算保持原姿势,不崩
- **pole 退化**:回退默认轴(§5)

## 8. 测试

`ik_solver.test.js`(纯函数):
- 可达点:反解后正向验证末端命中 target(误差 < 1e-4)
- 不可达:伸直,末端落在 target 方向上、距离 = a+b
- 过近:clamp,无 NaN,角度在合法域
- pole:给定 pole,肘落在期望弯曲平面一侧
- 退化:肩腕重合 / 零臂长不抛错

`ik_chains.test.js`(配置):
- `chainsFor('smpl')` 返回 4 条链,joints/bodyIdx 维度正确(各 3 项)
- `endEffectorJoint('smpl', 20)`(L_Wrist)命中 L_Arm 链;非末端(如肘 18)返回 null
- bodyIdx === joints − 1 一致性

`ik_controller` 走手动验证(浏览器 + three.js)。

## 9. 文件清单

- 新增:`label/src/edit/ik_solver.js`、`ik_chains.js`、`ik_controller.js`
- 新增测试:`label/tests/ik_solver.test.js`、`ik_chains.test.js`
- 修改:`label/src/app.js`(接线 IK 开关 + 末端拖拽,复用 worldRot/换算)
- 修改:`label/index.html`(姿势 Tab 加 `#ik-toggle`)
- 复用:`smpl_core/rotations.js`(mat3ToQuat/quatConjugate/quatMultiply/axisAngleToQuat)、`RotationState`、`forwardSmpl({worldRot:true})`

## 10. 扩展性(SMPLX/MHR/SKEL)

- 求解器与骨骼无关,加新骨骼 = 在 `IK_CHAINS` 加一份链定义(关节索引 + body_pose 索引)
- `endEffectorJoint`/`chainsFor` 按 `skeleton` 名查表,controller/solver 一行不改
- 当前 `skeleton` 固定 `'smpl'`;将来由加载的模型类型决定,留参数位
