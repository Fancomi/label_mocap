import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from tools.export_reference_mesh import export_reference_mesh, forward_smpl_numpy


def tiny_model():
    return {
        "v_template": np.array([[0, 0, 0], [1, 0, 0]], dtype=np.float32),
        "shapedirs": np.zeros((2, 3, 1), dtype=np.float32),
        "posedirs": np.zeros((9, 6), dtype=np.float32),
        "J_regressor": np.array([[0, 1]], dtype=np.float32),
        "weights": np.array([[1], [1]], dtype=np.float32),
        "faces": np.array([[0, 1, 0]], dtype=np.int32),
        "parents": np.array([-1], dtype=np.int32),
    }


def tiny_frame(frame=0):
    return {
        "frame": frame,
        "root_pos": [10, 20, 30],
        "root_rota": [0, 0, 0],
        "body_pose": [],
        "betas": [0],
    }


class ReferenceMeshTest(unittest.TestCase):
    def test_forward_smpl_numpy_centers_root_joint_on_root_pos(self):
        out = forward_smpl_numpy(tiny_model(), tiny_frame())

        np.testing.assert_allclose(out["joints"], [[10, 20, 30]], atol=1e-6)
        np.testing.assert_allclose(out["vertices"], [[9, 20, 30], [10, 20, 30]], atol=1e-6)

    def test_export_reference_mesh_writes_meta_and_f32_vertices(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            frames = [tiny_frame(6), tiny_frame(7)]

            export_reference_mesh(tiny_model(), frames, out_dir)

            meta = json.loads((out_dir / "python_ref_mesh.meta.json").read_text())
            data = np.fromfile(out_dir / "python_ref_mesh.f32.bin", dtype="<f4")

            self.assertEqual(meta["schema"], "smpl-web-debug-reference-mesh-v1")
            self.assertEqual(meta["frameCount"], 2)
            self.assertEqual(meta["vertexCount"], 2)
            self.assertEqual(meta["itemSize"], 3)
            self.assertEqual(meta["frames"], [6, 7])
            self.assertEqual(data.size, 2 * 2 * 3)
            np.testing.assert_allclose(data.reshape(2, 2, 3)[0], [[9, 20, 30], [10, 20, 30]])


if __name__ == "__main__":
    unittest.main()
