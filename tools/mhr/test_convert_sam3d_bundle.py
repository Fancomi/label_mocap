import unittest

import numpy as np

from convert_sam3d_bundle import F, ROOT_REST_M, euler_xyz_mat, fields_from_row, mat_to_axis_angle, pair


def axis_angle_mat(v):
    a = np.linalg.norm(v)
    if a < 1e-12:
        return np.eye(3)
    k = v / a
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(a) * K + (1 - np.cos(a)) * K @ K


def random_rotation(rng):
    q, _ = np.linalg.qr(rng.normal(size=(3, 3)))
    return q * np.sign(np.linalg.det(q))


class ConvertTest(unittest.TestCase):
    def test_axis_angle_round_trip_including_near_pi(self):
        rng = np.random.default_rng(0)
        for v in [rng.normal(size=3), np.array([np.pi - 1e-8, 0, 0]), np.array([0, 0, 1e-12])]:
            R = axis_angle_mat(v)
            np.testing.assert_allclose(axis_angle_mat(mat_to_axis_angle(R)), R, atol=1e-6)

    def test_world_body_equals_rotation_about_pelvis(self):
        # 包内几何:X_upright = F·(R_root·(p − rest) + rest) + cam_t(p 为模型系、米、零平移)。
        # 导入后:X_world = rotmat(root_rota)·(p − rest) + root_pos。两者经外参必须一致。
        rng = np.random.default_rng(1)
        r_nc = random_rotation(rng)
        r_nu = np.array([[0.0, 1, 0], [-1, 0, 0], [0, 0, 1]])
        cam = {'R_native_from_common': r_nc, 't_native_from_common_m': rng.normal(size=3),
               'upright': {'R_native_camera_from_upright_camera': r_nu}}
        mp = np.zeros(204)
        mp[3:6] = rng.normal(size=3)
        cam_t = np.array([0.3, 1.2, 4.0])
        f = fields_from_row(cam, mp, np.zeros(45), cam_t)
        M = F @ r_nc.T @ r_nu
        m = -F @ r_nc.T @ cam['t_native_from_common_m']
        R_root = euler_xyz_mat(mp[3:6])
        for p in rng.normal(size=(5, 3)):
            upright = F @ (R_root @ (p - ROOT_REST_M) + ROOT_REST_M) + cam_t
            expected = M @ upright + m
            got = axis_angle_mat(np.array(f['root_rota'])) @ (p - ROOT_REST_M) + np.array(f['root_pos'])
            np.testing.assert_allclose(got, expected, atol=1e-9)

    def test_parameter_slices(self):
        mp = np.arange(204, dtype=float)
        cam = {'R_native_from_common': np.eye(3), 't_native_from_common_m': np.zeros(3),
               'upright': {'R_native_camera_from_upright_camera': np.eye(3)}}
        f = fields_from_row(cam, mp, np.ones(45), np.zeros(3))
        self.assertEqual(f['mhr_pose'][0], 6)
        self.assertEqual(len(f['mhr_pose']), 130)
        self.assertEqual(f['mhr_scale'][0], 136)
        self.assertEqual(len(f['mhr_scale']), 68)

    def test_pair_nearest_exposure_within_half_frame(self):
        t_main = np.array([0.0, 1 / 30, 2 / 30, 10.0])
        t_side = np.arange(0, 3, 1 / 60) + 0.148
        got = pair(t_main, t_side, 60)
        self.assertEqual(got[3], None)                      # 超出侧机覆盖
        self.assertEqual(got[0], None)                      # 侧机还没开始(差 148ms)
        self.assertEqual(got[1], int(round((1 / 30 - 0.148) * 60)) if 1 / 30 >= 0.148 else None)
        self.assertEqual(pair(np.array([0.5]), t_side, 60), [int(np.argmin(np.abs(t_side - 0.5)))])


if __name__ == '__main__':
    unittest.main()
