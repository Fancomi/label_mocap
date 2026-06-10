import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.convert_sequence import convert_records, image_name
from tools import make_sample_assets


def valid_record(**overrides):
    record = {
        "frame": 7,
        "root_pos": [1, 2, 3],
        "root_rota": [0.1, 0.2, 0.3],
        "body_pose": [0.0] * 63,
        "betas": [0.0] * 10,
    }
    record.update(overrides)
    return record


class SequenceConverterTest(unittest.TestCase):
    def test_convert_records_keeps_smpl_params_only(self):
        records = [
            valid_record(left_hand_pose=[9.0])
        ]

        out = convert_records("sample/a1", records, "./images/a1/")

        frame = out["frames"][0]
        self.assertEqual(out["schema"], "smpl-web-sequence-v1")
        self.assertEqual(frame["frame"], 7)
        self.assertNotIn("left_hand_pose", frame)
        self.assertEqual(len(frame["body_pose"]), 63)
        self.assertEqual(len(frame["betas"]), 10)

    def test_image_name_formats_four_digits(self):
        self.assertEqual(image_name("%04d.jpg", 12), "0012.jpg")

    def test_convert_records_rejects_wrong_length(self):
        with self.assertRaisesRegex(ValueError, "body_pose.*length 63"):
            convert_records("sample/a1", [valid_record(body_pose=[0.0] * 62)], "./images/")

    def test_convert_records_rejects_missing_field(self):
        record = valid_record()
        del record["root_pos"]

        with self.assertRaisesRegex(ValueError, "root_pos.*length 3"):
            convert_records("sample/a1", [record], "./images/")

    def test_convert_records_rejects_nan_and_infinity(self):
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "root_pos.*finite"):
                    convert_records("sample/a1", [valid_record(root_pos=[value, 0, 0])], "./images/")

    def test_convert_records_rejects_non_integer_and_bool_frames(self):
        for frame in (1.9, True, False):
            with self.subTest(frame=frame):
                with self.assertRaisesRegex(ValueError, "frame.*integer"):
                    convert_records("sample/a1", [valid_record(frame=frame)], "./images/")

    def test_convert_records_accepts_integer_float_frame(self):
        out = convert_records("sample/a1", [valid_record(frame=12.0)], "./images/")

        self.assertEqual(out["frames"][0]["frame"], 12)

    def test_make_sample_assets_uses_sequence_relative_image_urls(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source = tmp_path / "source"
            out_dir = tmp_path / "samples"

            for actor in ("a1", "a2", "a3", "a4"):
                pose_dir = source / "a" / actor / "pose_files"
                pose_dir.mkdir(parents=True)
                (pose_dir / f"{actor}.json").write_text(
                    json.dumps({"records": [valid_record(frame=0)]}),
                    encoding="utf8",
                )

            with patch.object(
                sys,
                "argv",
                [
                    "make_sample_assets.py",
                    "--source",
                    str(source),
                    "--out",
                    str(out_dir),
                ],
            ):
                make_sample_assets.main()

            manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf8"))
            self.assertEqual(
                manifest["sequences"],
                [
                    {"name": "a1", "url": "./a1/sequence.json"},
                    {"name": "a2", "url": "./a2/sequence.json"},
                    {"name": "a3", "url": "./a3/sequence.json"},
                    {"name": "a4", "url": "./a4/sequence.json"},
                ],
            )
            sequence = json.loads((out_dir / "a1" / "sequence.json").read_text(encoding="utf8"))
            self.assertEqual(sequence["image"]["baseUrl"], "./images/")


if __name__ == "__main__":
    unittest.main()
