"""Source-coordinate perspective projection.

Source coords: Y+ = up, -Z = depth (camera at origin looking at -Z).
Formula: u = fx * X / (-Z) + cx, v = fy * (-Y) / (-Z) + cy.
"""
import numpy as np


def project_src(pts, fx, fy, cx, cy):
    """Project source-coordinate points to image pixels.

    Args:
        pts: (N, 3) float array, Y+ up, -Z depth.
        fx, fy, cx, cy: intrinsics in pixels.

    Returns:
        u, v: each (N,) float arrays.

    Raises:
        ValueError: if any point has Z >= 0 (behind/at camera).
    """
    pts = np.asarray(pts, dtype=np.float64)
    X, Y, Z = pts[:, 0], pts[:, 1], pts[:, 2]
    if (Z >= 0).any():
        raise ValueError("points behind camera (Z>=0) cannot be projected in src coords")
    u = fx * X / (-Z) + cx
    v = fy * (-Y) / (-Z) + cy
    return u, v
