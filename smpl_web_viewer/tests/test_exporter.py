import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from tools.export_smpl_model import add_array, write_asset


class ExporterTest(unittest.TestCase):
    def test_add_array_records_offsets_in_bytes(self):
        meta = {"arrays": {}}
        f32 = bytearray()
        i32 = bytearray()

        add_array(meta, f32, i32, "v_template", np.array([[1, 2, 3]], dtype=np.float32))
        add_array(meta, f32, i32, "faces", np.array([[0, 1, 2]], dtype=np.int32))

        self.assertEqual(meta["arrays"]["v_template"]["offset"], 0)
        self.assertEqual(meta["arrays"]["v_template"]["shape"], [1, 3])
        self.assertEqual(meta["arrays"]["v_template"]["dtype"], "float32")
        self.assertEqual(len(f32), 12)
        self.assertEqual(meta["arrays"]["faces"]["offset"], 0)
        self.assertEqual(meta["arrays"]["faces"]["dtype"], "int32")
        self.assertEqual(len(i32), 12)

    def test_write_asset_outputs_meta_and_bins(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)

            write_asset(
                out,
                {
                    "v_template": np.zeros((2, 3), dtype=np.float32),
                    "faces": np.array([[0, 1, 2]], dtype=np.int32),
                    "parents": np.array([-1, 0], dtype=np.int32),
                },
            )

            meta = json.loads((out / "smpl_neutral.meta.json").read_text())
            self.assertEqual(meta["schema"], "smpl-web-model-v1")
            self.assertTrue((out / "smpl_neutral.f32.bin").exists())
            self.assertTrue((out / "smpl_neutral.i32.bin").exists())


if __name__ == "__main__":
    unittest.main()
