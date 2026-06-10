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

import pickle

import cv2
import numpy as np
from flask import Flask, Response, abort, jsonify, send_file, send_from_directory, request

ROLLOUT = Path("/root/paddlejob/workspace/env_run/penghaotian/sport_project/rollout_lidar_mocap_badminton")
sys.path.insert(0, str(ROLLOUT / "dep" / "vis"))
sys.path.insert(0, str(ROLLOUT))

from data_convert.diving_convert import (  # noqa: E402
    load_smpl_params, detect_orientation, find_seq_root, FX, FY, CX, CY,
    smpl_forward_batch,  # noqa: F401
)
from vis_tools import PySMPL  # noqa: E402

VIEWER_DIR = Path(__file__).resolve().parent
SMPL_PKL = ROLLOUT / "dep/vis/vis_tools/data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl"
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
    # NOTE: forward_cache is unbounded by design — sequences stay resident until
    # process exit. Each entry is ~50MB; ~95 seqs × ~600 frames could reach ~5GB.
    # An LRU is deferred per the spec until memory becomes a problem in practice.
    state["forward_cache"] = {}     # (src,name) -> {"verts","joints","root_pos","faces"}
    state["forward_lock"] = threading.Lock()
    state["smpl"] = None
    state["faces"] = None

    def _ensure_smpl():
        if state["smpl"] is None:
            state["smpl"] = PySMPL()
            with open(SMPL_PKL, "rb") as f:
                state["faces"] = np.array(
                    pickle.load(f, encoding="latin1")["f"], dtype=np.int32)
        return state["smpl"], state["faces"]

    def _ensure_forward(src, name):
        """Lazily SMPL-forward an entire sequence into the cache and return it.

        Holds forward_lock for the duration of the forward pass; concurrent
        requests for *different* sequences serialize. Acceptable for a local
        dev tool; revisit if multiple users scroll different seqs concurrently.
        """
        key = (src, name)
        with state["forward_lock"]:
            if key in state["forward_cache"]:
                return state["forward_cache"][key]
            s = _find_seq(src, name)
            if s is None:
                return None
            smpl, faces = _ensure_smpl()
            root_rota, root_pos, body_23, _ = load_smpl_params(s["_a1"])
            import torch
            with torch.no_grad():
                pose = torch.tensor(
                    np.concatenate(
                        [root_rota.reshape(-1, 1, 3), body_23], axis=1),
                    dtype=torch.float32)
                transl = torch.tensor(root_pos, dtype=torch.float32)
                verts_chunks, joints_chunks = [], []
                for i in range(0, len(pose), 64):
                    end = min(i + 64, len(pose))
                    out = smpl(torch.zeros(end - i, 10), pose[i:end], transl[i:end])
                    verts_chunks.append(out.vertices.numpy())
                    joints_chunks.append(out.joints[:, :24].numpy())
            verts = np.concatenate(verts_chunks)
            joints = np.concatenate(joints_chunks)  # (N, 24, 3)
            entry = {
                "verts": verts.astype(np.float32, copy=False),
                "joints": joints.astype(np.float32, copy=False),
                "root_pos": root_pos.astype(np.float32, copy=False),
                "faces": faces,
            }
            state["forward_cache"][key] = entry
            return entry

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

    @app.route("/smpl_viewer/<path:filename>")
    def static_smpl_viewer(filename):
        # Importmap and other absolute /smpl_viewer/<path> requests.
        return send_from_directory(VIEWER_DIR, filename)

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

    @app.route("/seq/<src>/<name>/faces.bin")
    def faces_bin(src, name):
        # Faces are SMPL topology — sequence-independent. Don't trigger a forward.
        if _find_seq(src, name) is None:
            abort(404)
        with state["forward_lock"]:
            _, faces = _ensure_smpl()
        return Response(faces.tobytes(),
                        mimetype="application/octet-stream")

    @app.route("/seq/<src>/<name>/frame/<int:i>.bin")
    def frame_bin(src, name, i):
        entry = _ensure_forward(src, name)
        if entry is None:
            abort(404)
        n = entry["verts"].shape[0]
        if i < 0 or i >= n:
            abort(404)
        v = entry["verts"][i].astype(np.float32, copy=False)   # (6890, 3)
        j = entry["joints"][i].astype(np.float32, copy=False)  # (24, 3)
        rp = entry["root_pos"][i].astype(np.float32, copy=False)  # (3,)
        buf = v.tobytes() + j.tobytes() + rp.tobytes()
        return Response(buf, mimetype="application/octet-stream")

    @app.route("/seq/<src>/<name>/img/<int:i>.jpg")
    def img_jpg(src, name, i):
        s = _find_seq(src, name)
        if s is None:
            abort(404)
        img_dir = Path(s["_a1"]) / "images"
        jpgs = sorted(img_dir.glob("*.jpg"))
        if i < 0 or i >= len(jpgs):
            abort(404)
        return send_file(str(jpgs[i]), mimetype="image/jpeg")

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
