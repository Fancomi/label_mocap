"""MHR 前向的纯 numpy 参考实现(离线工具,不进运行时)。

用途:浏览器端 JS 前向的「对照真值」—— 只依赖 MHR 官方 TorchScript 里的张量,
逐步骤复刻 model_params → joint_params → skeleton state → 姿态修正 → LBS。
自检: python tools/mhr/mhr_reference.py --model <assets>/mhr_model.pt
(需要 torch;JS 端移植时以本文件为准逐行对照。)
"""
import argparse
import warnings

import numpy as np

N_JOINTS = 127
N_IDENTITY = 45


def load(model_pt):
    import torch
    warnings.filterwarnings('ignore')
    m = torch.jit.load(model_pt, map_location='cpu')
    ct = m.character_torch
    g = lambda t: t.detach().numpy().astype(np.float64)
    pc = m.pose_correctives_model.pose_dirs_predictor
    l0, l2 = getattr(pc, '0'), getattr(pc, '2')
    return {
        'module': m,
        'parameter_transform': g(ct.parameter_transform.parameter_transform),  # (127*7, 204+45)
        'parameter_names': list(ct.parameter_transform.parameter_names),
        'joint_names': list(ct.skeleton.joint_names),
        'parents': ct.skeleton.joint_parents.numpy().astype(np.int64),
        'offsets': g(ct.skeleton.joint_translation_offsets),
        'prerotations': g(ct.skeleton.joint_prerotations),                       # [x,y,z,w]
        'base_shape': g(ct.blend_shape.base_shape),
        'identity_vectors': g(ct.blend_shape.shape_vectors),
        'expr_vectors': g(m.face_expressions_model.shape_vectors),
        'inverse_bind_pose': g(ct.linear_blend_skinning.inverse_bind_pose),      # (127, 8) t,q,s
        'skin_joint': ct.linear_blend_skinning.skin_indices_flattened.numpy().astype(np.int64),
        'skin_weight': g(ct.linear_blend_skinning.skin_weights_flattened),
        'skin_vert': ct.linear_blend_skinning.vert_indices_flattened.numpy().astype(np.int64),
        'corr_l0_index': l0.sparse_indices.numpy().astype(np.int64),            # (2, nnz) [hidden, feature]
        'corr_l0_weight': g(l0.sparse_weight),
        'corr_l2_weight': g(l2.weight),                                         # (V*3, hidden)
        'faces': ct.mesh.faces.numpy(),
        'limit_param': ct.parameter_limits.minmax_parameter_index.numpy().astype(np.int64),   # model_params 索引
        'limit_min': g(ct.parameter_limits.minmax_min),
        'limit_max': g(ct.parameter_limits.minmax_max),
    }


def qmul(a, b):
    x1, y1, z1, w1 = a
    x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                     w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                     w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
                     w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])


def qrot(q, v):
    r, a = q[3], q[:3]
    av = np.cross(a, v)
    return v + 2 * (av * r + np.cross(a, av))


def euler_xyz_to_quat(e):
    # 与 pymomentum.quaternion.euler_xyz_to_quaternion 相同:R = Rz·Ry·Rx
    r, p, y = e
    cy, sy = np.cos(y / 2), np.sin(y / 2)
    cp, sp = np.cos(p / 2), np.sin(p / 2)
    cr, sr = np.cos(r / 2), np.sin(r / 2)
    return np.array([sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy,
                     cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy])


def state_mul(a, b):
    """相似变换 (t, q, s) 复合:a ∘ b。"""
    return (a[0] + a[2] * qrot(a[1], b[0]), qmul(a[1], b[1]), a[2] * b[2])


def pose_features(joint_params):
    """姿态修正网络输入:去掉前两个关节,每关节 XYZ 欧拉 → 旋转矩阵前两列(列主序),对角减 1。"""
    e = joint_params[2:, 3:6]
    c, s = np.cos(e), np.sin(e)
    cx, cy, cz, sx, sy, sz = c[:, 0], c[:, 1], c[:, 2], s[:, 0], s[:, 1], s[:, 2]
    return np.stack([cy * cz - 1, cy * sz, -sy,
                     -cx * sz + sx * sy * cz, cx * cz + sx * sy * sz - 1, sx * cy], -1).reshape(-1)


def forward(M, identity, model_params, expr=None, correctives=True):
    """返回 (vertices (V,3) cm, joints (127,3) cm, joint_global_quats (127,4)),MHR 模型系(Y 上、厘米)。"""
    expr = np.zeros(M['expr_vectors'].shape[0]) if expr is None else expr
    jp = (M['parameter_transform'] @ np.concatenate([model_params, np.zeros(N_IDENTITY)])).reshape(N_JOINTS, 7)
    glob = []
    for j in range(N_JOINTS):
        q = qmul(M['prerotations'][j], euler_xyz_to_quat(jp[j, 3:6]))
        local = (jp[j, :3] + M['offsets'][j], q / np.linalg.norm(q), 2.0 ** jp[j, 6])
        p = M['parents'][j]
        glob.append(local if p < 0 else state_mul(glob[p], local))
    rest = (M['base_shape'] + np.einsum('nvd,n->vd', M['identity_vectors'], identity)
            + np.einsum('nvd,n->vd', M['expr_vectors'], expr))
    if correctives:
        hidden = np.zeros(M['corr_l2_weight'].shape[1])
        rows, cols = M['corr_l0_index']
        np.add.at(hidden, rows, M['corr_l0_weight'] * pose_features(jp)[cols])
        rest = rest + (M['corr_l2_weight'] @ np.maximum(hidden, 0)).reshape(-1, 3)
    ibp = M['inverse_bind_pose']
    skin = [state_mul(glob[j], (ibp[j, :3], ibp[j, 3:7] / np.linalg.norm(ibp[j, 3:7]), ibp[j, 7]))
            for j in range(N_JOINTS)]
    verts = np.zeros_like(rest)
    for j, w, v in zip(M['skin_joint'], M['skin_weight'], M['skin_vert']):
        t, q, s = skin[j]
        verts[v] += w * (t + s * qrot(q, rest[v]))
    return verts, np.array([g[0] for g in glob]), np.array([g[1] for g in glob])


def _self_check(model_pt):
    import torch
    M = load(model_pt)
    rng = np.random.default_rng(0)
    identity = rng.normal(0, 1, N_IDENTITY)
    expr = rng.uniform(-0.3, 0.3, M['expr_vectors'].shape[0])
    mp = np.zeros(204)
    mp[3:136] = rng.normal(0, 0.3, 133)
    mp[136:] = rng.normal(0, 0.1, 68)
    for corr in (False, True):
        v, j, _ = forward(M, identity, mp, expr, corr)
        f = lambda a: torch.tensor(a[None], dtype=torch.float32)
        tv, ts = M['module'](f(identity), f(mp), f(expr), corr)
        print(f'correctives={corr}: max |Δvert| {np.abs(v - tv[0].numpy()).max():.5f} cm, '
              f'max |Δjoint| {np.abs(j - ts[0, :, :3].numpy()).max():.5f} cm')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True, help='MHR 官方 assets/mhr_model.pt')
    _self_check(ap.parse_args().model)
