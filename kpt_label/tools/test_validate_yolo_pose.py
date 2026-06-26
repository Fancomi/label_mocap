# kpt_label/tools/test_validate_yolo_pose.py
import os, tempfile, unittest
from validate_yolo_pose import validate_dataset

YAML = """path: .
train: images/train
val: images/train
nc: 1
names:
  0: person
kpt_shape: [17, 3]
flip_idx: [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15]
"""

def write(root, rel, text):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        f.write(text)

class T(unittest.TestCase):
    def test_valid_dataset_passes(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "dataset.yaml", YAML)
            line = "0 0.5 0.5 0.2 0.2 " + " ".join(["0.5", "0.5", "2"] * 17)
            write(d, "labels/train/a.txt", line + "\n")
            write(d, "images/train/a.jpg", "")
            self.assertEqual(validate_dataset(d), [])

    def test_wrong_column_count_fails(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "dataset.yaml", YAML)
            write(d, "labels/train/a.txt", "0 0.5 0.5 0.2 0.2 0.1 0.1 2\n")
            self.assertTrue(any("columns" in e for e in validate_dataset(d)))

    def test_out_of_range_fails(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "dataset.yaml", YAML)
            line = "0 1.5 0.5 0.2 0.2 " + " ".join(["0.5", "0.5", "2"] * 17)
            write(d, "labels/train/a.txt", line + "\n")
            self.assertTrue(any("range" in e for e in validate_dataset(d)))

    def test_bad_visibility_fails(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "dataset.yaml", YAML)
            line = "0 0.5 0.5 0.2 0.2 " + " ".join(["0.5", "0.5", "3"] * 17)
            write(d, "labels/train/a.txt", line + "\n")
            self.assertTrue(any("visibility" in e for e in validate_dataset(d)))

    def test_empty_label_is_valid(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "dataset.yaml", YAML)
            write(d, "labels/train/a.txt", "")
            self.assertEqual(validate_dataset(d), [])

if __name__ == "__main__":
    unittest.main()
