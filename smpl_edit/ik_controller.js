// smpl_edit/ik_controller.js
// 两段 IK 编排:拖拽开始冻结参考姿势,拖拽中从参考「绝对求解」(非增量累积)。
// 据此根治两类伪影:
//  - 拧(绕骨轴扭转):每步对冻结的参考世界朝向施加单次最短弧,不累积,无 twist 漂移。
//  - 反关节:膝/肘是铰链——拖拽开始冻结「铰链轴(两骨叉积)+ 屈伸符号」,弯曲方向
//    始终取 sign·(铰链轴 × 当前肢体方向),恒在生理一侧,接近伸直也不翻面。
// 写回 RotationState 局部四元数,复用 forwardSmpl/撤销/保存链路;不依赖 three.js。
import { solveTwoBoneIK, shortestArcQuat } from './ik_solver.js';
import { endEffectorChain } from './ik_chains.js';
import { beginHeadIK, solveHeadIK } from './ik_head.js';
import { mat3ToQuat, quatToMat3, quatConjugate, quatMultiply, quatNormalize } from '../smpl_core/rotations.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = len(a); return l < 1e-9 ? [0, 0, 0] : scale(a, 1 / l); };
const j3 = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
const m9 = (arr, i) => arr.slice(i * 9, i * 9 + 9);

export class IKController {
  constructor({ getRotation, getStore, getLastJoints, getLastWorldRot, getSkeleton, getParents, onEdit }) {
    this._getRotation = getRotation;
    this._getStore = getStore;
    this._getLastJoints = getLastJoints;
    this._getLastWorldRot = getLastWorldRot;
    this._getSkeleton = getSkeleton || (() => 'smpl');
    // parents(关节父索引数组)改为按需读取:不再由外部 setParents 推入,
    // 而是每次 beginDrag 时从 getParents() 取最新值,消除外部装配时的耦合调用点。
    this._getParents = getParents || (() => null);
    this._onEdit = onEdit;
    this._ref = null; // 拖拽参考快照(beginDrag 设置,endDrag 清空)
    this._lastPoleWorld = null;
  }

  // smplJointIdx 是否可 IK 拖动的末端;是则返回其链,否则 null。
  chainFor(smplJointIdx) { return endEffectorChain(this._getSkeleton(), smplJointIdx); }

  // 当前帧已存的 pole_vectors 映射(链名→世界点);无则 {}。
  _poleVectors() { return this._getStore().current?.()?.pole_vectors ?? {}; }

  // 读取某条链已存储的世界 pole;无则 null。
  storedPole(chainName) { return this._poleVectors()[chainName] ?? null; }

  // 自动推导弯曲方向的可视化世界点(无存储 pole 时用于摆放极向量柄):
  // chainRoot + perp0 * 上臂/大腿骨长。
  // 有真铰链(chain.flex)时用铰链给出的弯曲方向 −(a×dir),直肢时也稳定,与求解用的方向一致。
  autoPoleViz(chain) {
    if (chain.kind === 'head') return null;
    const joints = this._getLastJoints();
    const [jRoot, jMid, jEnd] = chain.joints;
    const root = j3(joints, jRoot), mid = j3(joints, jMid), end = j3(joints, jEnd);
    const upper0 = sub(mid, root);
    const dir0 = norm(sub(end, root));
    let perp0 = norm(sub(upper0, scale(dir0, dot(upper0, dir0))));
    const worldRot = this._getLastWorldRot();
    if (chain.flex && worldRot) {
      const m = m9(worldRot, jMid);
      const a = scale(norm([m[chain.flex.ch], m[3 + chain.flex.ch], m[6 + chain.flex.ch]]), chain.flex.sign);
      const b = norm(scale(cross(a, dir0), -1));
      if (len(b) > 0) perp0 = b;
    }
    const L = len(upper0);
    return [root[0] + perp0[0] * L, root[1] + perp0[1] * L, root[2] + perp0[2] * L];
  }

  // 拖拽开始:冻结参考——三关节世界坐标、肩/肘世界朝向、肩父系朝向,以及
  // 铰链轴 + 屈伸符号(防反关节)。整段拖拽都基于这份参考。
  beginDrag(chain) {
    const joints = this._getLastJoints();
    const worldRot = this._getLastWorldRot();
    const parents = this._getParents();
    if (!joints || !worldRot || !parents) { this._ref = null; return; }
    if (chain.kind === 'head') {
      const head = beginHeadIK(chain, joints, worldRot, parents, this._getRotation(), this._getStore()?.current?.());
      this._ref = head ? { chain, head } : null;
      return;
    }
    const [jRoot, jMid, jEnd] = chain.joints;
    const root = j3(joints, jRoot);
    const mid = j3(joints, jMid);
    const end = j3(joints, jEnd);
    const upper0 = sub(mid, root);
    const lower0 = sub(end, mid);
    const dir0 = norm(sub(end, root));

    // 铰链轴:两骨叉积(垂直于当前弯曲平面)。直肢退化时回退到一个稳定垂直轴。
    let hinge = cross(upper0, lower0);
    if (len(hinge) < 1e-5) {
      hinge = cross(upper0, [0, 1, 0]);
      if (len(hinge) < 1e-5) hinge = cross(upper0, [1, 0, 0]);
    }
    hinge = norm(hinge);

    // 屈伸符号:使 sign·(hinge×dir0) 与当前弯曲侧(肘/膝相对肩腕轴的偏移)同向。
    const perp0 = norm(sub(upper0, scale(dir0, dot(upper0, dir0))));
    const ref0 = cross(hinge, dir0);
    let sign = dot(perp0, ref0) >= 0 ? 1 : -1;
    // 模型给出了中间关节的真实铰链(chain.flex,MHR):铰链 = 该关节弯曲轴的世界方向 × 屈曲方向。
    // 绕 a 正向屈曲时中间关节偏向 −(a × 肢体方向),故 sign = −1。直肢时也不会选错平面/反关节。
    if (chain.flex) {
      const m = m9(worldRot, jMid);
      const a = norm([m[chain.flex.ch], m[3 + chain.flex.ch], m[6 + chain.flex.ch]]);
      if (len(a) > 0) { hinge = scale(a, chain.flex.sign); sign = -1; }
    }

    const pShoulder = parents[jRoot];
    this._ref = {
      chain, root, upper0, lower0, hinge, sign, perp0,
      midRef: mid, endRef: end,
      shoulderWorld0: mat3ToQuat(m9(worldRot, jRoot)),
      elbowWorld0: mat3ToQuat(m9(worldRot, jMid)),
      parentShoulderWorld: pShoulder >= 0 ? mat3ToQuat(m9(worldRot, pShoulder)) : [0, 0, 0, 1],
    };
  }

  endDrag() { this._ref = null; this._lastPoleWorld = null; }

  // 拖拽中:把末端拖到世界点 target。从冻结参考绝对求解,写回肩/肘局部四元数。
  // 弯曲方向 = sign·(铰链轴 × 目标方向),恒在生理一侧 → 不反关节;
  // 同一 target 重复调用结果恒定 → 无累积、无 twist 漂移。
  solveTo(target) {
    const ref = this._ref;
    const rot = this._getRotation();
    if (!ref || !rot) return;
    if (ref.head) {
      const fields = solveHeadIK(ref.head, target);
      if (fields) {
        this._getStore().applyFields(fields);
        this._onEdit();
      }
      return;
    }

    const dir = norm(sub(target, ref.root));
    // 优先用存储的人控 pole:把它投影到 ⊥dir 平面得到弯曲方向(已隐含侧别,不再乘 sign)。
    // 无存储 pole 或投影退化时,回退到原自动铰链方向 sign·(hinge×dir),再退到 perp0。
    let bend = null;
    const userPole = this.storedPole(ref.chain.name);
    if (userPole) {
      const rel = sub(userPole, ref.root);
      const proj = sub(rel, scale(dir, dot(rel, dir)));
      if (len(proj) >= 1e-5) bend = norm(proj);
    }
    if (!bend) {
      bend = cross(ref.hinge, dir);
      if (len(bend) < 1e-5) bend = ref.perp0;
      bend = scale(norm(bend), ref.sign);
    }

    const { mid: newMid, end: newEnd } = solveTwoBoneIK({
      root: ref.root, mid: ref.midRef, end: ref.endRef, target, pole: bend,
    });
    const newUpper = sub(newMid, ref.root);
    const newLower = sub(newEnd, newMid);

    // 对参考世界朝向施加「参考骨向→新骨向」最短弧:方向对齐、参考 twist 保留。
    let shoulderWorldNew = quatNormalize(quatMultiply(shortestArcQuat(ref.upper0, newUpper), ref.shoulderWorld0));
    let elbowWorldNew = quatNormalize(quatMultiply(shortestArcQuat(ref.lower0, newLower), ref.elbowWorld0));
    // 真铰链(chain.flex):上段的旋转要把铰链轴也带到新弯曲平面的法向上,否则中间关节的单轴屈伸够不到目标。
    // 用 (骨向, 铰链⊥骨向) 两组正交基对齐求上段旋转,下段再绕新铰链补齐。
    if (ref.chain.flex) {
      const n = cross(newUpper, newLower);
      if (len(n) > 1e-6) {
        const frame = (u, h) => { const x = norm(u); const y = norm(sub(h, scale(x, dot(h, x)))); return [x, y, cross(x, y)]; };
        const h1 = dot(n, ref.hinge) >= 0 ? n : scale(n, -1);
        const F0 = frame(ref.upper0, ref.hinge), F1 = frame(newUpper, h1);
        // R = F1·F0ᵀ(列为基向量)→ 四元数
        const R = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => F1[0][r] * F0[0][c] + F1[1][r] * F0[1][c] + F1[2][r] * F0[2][c]));
        const qR = mat3ToQuat(R);
        shoulderWorldNew = quatNormalize(quatMultiply(qR, ref.shoulderWorld0));
        const lowerRot = (q, v) => { const m = quatToMat3(q); return [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]); };
        elbowWorldNew = quatNormalize(quatMultiply(shortestArcQuat(lowerRot(qR, ref.lower0), newLower), quatMultiply(qR, ref.elbowWorld0)));
      }
    }

    // 世界朝向 → 局部:肩父系冻结;肘父系是(已转动的)肩新世界朝向。
    const shoulderLocal = quatNormalize(quatMultiply(quatConjugate(ref.parentShoulderWorld), shoulderWorldNew));
    const elbowLocal = quatNormalize(quatMultiply(quatConjugate(shoulderWorldNew), elbowWorldNew));

    rot.setJointQuat(ref.chain.bodyIdx[0], shoulderLocal);
    rot.setJointQuat(ref.chain.bodyIdx[1], elbowLocal);
    this._getStore().applyFields(rot.toAxisAngle());
    this._onEdit();
  }

  // ── 极向量拖拽 ──────────────────────────────────────────────────────────
  // 末端锁定、仅旋转弯折平面:整条肢体绕(根→末端)轴刚性旋转。只改根关节(肩/髋)
  // 局部四元数;中/末端局部保持不变,由 FK 刚性带动。这是「末端固定、换极向量
  // 重解」的解析形式。
  beginPoleDrag(chain) {
    this.beginDrag(chain); // 复用同一份冻结参考(根/upper0/dir/肩父系朝向)
  }

  // worldPole:极向量手柄被拖到的世界坐标点。
  solveToPole(worldPole) {
    const ref = this._ref;
    const rot = this._getRotation();
    if (!ref || !rot || ref.head) return;

    const dir = norm(sub(ref.endRef, ref.root));         // 冻结的 根→末端 轴
    const oldBend = ref.perp0;                            // 冻结的弯折方向(⊥ dir)
    // 新弯折方向 = 极向量在 ⊥ dir 平面上的投影。
    const rel = sub(worldPole, ref.root);
    let newBend = sub(rel, scale(dir, dot(rel, dir)));
    if (len(newBend) < 1e-6) return;                      // 极向量与轴共线 → 忽略本步
    newBend = norm(newBend);

    // 绕 dir 把 oldBend 旋到 newBend 的刚性旋转(两者均 ⊥ dir,故最短弧为绕 dir 的纯旋转)。
    const R = shortestArcQuat(oldBend, newBend);
    const shoulderWorldNew = quatNormalize(quatMultiply(R, ref.shoulderWorld0));
    const shoulderLocal = quatNormalize(quatMultiply(quatConjugate(ref.parentShoulderWorld), shoulderWorldNew));

    rot.setJointQuat(ref.chain.bodyIdx[0], shoulderLocal); // 只改根关节;肘/腕不动
    this._lastPoleWorld = worldPole.slice();
    this._getStore().applyFields(rot.toAxisAngle());
    this._onEdit();
  }

  endPoleDrag() {
    const ref = this._ref;
    if (ref && this._lastPoleWorld) {
      this._getStore().applyFields({ pole_vectors: { ...this._poleVectors(), [ref.chain.name]: this._lastPoleWorld } });
    }
    this._lastPoleWorld = null;
    this._ref = null;
  }
}
