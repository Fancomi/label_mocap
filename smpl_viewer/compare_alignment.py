"""Compare GT overlays vs viewer screenshots, report mesh-edge offset.

Usage:
    PY label_mocap/smpl_viewer/compare_alignment.py \
       --gt-dir /tmp/align_gt \
       --viewer-dir /tmp/align_viewer \
       --max-px 2.0
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np


def edge_offset_px(gt_bgr, viewer_bgr):
    """Median displacement (px) between green-channel edges of GT and viewer."""
    def green_mask(img):
        b, g, r = cv2.split(img)
        m = ((g > 80) & (g > b.astype(int) + 30) & (g > r.astype(int) + 30)).astype(np.uint8) * 255
        return m

    gt_resized = cv2.resize(gt_bgr, (viewer_bgr.shape[1], viewer_bgr.shape[0]),
                            interpolation=cv2.INTER_AREA)
    gm = green_mask(gt_resized)
    vm = green_mask(viewer_bgr)
    dist = cv2.distanceTransform((gm == 0).astype(np.uint8), cv2.DIST_L2, 3)
    coords = np.argwhere(vm > 0)
    if len(coords) == 0:
        return float("inf")
    sample = dist[coords[:, 0], coords[:, 1]]
    return float(np.median(sample))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gt-dir", required=True, type=Path)
    ap.add_argument("--viewer-dir", required=True, type=Path)
    ap.add_argument("--max-px", type=float, default=2.0)
    args = ap.parse_args()

    gt_files = sorted(args.gt_dir.glob("gt_*.png"))
    if not gt_files:
        sys.exit(f"no gt_*.png in {args.gt_dir}")

    fail = 0
    for gt in gt_files:
        v_name = "viewer_" + gt.name[len("gt_"):]
        v_path = args.viewer_dir / v_name
        if not v_path.exists():
            print(f"  MISSING viewer for {gt.name}")
            fail += 1
            continue
        gt_img = cv2.imread(str(gt))
        v_img = cv2.imread(str(v_path))
        off = edge_offset_px(gt_img, v_img)
        ok = off <= args.max_px
        print(f"  {gt.name}: median edge offset = {off:.2f} px  {'OK' if ok else 'FAIL'}")
        if not ok:
            fail += 1
    sys.exit(0 if fail == 0 else 1)


if __name__ == "__main__":
    main()
