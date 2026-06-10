import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

import numpy as np

from tools import export_smpl_model
from tools.export_smpl_model import add_array, write_asset


class ExporterTest(unittest.TestCase):
    def test_add_array_records_offsets_in_bytes(self):
        meta = {"arrays": {}}
        f32 = bytearray()
        i32 = bytearray()

        add_array(meta, f32, i32, "v_template", np.array([[1, 2, 3]], dtype=np.float32))
        add_array(meta, f32, i32, "faces", np.array([[0, 1, 2]], dtype=np.int32))
        add_array(meta, f32, i32, "weights", np.array([[4, 5]], dtype=np.float64))
        add_array(meta, f32, i32, "parents", np.array([-1, 0, 1, 2], dtype=np.int64))

        self.assertEqual(meta["arrays"]["v_template"]["offset"], 0)
        self.assertEqual(meta["arrays"]["v_template"]["shape"], [1, 3])
        self.assertEqual(meta["arrays"]["v_template"]["dtype"], "float32")
        self.assertEqual(meta["arrays"]["v_template"]["length"], 3)
        self.assertEqual(meta["arrays"]["v_template"]["bin"], "smpl_neutral.f32.bin")
        self.assertEqual(meta["arrays"]["faces"]["offset"], 0)
        self.assertEqual(meta["arrays"]["faces"]["dtype"], "int32")
        self.assertEqual(meta["arrays"]["faces"]["length"], 3)
        self.assertEqual(meta["arrays"]["faces"]["bin"], "smpl_neutral.i32.bin")
        self.assertEqual(meta["arrays"]["weights"]["offset"], 12)
        self.assertEqual(meta["arrays"]["weights"]["length"], 2)
        self.assertEqual(meta["arrays"]["parents"]["offset"], 12)
        self.assertEqual(meta["arrays"]["parents"]["length"], 4)
        self.assertEqual(len(f32), 20)
        self.assertEqual(len(i32), 28)
        self.assertEqual(
            bytes(f32),
            b"\x00\x00\x80?\x00\x00\x00@\x00\x00@@\x00\x00\x80@\x00\x00\xa0@",
        )
        self.assertEqual(
            bytes(i32),
            b"\x00\x00\x00\x00\x01\x00\x00\x00\x02\x00\x00\x00"
            b"\xff\xff\xff\xff\x00\x00\x00\x00\x01\x00\x00\x00\x02\x00\x00\x00",
        )

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

    def test_dense_returns_ndarray_input_without_scipy(self):
        arr = np.array([[1, 2], [3, 4]], dtype=np.float32)

        dense = export_smpl_model._dense(arr)

        self.assertIs(dense, arr)

    def test_compat_csc_matrix_restores_dense_array_from_pickle_state(self):
        sparse = export_smpl_model._CompatCscMatrix()
        sparse.__setstate__(
            {
                "_shape": (3, 2),
                "data": np.array([1.0, 2.0, 3.0], dtype=np.float64),
                "indices": np.array([0, 2, 1], dtype=np.int32),
                "indptr": np.array([0, 2, 3], dtype=np.int32),
            }
        )

        dense = sparse.todense()

        np.testing.assert_array_equal(
            dense,
            np.array([[1.0, 0.0], [0.0, 3.0], [2.0, 0.0]], dtype=np.float64),
        )

    def test_compat_csc_matrix_accumulates_duplicate_sparse_entries(self):
        sparse = export_smpl_model._CompatCscMatrix()
        sparse.__setstate__(
            {
                "_shape": (2, 1),
                "data": np.array([1.0, 2.0], dtype=np.float64),
                "indices": np.array([0, 0], dtype=np.int32),
                "indptr": np.array([0, 2], dtype=np.int32),
            }
        )

        dense = sparse.todense()

        np.testing.assert_array_equal(dense, np.array([[3.0], [0.0]], dtype=np.float64))

    def test_compat_chumpy_array_converts_x_state_to_ndarray(self):
        chumpy_array = export_smpl_model._CompatChumpyArray()
        payload = np.arange(12, dtype=np.float64).reshape(2, 3, 2)
        chumpy_array.__setstate__({"x": payload, "_dirty_vars": set(), "_itr": None})

        dense = export_smpl_model._dense(chumpy_array)

        np.testing.assert_array_equal(dense, payload)

    def test_pickle_compat_modules_restores_missing_import_state(self):
        module_names = [
            "scipy",
            "scipy.sparse",
            "scipy.sparse.csc",
            "chumpy",
            "chumpy.ch",
        ]
        missing = object()
        saved = {name: sys.modules.get(name, missing) for name in module_names}

        try:
            for name in module_names:
                sys.modules.pop(name, None)

            def fail_optional_import(module_name):
                if module_name in ("scipy.sparse.csc", "chumpy.ch"):
                    exc = ModuleNotFoundError(f"No module named {module_name!r}")
                    exc.name = module_name
                    raise exc
                return __import__(module_name)

            with patch(
                "tools.export_smpl_model.importlib.import_module",
                side_effect=fail_optional_import,
            ):
                with export_smpl_model._pickle_compat_modules():
                    self.assertIs(
                        sys.modules["scipy.sparse.csc"].csc_matrix,
                        export_smpl_model._CompatCscMatrix,
                    )
                    self.assertIs(
                        sys.modules["chumpy.ch"].Ch,
                        export_smpl_model._CompatChumpyArray,
                    )

            for name in module_names:
                self.assertNotIn(name, sys.modules)
        finally:
            for name, module in saved.items():
                if module is missing:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = module

    def test_cli_reports_expected_errors_without_traceback(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "missing.pkl"
            stderr = io.StringIO()

            with patch(
                "sys.argv",
                [
                    "export_smpl_model.py",
                    "--pkl",
                    str(missing),
                    "--out",
                    str(Path(tmp) / "models"),
                ],
            ):
                with redirect_stderr(stderr), self.assertRaises(SystemExit) as cm:
                    export_smpl_model.main()

        self.assertEqual(cm.exception.code, 2)
        self.assertIn("error:", stderr.getvalue())
        self.assertIn("missing.pkl", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())

    def test_cli_reports_empty_pickle_without_traceback(self):
        with tempfile.TemporaryDirectory() as tmp:
            empty_pkl = Path(tmp) / "empty.pkl"
            empty_pkl.write_bytes(b"")
            stderr = io.StringIO()

            with patch(
                "sys.argv",
                [
                    "export_smpl_model.py",
                    "--pkl",
                    str(empty_pkl),
                    "--out",
                    str(Path(tmp) / "models"),
                ],
            ):
                with redirect_stderr(stderr), self.assertRaises(SystemExit) as cm:
                    export_smpl_model.main()

        self.assertEqual(cm.exception.code, 2)
        self.assertIn("error:", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
