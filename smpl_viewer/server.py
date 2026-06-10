"""Flask app for SMPL viewer.

Run:
    python label_mocap/smpl_viewer/server.py \
        --raw-root /path/to/dataset/diving/raw --port 5173
"""
import argparse
import logging
import sys
import threading
from pathlib import Path

import cv2
from flask import Flask, abort, jsonify, send_from_directory, request

ROLLOUT = Path("/root/paddlejob/workspace/env_run/penghaotian/sport_project/rollout_lidar_mocap_badminton")
sys.path.insert(0, str(ROLLOUT / "dep" / "vis"))
sys.path.insert(0, str(ROLLOUT))

from data_convert.diving_convert import (  # noqa: E402
    load_smpl_params, detect_orientation, find_seq_root, FX, FY, CX, CY,
)

VIEWER_DIR = Path(__file__).resolve().parent
SMPL_KP_COUNT = 24


def _scan_sequences(raw_root: Path):
    seqs = []
    if not raw_root.exists():
        return seqs
    for src_dir in sorted(p for p in raw_root.iterdir() if p.is_dir()):
        for seq_dir in sorted(p for p in src_dir.iterdir() if p.is_dir()):
            try:
                a1 = find_seq_root(str(seq_dir))
            except FileNotFoundError:
                logging.info("smpl_viewer: skip %s/%s — no a1/json_results",
                             src_dir.name, seq_dir.name)
                continue
            try:
                _, root_pos, _, n = load_smpl_params(a1)
            except Exception as e:
                logging.warning("smpl_viewer: skip %s/%s — load_smpl_params failed: %s",
                                src_dir.name, seq_dir.name, e)
                continue
            seqs.append({
                "src": src_dir.name,
                "name": seq_dir.name,
                "n_frames": int(n),
                "portrait": bool(detect_orientation(root_pos)),
                "_a1": a1,
            })
    return seqs


def create_app(raw_root: Path):
    app = Flask(__name__, static_folder=None)
    state = {"seq_index": None, "meta_cache": {}}
    state_lock = threading.Lock()

    def _ensure_index(refresh=False):
        with state_lock:
            if state["seq_index"] is None or refresh:
                state["seq_index"] = _scan_sequences(raw_root)
                state["meta_cache"].clear()
            return state["seq_index"]

    def _find_seq(src, name):
        for s in _ensure_index():
            if s["src"] == src and s["name"] == name:
                return s
        return None

    @app.route("/")
    def index():
        return send_from_directory(VIEWER_DIR, "viewer.html")

    @app.route("/<path:filename>.js")
    def static_js(filename):
        return send_from_directory(VIEWER_DIR, filename + ".js")

    @app.route("/seqs")
    def list_seqs():
        refresh = request.args.get("refresh") == "1"
        idx = _ensure_index(refresh=refresh)
        public = [
            {"src": s["src"], "name": s["name"],
             "n_frames": s["n_frames"], "portrait": s["portrait"]}
            for s in idx
        ]
        return jsonify({"seqs": public})

    @app.route("/seq/<src>/<name>/meta")
    def meta(src, name):
        cached = state["meta_cache"].get((src, name))
        if cached is not None:
            return jsonify(cached)
        s = _find_seq(src, name)
        if s is None:
            abort(404)
        img_path = Path(s["_a1"]) / "images" / "0000.jpg"
        if not img_path.exists():
            jpgs = sorted((Path(s["_a1"]) / "images").glob("*.jpg"))
            if not jpgs:
                abort(500)
            img_path = jpgs[0]
        img = cv2.imread(str(img_path))
        if img is None:
            abort(500)
        h, w = img.shape[:2]
        m = {
            "n_frames": s["n_frames"],
            "portrait": s["portrait"],
            "K": {"fx": float(FX), "fy": float(FY), "cx": float(CX), "cy": float(CY)},
            "image_w": int(w),
            "image_h": int(h),
            "faces_url": f"/seq/{src}/{name}/faces.bin",
            "kp_count": SMPL_KP_COUNT,
        }
        state["meta_cache"][(src, name)] = m
        return jsonify(m)

    return app


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-root", required=True, type=Path)
    ap.add_argument("--port", type=int, default=5173)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    app = create_app(args.raw_root)
    app.run(host=args.host, port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
