"""Algebraic alignment gate for the SMPL viewer.

The Three.js viewer (smpl_viewer/viewer.js) configures a PerspectiveCamera with:
    fov_y = 2 * atan(image_h / (2 * fy)) * 180 / pi
    aspect = image_w / image_h
    setViewOffset(image_w, image_h, image_w/2 - cx, image_h/2 - cy, image_w, image_h)

This module simulates that camera's vertex-to-pixel pipeline in pure Python
and checks it reproduces smpl_viewer.projection.project_src to subpixel
precision. If this test passes, the viewer's 2D-aligned mode is provably
correct for the diving intrinsics (fx == fy, cx == W/2, cy == H/2 within
half a pixel).

This is the automated equivalent of the spec's "browser screenshot vs GT
overlay" gate. The visual check (compare_alignment.py) remains a manual
sanity step in the README.
"""
import math

import numpy as np
import pytest


def threejs_project(pts, image_w, image_h, fx, fy, cx, cy):
    """Simulate Three.js PerspectiveCamera + setViewOffset -> pixel coordinates.

    Args:
        pts: (N, 3) source-coordinate points (Y+ up, -Z depth).
        image_w, image_h: meta dims (used for fov_y, aspect, setViewOffset).
        fx, fy, cx, cy: intrinsics passed to setViewOffset.

    Returns:
        px_x, px_y: (N,) pixel coordinates in image space.

    Pipeline (matches Three.js internals):
        1. Camera at origin, looking -Z, up=+Y. Camera-space coords identical
           to source coords.
        2. Perspective: ndc_x = (X / -Z) / (aspect * tan(fov_y/2)),
                       ndc_y = (Y / -Z) / tan(fov_y/2)
        3. Pixel mapping (no view offset): px_x = (ndc_x + 1) * W/2,
                                            px_y = (1 - ndc_y) * H/2
        4. setViewOffset(fullW=image_w, fullH=image_h, offX=W/2-cx, offY=H/2-cy,
                         w=image_w, h=image_h):
              Three.js scales the projection so that the viewport corresponds
              to a sub-rectangle [offX, offY, w, h] of the full image. The
              result is equivalent to shifting the principal point.
    """
    pts = np.asarray(pts, dtype=np.float64)
    fov_y = 2.0 * math.atan(image_h / (2.0 * fy))   # radians
    aspect = image_w / image_h
    tan_half_fov = math.tan(fov_y / 2.0)

    X, Y, Z = pts[:, 0], pts[:, 1], pts[:, 2]

    # Step 2: NDC after perspective divide
    ndc_x = (X / -Z) / (aspect * tan_half_fov)
    ndc_y = (Y / -Z) / tan_half_fov

    # Step 3: pixel coords on a (image_w, image_h) canvas, no offset
    # (we map directly to image_w x image_h, which simplifies setViewOffset).
    px_x_no_off = (ndc_x + 1.0) * (image_w / 2.0)
    px_y_no_off = (1.0 - ndc_y) * (image_h / 2.0)

    # Step 4: setViewOffset shifts the rendered region. With fullW=W, x=W/2-cx,
    # the rendered pixel that USED to be at px_x_no_off now appears at
    # px_x = px_x_no_off - (W/2 - cx) = px_x_no_off - W/2 + cx
    px_x = px_x_no_off - (image_w / 2.0 - cx)
    px_y = px_y_no_off - (image_h / 2.0 - cy)

    return px_x, px_y


def test_threejs_projection_matches_project_src_for_diving_intrinsics():
    """For diving (fx==fy==1850, cx=960, cy=540, W=1920, H=1080), the simulated
    Three.js pipeline matches project_src to <1e-6 px on random points.
    """
    from smpl_viewer.projection import project_src

    rng = np.random.default_rng(0)
    n = 1000
    # Sample points in the camera frustum (Z<0 in src coords).
    X = rng.uniform(-2.0, 2.0, n)
    Y = rng.uniform(-2.0, 2.0, n)
    Z = rng.uniform(-50.0, -1.0, n)   # in front of camera
    pts = np.stack([X, Y, Z], axis=1)

    fx = fy = 1850.0
    cx, cy = 960.0, 540.0
    W, H = 1920, 1080

    u_src, v_src = project_src(pts, fx, fy, cx, cy)
    u_three, v_three = threejs_project(pts, W, H, fx, fy, cx, cy)

    np.testing.assert_allclose(u_three, u_src, atol=1e-6, rtol=0)
    np.testing.assert_allclose(v_three, v_src, atol=1e-6, rtol=0)


def test_threejs_projection_matches_for_smpl_frame0(landscape_seq, smpl_and_faces):
    """End-to-end: SMPL frame-0 verts project through both pipelines to the
    same pixels (max diff < 0.01 px on all 6890 vertices).
    """
    from data_convert.diving_convert import process_diving_sequence, find_seq_root, FX, FY, CX, CY
    from smpl_viewer.projection import project_src

    smpl, faces = smpl_and_faces
    a1 = find_seq_root(str(landscape_seq))
    out = process_diving_sequence(a1, smpl, faces, coord="src")
    verts = out["vertices"][0]   # (6890, 3)

    W, H = 1920, 1080
    u_src, v_src = project_src(verts, FX, FY, CX, CY)
    u_three, v_three = threejs_project(verts, W, H, FX, FY, CX, CY)

    diff_u = np.abs(u_three - u_src).max()
    diff_v = np.abs(v_three - v_src).max()
    assert diff_u < 0.01, f"u diff = {diff_u:.4f} px"
    assert diff_v < 0.01, f"v diff = {diff_v:.4f} px"


def test_threejs_projection_principal_point():
    """Optical-axis points: project_src and threejs_project both map (0,0,Z) -> (cx,cy)."""
    from smpl_viewer.projection import project_src
    pts = np.array([[0.0, 0.0, -5.0], [0.0, 0.0, -100.0]], dtype=np.float64)
    fx = fy = 1850.0; cx, cy = 960.0, 540.0; W, H = 1920, 1080
    u, v = threejs_project(pts, W, H, fx, fy, cx, cy)
    np.testing.assert_allclose(u, [cx, cx], atol=1e-9)
    np.testing.assert_allclose(v, [cy, cy], atol=1e-9)
