"""CLI: render SMPL src-coord projection on top of raw images for visual GT.

Usage:
    python -m smpl_viewer.alignment_check \
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

# Allow `python label_mocap/smpl_viewer/alignment_check.py` (run-as-script)
# in addition to `python -m smpl_viewer.alignment_check`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smpl_viewer.diving_data import (  # noqa: E402
    find_seq_root, load_smpl_params, smpl_forward_batch, FX, FY, CX, CY,
)
from smpl_viewer.pysmpl import PySMPL  # noqa: E402
from smpl_viewer.projection import project_src  # noqa: E402

SMPL_PKL = Path(__file__).resolve().parent / "_data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl"


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
        # We don't actually need faces here, but loading the pkl proves the
        # data path resolves; the projection only uses verts.
        pickle.load(f, encoding="latin1")

    root_rota, root_pos, body_23, n = load_smpl_params(a1)
    print(f"Forward SMPL (src coords): {args.seq} ({n} frames)")
    verts, _ = smpl_forward_batch(smpl, root_rota, body_23, root_pos)

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
