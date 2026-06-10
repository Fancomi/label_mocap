import unittest

from tools.convert_sequence import convert_records, image_name


class SequenceConverterTest(unittest.TestCase):
    def test_convert_records_keeps_smpl_params_only(self):
        records = [
            {
                "frame": 7,
                "root_pos": [1, 2, 3],
                "root_rota": [0.1, 0.2, 0.3],
                "body_pose": [0.0] * 63,
                "betas": [0.0] * 10,
                "left_hand_pose": [9.0],
            }
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


if __name__ == "__main__":
    unittest.main()
