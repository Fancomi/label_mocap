# kpt_label/tools/validate_yolo_pose.py
# 离线校验 YOLO-pose 导出目录是否符合 Ultralytics 加载规则（不依赖 ultralytics）。
# 用法: python3 validate_yolo_pose.py <dataset_dir>
import os
import re
import sys


def _parse_yaml(path):
    """极简解析所需字段：nc, kpt_shape, flip_idx, names 数量。仅支持本工具产出的扁平格式。"""
    cfg = {"names": []}
    with open(path) as f:
        for raw in f:
            line = raw.rstrip("\n")
            if re.match(r"^\s+\d+:", line):
                cfg["names"].append(line)
                continue
            m = re.match(r"^(\w+):\s*(.*)$", line)
            if not m:
                continue
            key, val = m.group(1), m.group(2).strip()
            if key == "kpt_shape":
                cfg["kpt_shape"] = [int(x) for x in re.findall(r"\d+", val)]
            elif key == "flip_idx":
                cfg["flip_idx"] = [int(x) for x in re.findall(r"\d+", val)]
            elif key == "nc":
                cfg["nc"] = int(val)
    return cfg


def validate_dataset(root):
    """返回错误字符串列表；空列表表示通过。"""
    errors = []
    yaml_path = os.path.join(root, "dataset.yaml")
    if not os.path.isfile(yaml_path):
        return ["missing dataset.yaml"]
    cfg = _parse_yaml(yaml_path)

    if cfg.get("nc") != 1:
        errors.append("nc must be 1")
    ks = cfg.get("kpt_shape")
    if not ks or len(ks) != 2 or ks[1] != 3:
        errors.append("kpt_shape must be [N, 3]")
        return errors
    n = ks[0]
    if len(cfg.get("flip_idx", [])) != n:
        errors.append(f"flip_idx length must equal {n}")
    if len(cfg["names"]) != cfg.get("nc", -1):
        errors.append("names count must equal nc")

    expect_cols = 5 + 3 * n
    for split in ("train", "val"):
        ldir = os.path.join(root, "labels", split)
        if not os.path.isdir(ldir):
            continue
        for fn in sorted(os.listdir(ldir)):
            if not fn.endswith(".txt"):
                continue
            with open(os.path.join(ldir, fn)) as f:
                for li, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue
                    cols = line.split()
                    where = f"{split}/{fn}:{li}"
                    if len(cols) != expect_cols:
                        errors.append(f"{where}: columns={len(cols)} expected {expect_cols}")
                        continue
                    vals = [float(c) for c in cols]
                    if vals[0] != 0:
                        errors.append(f"{where}: class must be 0")
                    for v in vals[1:5]:
                        if not (0.0 <= v <= 1.0):
                            errors.append(f"{where}: bbox out of range [0,1]")
                            break
                    if vals[3] == 0 or vals[4] == 0:
                        errors.append(f"{where}: zero-area bbox (w=0 or h=0)")
                    for k in range(n):
                        x, y, vis = vals[5 + k * 3:8 + k * 3]
                        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
                            errors.append(f"{where}: kpt{k} range [0,1]")
                        if vis not in (0, 1, 2):
                            errors.append(f"{where}: kpt{k} visibility must be 0/1/2")
    return errors


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: validate_yolo_pose.py <dataset_dir>")
        sys.exit(2)
    errs = validate_dataset(sys.argv[1])
    if errs:
        print("INVALID:")
        for e in errs:
            print("  " + e)
        sys.exit(1)
    print("OK: dataset is valid YOLO-pose")
