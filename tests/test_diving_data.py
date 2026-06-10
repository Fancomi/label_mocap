"""Tests for the self-contained diving data loader (smpl_viewer.diving_data).

The viewer-only subset replaces the rollout repo's process_diving_sequence
(coord kwarg, dst-rotation, augment_yaw, etc.) — we keep just what the
viewer needs: load_smpl_params, detect_orientation, find_seq_root, and
smpl_forward_batch (produces src-coord verts/joints, no rotation applied).
"""
import numpy as np


def test_find_seq_root_returns_a1_dir(landscape_seq):
    from smpl_viewer.diving_data import find_seq_root
    a1 = find_seq_root(str(landscape_seq))
    # a1 must contain json_results/player_0/player_0.json
    import os
    assert os.path.exists(os.path.join(a1, "json_results/player_0/player_0.json"))


def test_load_smpl_params_shapes(landscape_seq):
    from smpl_viewer.diving_data import find_seq_root, load_smpl_params
    a1 = find_seq_root(str(landscape_seq))
    root_rota, root_pos, body_23, n = load_smpl_params(a1)
    assert n > 0
    assert root_rota.shape == (n, 3)
    assert root_pos.shape == (n, 3)
    assert body_23.shape == (n, 23, 3)
    # body_pose is 21 joints, padded to 23 — last two slices are zero.
    assert (body_23[:, 21:] == 0).all()


def test_detect_orientation_returns_bool(landscape_seq):
    from smpl_viewer.diving_data import find_seq_root, load_smpl_params, detect_orientation
    a1 = find_seq_root(str(landscape_seq))
    _, root_pos, _, _ = load_smpl_params(a1)
    out = detect_orientation(root_pos)
    assert isinstance(out, (bool, np.bool_))


def test_smpl_forward_batch_src_in_image(landscape_seq, smpl_and_faces):
    """src-coord verts: Z<0, and ≥90% project inside the 1920×1080 image rect."""
    from smpl_viewer.diving_data import (
        find_seq_root, load_smpl_params, smpl_forward_batch, FX, FY, CX, CY,
    )
    smpl, _ = smpl_and_faces
    a1 = find_seq_root(str(landscape_seq))
    root_rota, root_pos, body_23, _ = load_smpl_params(a1)
    verts, joints = smpl_forward_batch(smpl, root_rota[:1], body_23[:1], root_pos[:1])
    v0 = verts[0]
    assert v0.shape == (6890, 3)
    # All in front of camera in src coords (-Z = depth).
    assert (v0[:, 2] < 0).all()
    # Canonical src projection: u = fx*X/(-Z)+cx, v = fy*(-Y)/(-Z)+cy
    u = FX * v0[:, 0] / (-v0[:, 2]) + CX
    v = FY * (-v0[:, 1]) / (-v0[:, 2]) + CY
    inside = ((u >= 0) & (u < 1920) & (v >= 0) & (v < 1080)).mean()
    assert inside > 0.9, f"only {inside*100:.1f}% verts project inside image"
    # joints default = root only, shape (1, 3) for batch-size 1.
    assert joints.shape == (1, 3)


def test_smpl_forward_batch_returns_all_24_joints(landscape_seq, smpl_and_faces):
    """return_all_joints=True yields (N, 24, 3) — needed by the Flask server."""
    from smpl_viewer.diving_data import (
        find_seq_root, load_smpl_params, smpl_forward_batch,
    )
    smpl, _ = smpl_and_faces
    a1 = find_seq_root(str(landscape_seq))
    root_rota, root_pos, body_23, _ = load_smpl_params(a1)
    _, joints = smpl_forward_batch(
        smpl, root_rota[:3], body_23[:3], root_pos[:3], return_all_joints=True)
    assert joints.shape == (3, 24, 3)
