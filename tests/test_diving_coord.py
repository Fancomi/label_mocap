"""Tests the new `coord` kwarg on process_diving_sequence.

src: skip transform_root_and_pose, return verts in source coords
     (head-up should be ~ -Y for landscape, ~ +X for portrait original capture)
dst: existing behavior unchanged (Z+=up after transform)
"""
import numpy as np
import pytest


@pytest.fixture(scope="module")
def smpl_and_faces():
    import pickle
    from vis_tools import PySMPL
    smpl = PySMPL()
    pkl = ("/root/paddlejob/workspace/env_run/penghaotian/sport_project/"
           "rollout_lidar_mocap_badminton/dep/vis/vis_tools/data/smpl/"
           "basicModel_neutral_lbs_10_207_0_v1.0.0.pkl")
    with open(pkl, "rb") as f:
        faces = np.array(pickle.load(f, encoding="latin1")["f"], dtype=np.int32)
    return smpl, faces


def test_default_coord_is_dst_unchanged(landscape_seq, smpl_and_faces):
    """coord defaults to 'dst' — vertices in dst coords have Y>0 (depth in front of camera).

    dst coords: Y+ = depth (camera at origin looking +Y). Projection u=fx*X/Y+cx requires Y>0.
    This invariant holds for any rotation (portrait or landscape), unlike axis-specific tests.
    """
    from data_convert.diving_convert import process_diving_sequence, find_seq_root
    smpl, faces = smpl_and_faces
    a1 = find_seq_root(str(landscape_seq))
    out = process_diving_sequence(a1, smpl, faces)  # default coord="dst"
    v0 = out["vertices"][0]
    assert v0.shape == (6890, 3)
    assert (v0[:, 1] > 0).all(), "dst coords: all verts must have Y>0 (depth in front of camera)"
    # Also confirm the kwarg defaults to dst by comparing to explicit dst call
    out_explicit = process_diving_sequence(a1, smpl, faces, coord="dst")
    import numpy as np
    np.testing.assert_array_equal(out["vertices"][0], out_explicit["vertices"][0])


def test_coord_src_skips_transform(landscape_seq, smpl_and_faces):
    """coord='src' returns verts in source coords: -Y is up for landscape, body height along Y."""
    from data_convert.diving_convert import process_diving_sequence, find_seq_root
    smpl, faces = smpl_and_faces
    a1 = find_seq_root(str(landscape_seq))
    out = process_diving_sequence(a1, smpl, faces, coord="src")
    v0 = out["vertices"][0]
    assert v0.shape == (6890, 3)
    # source coord: Y+ = up, so body height is along Y (largest range)
    rng_x = v0[:, 0].max() - v0[:, 0].min()
    rng_y = v0[:, 1].max() - v0[:, 1].min()
    assert rng_y > rng_x, f"src coord expects body along Y, got rng_y={rng_y}, rng_x={rng_x}"


def test_coord_src_projects_to_image(landscape_seq, smpl_and_faces):
    """src-coord verts project into the [0,W)x[0,H) image rectangle with the canonical formula."""
    from data_convert.diving_convert import process_diving_sequence, find_seq_root, FX, FY, CX, CY
    smpl, faces = smpl_and_faces
    a1 = find_seq_root(str(landscape_seq))
    out = process_diving_sequence(a1, smpl, faces, coord="src")
    v0 = out["vertices"][0]
    X, Y, Z = v0[:, 0], v0[:, 1], v0[:, 2]
    # canonical src projection
    u = FX * X / (-Z) + CX
    v = FY * (-Y) / (-Z) + CY
    # depth must be positive (Z negative)
    assert (Z < 0).all(), "all verts should have Z<0 (in front of camera) in src coords"
    # 90% of verts must land inside the 1920x1080 raw image rectangle
    inside = ((u >= 0) & (u < 1920) & (v >= 0) & (v < 1080)).mean()
    assert inside > 0.9, f"only {inside*100:.1f}% verts project inside image"


def test_coord_invalid_value_raises():
    """Bogus coord raises ValueError early."""
    from data_convert.diving_convert import process_diving_sequence
    with pytest.raises(ValueError, match="coord"):
        # We don't need real inputs — the kwarg check should fire before any work.
        # But signature requires positional args, so we use a sentinel a1 that won't be reached.
        process_diving_sequence("/nonexistent", None, None, coord="middle")
