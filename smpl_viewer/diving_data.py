"""Diving sequence loader — viewer subset of rollout_lidar_mocap_badminton/data_convert/diving_convert.py.

This is the *only* code in label_mocap that reads diving raw data. We
intentionally keep just what server.py / alignment_check.py need:

  - Camera intrinsics: FX, FY, CX, CY  (K_CAM constant in the original)
  - find_seq_root(seq_dir) -> a1 directory path
  - load_smpl_params(a1_dir) -> (root_rota, root_pos, body_23, N)
  - detect_orientation(root_pos) -> bool (True = portrait/vertical capture)
  - smpl_forward_batch(smpl, root_rota, body_23, root_pos) -> (verts, joints)

We do NOT vendor:
  - transform_root_and_pose / augment_yaw / cmd_convert / cmd_render / overlay
    (training-pipeline code; the viewer renders src-coords directly)
  - sample_visible_pc / fps_numpy from data_convert/basic.py
    (point-cloud sampling for training, viewer doesn't need it)

Source coords (matches the diving sequences on disk):
  Y+ = up, -Z = depth (camera at origin looking -Z).
  Projection: u = fx * X / (-Z) + cx, v = fy * (-Y) / (-Z) + cy.
"""
import json
import os
from pathlib import Path

import numpy as np
import torch

# Camera intrinsics for diving (constant across all sequences in the dataset).
FX = FY = 1850.0
CX, CY = 960.0, 540.0
K_CAM = np.array([[FX, 0, CX], [0, FY, CY], [0, 0, 1]], dtype=np.float64)


def find_seq_root(seq_dir):
    """Locate the directory containing a1/json_results/player_0/player_0.json.

    Diving raw layout varies: sometimes seq_dir/a1/..., sometimes seq_dir/a/a1/....
    """
    for pattern in ("a/a1", "a1"):
        p = os.path.join(seq_dir, pattern, "json_results/player_0/player_0.json")
        if os.path.exists(p):
            return os.path.join(seq_dir, pattern)
    found = list(Path(seq_dir).rglob("a1/json_results/player_0/player_0.json"))
    if found:
        return str(found[0].parent.parent.parent)
    raise FileNotFoundError(f"Cannot find a1/json_results in {seq_dir}")


def load_smpl_params(a1_dir):
    """Read player_0.json → (root_rota, root_pos, body_23, N).

    body_23 is body_pose (21,3) padded with zeros to (23,3) for SMPL_layer.
    """
    json_path = os.path.join(a1_dir, "json_results/player_0/player_0.json")
    with open(json_path) as f:
        anns = json.load(f)["annotations"]
    n = len(anns)
    root_rota = np.array([a["root_rota"] for a in anns], dtype=np.float32)
    root_pos = np.array([a["root_pos"] for a in anns], dtype=np.float32)
    body_pose = np.array([a["body_pose"] for a in anns], dtype=np.float32).reshape(n, 21, 3)
    body_23 = np.zeros((n, 23, 3), dtype=np.float32)
    body_23[:, :21] = body_pose
    return root_rota, root_pos, body_23, n


def detect_orientation(root_pos):
    """True ↔ "portrait" capture (image height > width in physical scene sense).

    Heuristic: long sequences (≥60 frames) — pose path is wider in X than Y → landscape.
    Short sequences fall back to checking which side of the principal point the
    body sits on (close to the cx column suggests a portrait flip).
    """
    x_range = root_pos[:, 0].max() - root_pos[:, 0].min()
    y_range = root_pos[:, 1].max() - root_pos[:, 1].min()
    if len(root_pos) < 60:
        z_pos = -root_pos[:, 2]
        u_center = (FX * root_pos[:, 0] / z_pos + CX).mean()
        return u_center < CX
    return x_range > y_range * 2


def smpl_forward_batch(smpl, root_rota, body_pose, root_pos, batch=64, return_all_joints=False):
    """Run SMPL forward in chunks. Returns (vertices, joints).

    By default joints is (N, 3) (root only) to mirror the rollout helper. With
    return_all_joints=True it's (N, 24, 3) — the viewer needs all 24.
    """
    n = len(root_rota)
    pose = torch.tensor(
        np.concatenate([root_rota.reshape(n, 1, 3), body_pose], axis=1),
        dtype=torch.float32,
    )
    transl = torch.tensor(root_pos, dtype=torch.float32)
    verts_chunks = []
    joints_chunks = []
    with torch.no_grad():
        for i in range(0, n, batch):
            end = min(i + batch, n)
            out = smpl(torch.zeros(end - i, 10), pose[i:end], transl[i:end])
            verts_chunks.append(out.vertices.numpy())
            if return_all_joints:
                joints_chunks.append(out.joints[:, :24].numpy())
            else:
                joints_chunks.append(out.joints[:, 0].numpy())
    return np.concatenate(verts_chunks), np.concatenate(joints_chunks)
