"""CLI: render SMPL src-coord projection on top of raw images for visual GT.

Usage:
    python label_mocap/smpl_viewer/alignment_check.py \
       --raw-root /path/to/dataset/diving/raw \
       --seq 10m/TiaoShui_a_male_5500_597 \
       --frames 0,300,596 \
       --output /tmp/align_gt
"""
import argparse
import pickle
import sys
from pathlib import Path

import cv2
import numpy as np

ROLLOUT = Path("/root/paddlejob/workspace/env_run/penghaotian/sport_project/rollout_lidar_mocap_badminton")
sys.path.insert(0, str(ROLLOUT / "dep" / "vis"))
sys.path.insert(0, str(ROLLOUT))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data_convert.diving_convert import process_diving_sequence, find_seq_root, FX, FY, CX, CY  # noqa: E402
from vis_tools import PySMPL  # noqa: E402
from smpl_viewer.projection import project_src  # noqa: E402

SMPL_PKL = ROLLOUT / "dep/vis/vis_tools/data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-root", required=True, type=Path)
    ap.add_argument("--seq", required=True)
    ap.add_argument("--frames", default="0")
    ap.add_argument("--output", required=True, type=Path)
    args = ap.parse_args()

    seq_dir = args.raw_root / args.seq
    a1 = find_seq_root(str(seq_dir))

    smpl = PySMPL()
    with open(SMPL_PKL, "rb") as f:
        faces = np.array(pickle.load(f, encoding="latin1")["f"], dtype=np.int32)

    print(f"Forward SMPL (src coords): {args.seq}")
    out = process_diving_sequence(a1, smpl, faces, coord="src")
    verts = out["vertices"]
    n = out["n_frames"]

    img_dir = Path(a1) / "images"
    img_files = sorted(img_dir.glob("*.jpg"))
    if not img_files:
        raise SystemExit(f"no jpgs in {img_dir}")

    frames = list(range(n)) if args.frames == "all" else [int(x) for x in args.frames.split(",")]
    args.output.mkdir(parents=True, exist_ok=True)
    seq_tag = args.seq.replace("/", "_")

    for fi in frames:
        if fi < 0 or fi >= n:
            print(f"  skip frame {fi} (out of range 0..{n-1})")
            continue
        img = cv2.imread(str(img_files[min(fi, len(img_files) - 1)]))
        u, v = project_src(verts[fi], FX, FY, CX, CY)
        ui, vi = u.astype(int), v.astype(int)
        H, W = img.shape[:2]
        ok = (ui >= 0) & (ui < W) & (vi >= 0) & (vi < H)
        for x, y in zip(ui[ok], vi[ok]):
            cv2.circle(img, (x, y), 1, (0, 220, 0), -1)
        out_path = args.output / f"gt_{seq_tag}_f{fi:04d}.png"
        cv2.imwrite(str(out_path), img)
        print(f"  wrote {out_path}")


if __name__ == "__main__":
    main()
