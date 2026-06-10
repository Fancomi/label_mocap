"""End-to-end tests for smpl_viewer.projection."""
import numpy as np
import pytest


def test_project_principal_point():
    """A point on the optical axis at any depth projects to (cx, cy)."""
    from smpl_viewer.projection import project_src
    pts = np.array([[0.0, 0.0, -5.0], [0.0, 0.0, -100.0]], dtype=np.float32)
    u, v = project_src(pts, fx=1850, fy=1850, cx=960, cy=540)
    assert np.allclose(u, [960, 960])
    assert np.allclose(v, [540, 540])


def test_project_unit_offsets():
    """At Z=-1, +X moves u right by fx, -Y moves v down by fy."""
    from smpl_viewer.projection import project_src
    pts = np.array([[1.0, 0.0, -1.0], [0.0, -1.0, -1.0]], dtype=np.float32)
    u, v = project_src(pts, fx=1850, fy=1850, cx=960, cy=540)
    assert np.allclose(u, [960 + 1850, 960])
    assert np.allclose(v, [540, 540 + 1850])


def test_project_rejects_positive_z():
    """Points behind the camera (Z>=0 in source coords) must raise."""
    from smpl_viewer.projection import project_src
    pts = np.array([[0.0, 0.0, 1.0]], dtype=np.float32)
    with pytest.raises(ValueError, match="behind"):
        project_src(pts, fx=1850, fy=1850, cx=960, cy=540)


def test_smpl_first_frame_lands_in_image_landscape(landscape_seq, smpl_and_faces):
    """End-to-end: src-forward verts of frame 0 project inside [0,1920)x[0,1080)."""
    from data_convert.diving_convert import process_diving_sequence, find_seq_root, FX, FY, CX, CY
    from smpl_viewer.projection import project_src
    smpl, faces = smpl_and_faces
    a1 = find_seq_root(str(landscape_seq))
    out = process_diving_sequence(a1, smpl, faces, coord="src")
    u, v = project_src(out["vertices"][0], FX, FY, CX, CY)
    inside = ((u >= 0) & (u < 1920) & (v >= 0) & (v < 1080)).mean()
    assert inside > 0.9, f"only {inside*100:.1f}% verts project inside image"
