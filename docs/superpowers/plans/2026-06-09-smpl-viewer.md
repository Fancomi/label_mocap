# SMPL Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an HTML SMPL/keypoint observer for diving sequences with one PerspectiveCamera that smoothly slerps between 3D and 2D-aligned modes, no PnP, served by a Flask backend that runs SMPL forward and ships binary frame data.

**Architecture:** Two layers. (1) `server.py` (Flask) scans dataset, lazy-runs SMPL forward in source coordinates, ships JSON meta + binary `(6890,3) verts + (24,3) joints + (3,) root_pos` per frame + raw JPGs. (2) `viewer.html`/`viewer.js`/`camera_modes.js` (Three.js, ES modules) holds one camera, builds the scene in source coords (`Y+=up, -Z=depth`), and uses a state-machine to slerp between 3D-orbit and 2D-aligned views. Alignment is proven by a Python ground-truth overlay vs. a `?validate=1` browser screenshot before any interactive code is written.

**Tech Stack:** Python 3.12 + Flask + numpy + torch + cv2 + roma + trimesh (existing venv `/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/`); reuse `vis_tools.PySMPL` and `data_convert.diving_convert` from `rollout_lidar_mocap_badminton`. Three.js r160 ES modules (vendored). pytest for backend tests.

---

## File Structure

```
label_mocap/
├── kps3d/                              # existing — read-only reference for BONES/UI patterns
├── smpl_viewer/
│   ├── __init__.py                     # empty, makes it a package
│   ├── server.py                       # Flask: scan / cache / SMPL forward / binary endpoints
│   ├── alignment_check.py              # CLI: dump gt_overlay_<seq>_<frame>.png
│   ├── compare_alignment.py            # CLI: cv2.absdiff GT vs viewer screenshot, report px error
│   ├── viewer.html                     # main page, sidebar UI, importmap pointing at vendor/three
│   ├── viewer.js                       # bootstrap: fetch meta → fetch frame → wire scene
│   ├── camera_modes.js                 # one-camera state machine: 3D ↔ 2D + 1s slerp
│   ├── vendor/
│   │   ├── three.module.js             # r160, vendored (~600KB)
│   │   └── OrbitControls.js            # r160 examples/jsm/controls/OrbitControls.js
│   └── README.md                       # how to run server, validate, troubleshoot
├── tests/
│   ├── conftest.py                     # sys.path setup + skip-if-no-data fixture
│   ├── test_diving_coord.py            # coord="src"/"dst" kwarg behavior
│   ├── test_alignment.py               # src-coord projection numerical correctness
│   └── test_server.py                  # Flask test_client: routes, content-types, byte sizes
├── docs/
│   └── superpowers/
│       ├── specs/2026-06-09-smpl-viewer-design.md   # already exists
│       └── plans/2026-06-09-smpl-viewer.md          # this file
└── pytest.ini                          # rootdir + testpaths
```

**External edit (one file in another repo):**

```
rollout_lidar_mocap_badminton/data_convert/diving_convert.py   # add coord kwarg to process_diving_sequence
```

---

## Pre-flight constants (referenced across tasks)

- Venv python: `/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python` (call as `$PY` in commands; **do not** use system `python`).
- Rollout repo root: `/root/paddlejob/workspace/env_run/penghaotian/sport_project/rollout_lidar_mocap_badminton`
- Dataset raw root: `/root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw`
- Validation seqs: portrait `10m/TiaoShui_a_male_5500_597`, landscape `olympic/a_famale_70`
- Image dimensions (verified by `cv2.imread`): both portrait and landscape raw images are `(H=1080, W=1920, 3)`. The "portrait" label refers to the *physical scene* up direction being `-X` in source coords; the JPG itself is **not** rotated on disk.
- Camera intrinsics: `fx=fy=1850, cx=960, cy=540` (from `diving_convert.K_CAM`, identical for portrait/landscape).
- Source-coordinate projection (the only formula the viewer must match):  
  `u = fx * X / (-Z) + cx`  
  `v = fy * (-Y) / (-Z) + cy`

---

## Task 0: Bootstrap project (deps, pytest, vendored Three.js, README skeleton)

**Files:**
- Create: `label_mocap/pytest.ini`
- Create: `label_mocap/tests/__init__.py` (empty)
- Create: `label_mocap/tests/conftest.py`
- Create: `label_mocap/smpl_viewer/__init__.py` (empty)
- Create: `label_mocap/smpl_viewer/vendor/three.module.js`
- Create: `label_mocap/smpl_viewer/vendor/OrbitControls.js`
- Create: `label_mocap/smpl_viewer/README.md`

- [ ] **Step 1: Install pytest into the existing venv** (the only missing dep — `flask 3.1.3, cv2 4.13.0, torch 2.6.0, numpy 2.4.4, joblib, roma, trimesh` are already present)

```bash
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python -m pip install 'pytest>=8.0,<9.0'
```

Expected: `Successfully installed pytest-8.x` (or already present).

- [ ] **Step 2: Verify pytest import**

```bash
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python -c "import pytest; print(pytest.__version__)"
```
Expected: prints `8.x.x`, exits 0.

- [ ] **Step 3: Write `pytest.ini`**

```ini
[pytest]
testpaths = tests
addopts = -ra -q
```

- [ ] **Step 4: Write `tests/conftest.py`**

```python
import os
import sys
from pathlib import Path
import pytest

ROLLOUT = Path("/root/paddlejob/workspace/env_run/penghaotian/sport_project/rollout_lidar_mocap_badminton")
DATA_ROOT = Path("/root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw")

# Make rollout repo importable (for vis_tools + data_convert)
sys.path.insert(0, str(ROLLOUT / "dep" / "vis"))
sys.path.insert(0, str(ROLLOUT))

# Make this repo importable (for smpl_viewer)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PORTRAIT_SEQ = DATA_ROOT / "10m" / "TiaoShui_a_male_5500_597"
LANDSCAPE_SEQ = DATA_ROOT / "olympic" / "a_famale_70"


@pytest.fixture(scope="session")
def portrait_seq():
    if not PORTRAIT_SEQ.exists():
        pytest.skip(f"portrait fixture seq missing: {PORTRAIT_SEQ}")
    return PORTRAIT_SEQ


@pytest.fixture(scope="session")
def landscape_seq():
    if not LANDSCAPE_SEQ.exists():
        pytest.skip(f"landscape fixture seq missing: {LANDSCAPE_SEQ}")
    return LANDSCAPE_SEQ
```

- [ ] **Step 5: Verify conftest paths import** — sanity check the fixtures load and `data_convert` is reachable

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap && \
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python -m pytest --collect-only 2>&1 | tail -5
```
Expected: `no tests collected` and exit 5 (no tests yet) — but no import errors.

- [ ] **Step 6: Vendor Three.js r160** — fetch ES module bundle + OrbitControls

```bash
mkdir -p /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap/smpl_viewer/vendor
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap/smpl_viewer/vendor

curl -fsSL -o three.module.js  https://unpkg.com/three@0.160.0/build/three.module.js
curl -fsSL -o OrbitControls.js https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js

ls -lh three.module.js OrbitControls.js
```
Expected: both files exist, `three.module.js` ~600KB, `OrbitControls.js` ~30KB. If the host blocks unpkg, fall back to `https://cdn.jsdelivr.net/npm/three@0.160.0/...` with the same paths.

- [ ] **Step 7: Patch OrbitControls.js to use a relative import**

Open `OrbitControls.js`. The first non-comment line will be `import {` … `} from 'three';`. Replace `'three'` with `'./three.module.js'` so the browser can resolve it without an importmap.

```bash
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python - <<'EOF'
import re, pathlib
p = pathlib.Path("/root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap/smpl_viewer/vendor/OrbitControls.js")
src = p.read_text()
new = re.sub(r"from\s+['\"]three['\"]", "from './three.module.js'", src, count=1)
assert new != src, "patch failed: 'three' import not found"
p.write_text(new)
print("patched")
EOF
```
Expected: prints `patched`. Re-running prints AssertionError (idempotent guard).

- [ ] **Step 8: Write `smpl_viewer/README.md`**

````markdown
# SMPL Viewer

HTML observer for diving SMPL sequences. One PerspectiveCamera, slerps between 3D-orbit and 2D-aligned views. Backend runs SMPL forward in source coordinates and ships binary frame data.

## Run

```bash
PY=/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python
$PY label_mocap/smpl_viewer/server.py \
  --raw-root /root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw \
  --port 5173
```

Open <http://localhost:5173/>. Pick a sequence from the dropdown.

## Validate alignment

1. Generate ground truth overlays (Python projection):

   ```bash
   $PY label_mocap/smpl_viewer/alignment_check.py \
     --raw-root /root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw \
     --seq 10m/TiaoShui_a_male_5500_597 \
     --frames 0,300,596 \
     --output /tmp/align_gt
   ```

2. In the viewer, append `?validate=1&seq=10m/TiaoShui_a_male_5500_597&frame=0` to the URL. The page auto-snaps a PNG download per the listed frames. Save them next to the GT files.

3. Diff:

   ```bash
   $PY label_mocap/smpl_viewer/compare_alignment.py \
     --gt-dir /tmp/align_gt \
     --viewer-dir /tmp/align_viewer \
     --max-px 2.0
   ```

   Exit 0 means mesh-edge offset < 2px on all frames.

## Tests

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python -m pytest -v
```
````

- [ ] **Step 9: Commit**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap
git add pytest.ini tests/__init__.py tests/conftest.py \
        smpl_viewer/__init__.py smpl_viewer/vendor/ smpl_viewer/README.md
git commit -m "chore(smpl_viewer): scaffold pytest harness, vendor three.js r160, README"
```

---
## Task 1: Add `coord` kwarg to `process_diving_sequence` (cross-repo edit)

**Files:**
- Modify: `/root/paddlejob/workspace/env_run/penghaotian/sport_project/rollout_lidar_mocap_badminton/data_convert/diving_convert.py:179-215` (`process_diving_sequence`)
- Test: `label_mocap/tests/test_diving_coord.py`

**Why this edit:** the spec calls for source-coordinate forward without rewriting the pipeline. Adding `coord="src"|"dst"` skips `transform_root_and_pose` when `coord=="src"`. Default stays `"dst"` so existing call sites keep working.

- [ ] **Step 1: Write the failing tests**

```python
# label_mocap/tests/test_diving_coord.py
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
    """coord defaults to 'dst' — vertices match prior behavior (Z+=up)."""
    from data_convert.diving_convert import process_diving_sequence, find_seq_root
    smpl, faces = smpl_and_faces
    a1 = find_seq_root(str(landscape_seq))
    out = process_diving_sequence(a1, smpl, faces)
    # In dst coords, +Z is up: head joint (smpl idx 15) should have larger Z than feet (idx 7,8).
    # We don't have joints in result, but root_pose / transl reflect rotated frame.
    # Sanity: vertices Z mean > Y mean (Y=depth, Z=up after rotation).
    v0 = out["vertices"][0]
    assert v0.shape == (6890, 3)
    # body height after rotation: Z range > X range
    assert v0[:, 2].max() - v0[:, 2].min() > v0[:, 0].max() - v0[:, 0].min()


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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap && \
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python -m pytest tests/test_diving_coord.py -v
```
Expected: 4 failures. The 3 fixture-using tests fail with `TypeError: process_diving_sequence() got an unexpected keyword argument 'coord'`. The 4th fails the same way (no ValueError).

- [ ] **Step 3: Implement the kwarg in `diving_convert.py`**

Edit `/root/paddlejob/workspace/env_run/penghaotian/sport_project/rollout_lidar_mocap_badminton/data_convert/diving_convert.py`. Replace the entire `process_diving_sequence` function (lines 179–215) with:

```python
def process_diving_sequence(a1_dir, smpl, faces, aug_angle=None, coord="dst"):
    """统一转换管线: load → detect orient → transform → (aug) → SMPL forward → sample PC

    Args:
        coord: "dst" (默认, 训练用目标坐标系 Z+=up) 或 "src" (源坐标系 Y+=up, -Z=depth).
               coord="src" 时跳过 transform_root_and_pose 与 augment_yaw, 顶点保持原始相机坐标.

    Returns dict (字段同前):
        root_pose, body_pose, transl, pc, vertices, root_rota_src, root_pos_src,
        rotate_cw, n_frames
    """
    if coord not in ("src", "dst"):
        raise ValueError(f"coord must be 'src' or 'dst', got {coord!r}")

    root_rota, root_pos, body_23, N = load_smpl_params(a1_dir)
    rotate_cw = detect_orientation(root_pos)

    if coord == "src":
        rr_use, rp_use = root_rota, root_pos
    else:
        rot_matrix = ROT_PORTRAIT if rotate_cw else ROT_LANDSCAPE
        rr_use, rp_use = transform_root_and_pose(root_rota, root_pos, rot_matrix)
        if aug_angle is not None and aug_angle != 0:
            rr_use, rp_use = augment_yaw(rr_use, rp_use, body_23, smpl, aug_angle)

    verts_all, _ = smpl_forward_batch(smpl, rr_use, body_23, rp_use)
    pcs = np.array([sample_visible_pc(v, faces) for v in verts_all])

    return {
        "root_pose": rr_use.reshape(N, 1, 3).astype(np.float32),
        "body_pose": body_23.astype(np.float32),
        "transl": rp_use.reshape(N, 1, 3).astype(np.float32),
        "pc": pcs.astype(np.float32),
        "vertices": verts_all,
        "root_rota_src": root_rota,
        "root_pos_src": root_pos,
        "rotate_cw": rotate_cw,
        "n_frames": N,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap && \
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python -m pytest tests/test_diving_coord.py -v
```
Expected: 4 passed. (`test_default_coord_is_dst_unchanged`, `test_coord_src_skips_transform`, `test_coord_src_projects_to_image`, `test_coord_invalid_value_raises`.)

- [ ] **Step 5: Commit (two repos)**

```bash
# diving_convert.py is in the rollout repo
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/rollout_lidar_mocap_badminton
git add data_convert/diving_convert.py
git commit -m "feat(diving_convert): add coord='src'|'dst' kwarg to process_diving_sequence"

# tests live in label_mocap
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap
git add tests/test_diving_coord.py
git commit -m "test: cover coord kwarg on process_diving_sequence"
```

---
## Task 2: Standalone projection helper + ground-truth alignment script

**Files:**
- Create: `label_mocap/smpl_viewer/projection.py`
- Create: `label_mocap/tests/test_alignment.py`
- Create: `label_mocap/smpl_viewer/alignment_check.py`

**Why split projection.py:** the formula must live in one Python module that both `alignment_check.py` and `test_alignment.py` import — keeps "the formula" testable without spinning up Flask.

- [ ] **Step 1: Write the failing tests**

```python
# label_mocap/tests/test_alignment.py
"""Source-coordinate projection: u=fx*X/(-Z)+cx, v=fy*(-Y)/(-Z)+cy."""
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


def test_smpl_first_frame_lands_in_image_landscape(landscape_seq):
    """End-to-end: src-forward verts of frame 0 project inside [0,1920)x[0,1080)."""
    import pickle
    from vis_tools import PySMPL
    from data_convert.diving_convert import process_diving_sequence, find_seq_root, FX, FY, CX, CY
    from smpl_viewer.projection import project_src
    smpl = PySMPL()
    pkl = ("/root/paddlejob/workspace/env_run/penghaotian/sport_project/"
           "rollout_lidar_mocap_badminton/dep/vis/vis_tools/data/smpl/"
           "basicModel_neutral_lbs_10_207_0_v1.0.0.pkl")
    with open(pkl, "rb") as f:
        faces = np.array(pickle.load(f, encoding="latin1")["f"], dtype=np.int32)
    a1 = find_seq_root(str(landscape_seq))
    out = process_diving_sequence(a1, smpl, faces, coord="src")
    u, v = project_src(out["vertices"][0], FX, FY, CX, CY)
    inside = ((u >= 0) & (u < 1920) & (v >= 0) & (v < 1080)).mean()
    assert inside > 0.9, f"only {inside*100:.1f}% verts project inside image"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap && \
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python -m pytest tests/test_alignment.py -v
```
Expected: 4 failures, all `ModuleNotFoundError: No module named 'smpl_viewer.projection'`.

- [ ] **Step 3: Write `smpl_viewer/projection.py`**

```python
"""Source-coordinate perspective projection.

Source coords: Y+ = up, -Z = depth (camera at origin looking at -Z).
Formula: u = fx * X / (-Z) + cx, v = fy * (-Y) / (-Z) + cy.

This is the only place the formula lives. alignment_check.py and tests
both import from here. The Three.js viewer matches it numerically by
configuring the PerspectiveCamera (see camera_modes.js, 2D mode).
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap && \
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python -m pytest tests/test_alignment.py -v
```
Expected: 4 passed.

- [ ] **Step 5: Write `smpl_viewer/alignment_check.py` (CLI for ground-truth overlay PNGs)**

```python
"""CLI: render SMPL src-coord projection on top of raw images for visual GT.

Usage:
    PY label_mocap/smpl_viewer/alignment_check.py \
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

ROLLOUT = Path("/root/paddlejob/workspace/env_run/penghaotian/sport_project/rollout_lidar_mocap_badminton")
sys.path.insert(0, str(ROLLOUT / "dep" / "vis"))
sys.path.insert(0, str(ROLLOUT))

from data_convert.diving_convert import (  # noqa: E402
    process_diving_sequence, find_seq_root, FX, FY, CX, CY,
)
from vis_tools import PySMPL  # noqa: E402

from smpl_viewer.projection import project_src  # noqa: E402


SMPL_PKL = ROLLOUT / "dep/vis/vis_tools/data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-root", required=True, type=Path)
    ap.add_argument("--seq", required=True, help='e.g. "10m/TiaoShui_a_male_5500_597"')
    ap.add_argument("--frames", default="0", help="comma-separated frame indices, or 'all'")
    ap.add_argument("--output", required=True, type=Path)
    args = ap.parse_args()

    seq_dir = args.raw_root / args.seq
    a1 = find_seq_root(str(seq_dir))

    smpl = PySMPL()
    with open(SMPL_PKL, "rb") as f:
        faces = np.array(pickle.load(f, encoding="latin1")["f"], dtype=np.int32)

    print(f"Forward SMPL (src coords): {args.seq}")
    out = process_diving_sequence(a1, smpl, faces, coord="src")
    verts = out["vertices"]
    n = out["n_frames"]

    img_dir = Path(a1) / "images"
    img_files = sorted(img_dir.glob("*.jpg"))
    if not img_files:
        raise SystemExit(f"no jpgs in {img_dir}")

    if args.frames == "all":
        frames = list(range(n))
    else:
        frames = [int(x) for x in args.frames.split(",")]

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
```

- [ ] **Step 6: Smoke-run `alignment_check.py` on the portrait fixture**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap && \
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python smpl_viewer/alignment_check.py \
  --raw-root /root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw \
  --seq 10m/TiaoShui_a_male_5500_597 \
  --frames 0,300,596 \
  --output /tmp/align_gt
ls -lh /tmp/align_gt/
```
Expected: 3 PNGs, each ~150-300KB. Open one in an image viewer (or `xdg-open`) and confirm the green dots trace the diver outline. **For portrait raw images the dots will appear sideways relative to the photo's "sky-up" — this is correct: the raw JPG is unrotated, so the diver capture sits sideways. The key is the dots track the body silhouette pixel-tight, regardless of which way the body points.**

- [ ] **Step 7: Commit**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap
git add smpl_viewer/projection.py smpl_viewer/alignment_check.py tests/test_alignment.py
git commit -m "feat(smpl_viewer): src-coord projection + alignment_check CLI"
```

---
## Task 3: Flask server skeleton — `/seqs` and `/seq/.../meta`

**Files:**
- Create: `label_mocap/smpl_viewer/server.py`
- Create: `label_mocap/tests/test_server.py`

This task gets `/seqs` (list dataset) and `/seq/<src>/<name>/meta` working **without** doing any SMPL forward yet — purely scan + meta. SMPL forward + binary frame is added in Task 4.

- [ ] **Step 1: Write the failing tests**

```python
# label_mocap/tests/test_server.py
"""Flask endpoint tests using app.test_client()."""
import pytest
from pathlib import Path

from conftest import DATA_ROOT, PORTRAIT_SEQ, LANDSCAPE_SEQ


@pytest.fixture(scope="module")
def app():
    if not DATA_ROOT.exists():
        pytest.skip(f"raw dataset missing: {DATA_ROOT}")
    from smpl_viewer.server import create_app
    return create_app(raw_root=DATA_ROOT)


@pytest.fixture
def client(app):
    return app.test_client()


def test_index_returns_html(client):
    """GET / serves viewer.html."""
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.mimetype == "text/html"
    assert b"<canvas" in resp.data or b"<!DOCTYPE" in resp.data


def test_seqs_lists_validation_fixtures(client):
    """GET /seqs returns the two fixture sequences with correct portrait flag."""
    resp = client.get("/seqs")
    assert resp.status_code == 200
    j = resp.get_json()
    assert "seqs" in j
    seqs = {(s["src"], s["name"]): s for s in j["seqs"]}
    assert ("10m", "TiaoShui_a_male_5500_597") in seqs
    assert ("olympic", "a_famale_70") in seqs
    assert seqs[("10m", "TiaoShui_a_male_5500_597")]["portrait"] is True
    assert seqs[("olympic", "a_famale_70")]["portrait"] is False
    # n_frames must be a positive int
    for s in seqs.values():
        assert isinstance(s["n_frames"], int) and s["n_frames"] > 0


def test_meta_for_portrait_seq(client):
    """GET /seq/10m/TiaoShui_a_male_5500_597/meta returns intrinsics + image dims."""
    resp = client.get("/seq/10m/TiaoShui_a_male_5500_597/meta")
    assert resp.status_code == 200
    m = resp.get_json()
    assert m["portrait"] is True
    assert m["n_frames"] == 597  # this fixture is 597 frames
    assert m["K"] == {"fx": 1850.0, "fy": 1850.0, "cx": 960.0, "cy": 540.0}
    assert m["image_w"] == 1920
    assert m["image_h"] == 1080
    assert m["faces_url"].endswith("/faces.bin")
    assert m["kp_count"] == 24


def test_meta_404_for_unknown_seq(client):
    resp = client.get("/seq/10m/NOPE_NOT_REAL/meta")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap && \
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python -m pytest tests/test_server.py -v
```
Expected: 4 errors at collection — `ModuleNotFoundError: No module named 'smpl_viewer.server'`.

- [ ] **Step 3: Write `smpl_viewer/server.py` (skeleton: scan + meta only, no forward yet)**

```python
"""Flask app for SMPL viewer.

Run:
    python label_mocap/smpl_viewer/server.py \
        --raw-root /path/to/dataset/diving/raw --port 5173
"""
import argparse
import sys
from pathlib import Path

import cv2
from flask import Flask, abort, jsonify, send_from_directory

ROLLOUT = Path("/root/paddlejob/workspace/env_run/penghaotian/sport_project/rollout_lidar_mocap_badminton")
sys.path.insert(0, str(ROLLOUT / "dep" / "vis"))
sys.path.insert(0, str(ROLLOUT))

from data_convert.diving_convert import (  # noqa: E402
    load_smpl_params, detect_orientation, find_seq_root, FX, FY, CX, CY,
)

VIEWER_DIR = Path(__file__).resolve().parent
SMPL_KP_COUNT = 24


def _scan_sequences(raw_root: Path):
    """Find all <src>/<seq> directories with a usable a1/json_results."""
    seqs = []
    if not raw_root.exists():
        return seqs
    for src_dir in sorted(p for p in raw_root.iterdir() if p.is_dir()):
        for seq_dir in sorted(p for p in src_dir.iterdir() if p.is_dir()):
            try:
                a1 = find_seq_root(str(seq_dir))
            except FileNotFoundError:
                continue
            try:
                _, root_pos, _, n = load_smpl_params(a1)
            except Exception:
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

    # In-memory caches:
    #   _seq_index: list of {src,name,n_frames,portrait,_a1}
    #   _meta_cache: keyed by (src,name) -> meta dict
    state = {"seq_index": None, "meta_cache": {}}

    def _ensure_index(refresh=False):
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
        # Serve viewer.js, camera_modes.js, vendor/three.module.js, vendor/OrbitControls.js
        return send_from_directory(VIEWER_DIR, filename + ".js")

    @app.route("/seqs")
    def list_seqs():
        from flask import request
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
        # Read image dims from frame 0
        img_path = Path(s["_a1"]) / "images" / "0000.jpg"
        if not img_path.exists():
            # fall back to first jpg
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
```

Also create a placeholder `viewer.html` so `test_index_returns_html` passes:

```bash
cat > /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap/smpl_viewer/viewer.html <<'EOF'
<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>SMPL Viewer</title></head>
<body><canvas id="c"></canvas><div id="placeholder">viewer.html — replaced in Task 6</div></body>
</html>
EOF
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap && \
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python -m pytest tests/test_server.py -v
```
Expected: 4 passed. (`test_index_returns_html`, `test_seqs_lists_validation_fixtures`, `test_meta_for_portrait_seq`, `test_meta_404_for_unknown_seq`.)

- [ ] **Step 5: Commit**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap
git add smpl_viewer/server.py smpl_viewer/viewer.html tests/test_server.py
git commit -m "feat(smpl_viewer): Flask server skeleton with /seqs and /seq/.../meta"
```

---
## Task 4: Server SMPL forward + binary frame + faces + image endpoints

**Files:**
- Modify: `label_mocap/smpl_viewer/server.py`
- Modify: `label_mocap/tests/test_server.py` (add tests for the new endpoints)

Adds the data plane: `/seq/.../faces.bin`, `/seq/.../frame/<i>.bin`, `/seq/.../img/<i>.jpg`. SMPL forward runs lazily once per sequence and stays cached in process memory until exit.

- [ ] **Step 1: Append failing tests to `test_server.py`**

```python
# Append to label_mocap/tests/test_server.py

def test_faces_bin_size_and_dtype(client):
    """faces.bin: int32, shape (F, 3), F == 13776 for SMPL."""
    resp = client.get("/seq/10m/TiaoShui_a_male_5500_597/faces.bin")
    assert resp.status_code == 200
    assert resp.mimetype == "application/octet-stream"
    # SMPL has 13776 triangle faces × 3 verts × int32
    assert len(resp.data) == 13776 * 3 * 4


def test_frame_bin_layout(client):
    """frame/<i>.bin: 6890*3 + 24*3 + 3 floats == (6890*3 + 24*3 + 3)*4 bytes."""
    resp = client.get("/seq/10m/TiaoShui_a_male_5500_597/frame/0.bin")
    assert resp.status_code == 200
    assert resp.mimetype == "application/octet-stream"
    expected = (6890 * 3 + 24 * 3 + 3) * 4
    assert len(resp.data) == expected, f"got {len(resp.data)} expected {expected}"


def test_frame_bin_contents_are_finite_floats(client):
    """frame/0.bin parses as float32 and contains no NaN/Inf."""
    import numpy as np
    resp = client.get("/seq/10m/TiaoShui_a_male_5500_597/frame/0.bin")
    buf = np.frombuffer(resp.data, dtype=np.float32)
    assert buf.shape == (6890 * 3 + 24 * 3 + 3,)
    assert np.isfinite(buf).all()
    verts = buf[:6890 * 3].reshape(6890, 3)
    # all verts in front of camera in src coords (Z<0)
    assert (verts[:, 2] < 0).all()


def test_frame_bin_404_out_of_range(client):
    resp = client.get("/seq/10m/TiaoShui_a_male_5500_597/frame/99999.bin")
    assert resp.status_code == 404


def test_image_endpoint_serves_jpeg(client):
    resp = client.get("/seq/10m/TiaoShui_a_male_5500_597/img/0.jpg")
    assert resp.status_code == 200
    assert resp.mimetype == "image/jpeg"
    # JPEG magic
    assert resp.data[:3] == b"\xff\xd8\xff"


def test_image_endpoint_404_out_of_range(client):
    resp = client.get("/seq/10m/TiaoShui_a_male_5500_597/img/99999.jpg")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap && \
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python -m pytest tests/test_server.py -v
```
Expected: 6 new failures (404 from Flask: `Not Found` for unimplemented routes), original 4 still pass.

- [ ] **Step 3: Extend `server.py` with the data-plane endpoints**

Add the following imports at the top of `server.py` (next to the existing ones):

```python
import io
import pickle
import threading

import numpy as np
from flask import Response, send_file
```

Then, after the existing `from data_convert.diving_convert import ...` line, add:

```python
from data_convert.diving_convert import process_diving_sequence  # noqa: E402
from vis_tools import PySMPL  # noqa: E402

SMPL_PKL = ROLLOUT / "dep/vis/vis_tools/data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl"
```

Inside `create_app`, before the route definitions, add a forward-cache helper:

```python
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
        key = (src, name)
        with state["forward_lock"]:
            if key in state["forward_cache"]:
                return state["forward_cache"][key]
            s = _find_seq(src, name)
            if s is None:
                return None
            smpl, faces = _ensure_smpl()
            # process_diving_sequence returns vertices but not joints; we re-run
            # smpl_forward_batch ourselves to get both.
            from data_convert.diving_convert import (
                load_smpl_params, smpl_forward_batch,
            )
            root_rota, root_pos, body_23, _ = load_smpl_params(s["_a1"])
            verts, joints = smpl_forward_batch(smpl, root_rota, body_23, root_pos)
            entry = {
                "verts": verts.astype(np.float32, copy=False),
                "joints": joints.astype(np.float32, copy=False),
                "root_pos": root_pos.astype(np.float32, copy=False),
                "faces": faces,
            }
            state["forward_cache"][key] = entry
            return entry
```

Add the new routes (place them after the existing `/seq/<src>/<name>/meta` route, inside `create_app`):

```python
    @app.route("/seq/<src>/<name>/faces.bin")
    def faces_bin(src, name):
        entry = _ensure_forward(src, name)
        if entry is None:
            abort(404)
        return Response(entry["faces"].tobytes(),
                        mimetype="application/octet-stream")

    @app.route("/seq/<src>/<name>/frame/<int:i>.bin")
    def frame_bin(src, name, i):
        entry = _ensure_forward(src, name)
        if entry is None:
            abort(404)
        n = entry["verts"].shape[0]
        if i < 0 or i >= n:
            abort(404)
        v = entry["verts"][i]                # (6890, 3) float32
        j = entry["joints"][i:i + 1].reshape(-1)  # we only stored root joint per-frame
        # Re-extract: joints array is (N, 3); we want (24, 3) per frame.
        # The loop above stored only root joints. We need full 24 joints — fix:
        # see Step 4 note; for now joints array stays root-only and frame_bin will
        # be wrong. The fix is in Step 4.
        abort(500)  # placeholder; replaced in Step 4
```

> **Note:** the snippet above intentionally stops short — Step 4 fixes the joints story. We commit only after Step 4 because the route is incomplete here.

- [ ] **Step 4: Fix the joints — store all 24, not just root**

In `_ensure_forward`, replace the `smpl_forward_batch(...)` block with a local mini-batched forward that keeps `out.joints[:, :24]`:

```python
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
```

Then replace the placeholder body of `frame_bin` with the real implementation:

```python
    @app.route("/seq/<src>/<name>/frame/<int:i>.bin")
    def frame_bin(src, name, i):
        entry = _ensure_forward(src, name)
        if entry is None:
            abort(404)
        n = entry["verts"].shape[0]
        if i < 0 or i >= n:
            abort(404)
        v = entry["verts"][i].astype(np.float32, copy=False)         # (6890, 3)
        j = entry["joints"][i].astype(np.float32, copy=False)        # (24, 3)
        rp = entry["root_pos"][i].astype(np.float32, copy=False)     # (3,)
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
```

- [ ] **Step 5: Run all server tests to verify they pass**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap && \
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python -m pytest tests/test_server.py -v
```
Expected: 10 passed. The first call to `frame_bin` runs the SMPL forward (~5-15s for a 597-frame sequence); subsequent calls hit the cache and are <50ms.

- [ ] **Step 6: Commit**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap
git add smpl_viewer/server.py tests/test_server.py
git commit -m "feat(smpl_viewer): add faces/frame/img binary endpoints with cached SMPL forward"
```

---
## Task 5: Validate-mode `viewer.html` + minimal `viewer.js` (alignment proof)

**Files:**
- Modify: `label_mocap/smpl_viewer/viewer.html` (replace placeholder)
- Create: `label_mocap/smpl_viewer/viewer.js`
- Create: `label_mocap/smpl_viewer/compare_alignment.py`

**This is the gate.** No interaction, no mode switching, no UI. Just: load one frame, render mesh + image plane in 2D-aligned mode, save canvas to disk, diff against the GT overlay from Task 2. Must pass before Task 6.

- [ ] **Step 1: Write `viewer.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>SMPL Viewer</title>
<style>
  html, body { margin:0; padding:0; height:100%; background:#111; color:#eee; font-family:monospace; overflow:hidden; }
  #canvas-container { position:absolute; inset:0; }
  canvas { display:block; width:100%; height:100%; }
  #status { position:absolute; top:10px; left:10px; background:rgba(0,0,0,0.6); padding:6px 10px; font-size:12px; }
</style>
</head>
<body>
<div id="canvas-container"><canvas id="c"></canvas></div>
<div id="status">loading…</div>
<script type="importmap">
{ "imports": {
    "three": "/smpl_viewer/vendor/three.module.js",
    "three/addons/controls/OrbitControls.js": "/smpl_viewer/vendor/OrbitControls.js"
} }
</script>
<script type="module" src="/viewer.js"></script>
</body>
</html>
```

> Note the importmap paths: the server route `/<path:filename>.js` matches `/viewer.js` and `/smpl_viewer/vendor/three.module.js` etc. We need a `/smpl_viewer/<path>` route too — add it in Step 2.

- [ ] **Step 2: Add a static-path passthrough to `server.py` for the importmap paths**

Inside `create_app`, add this route alongside the existing `static_js`:

```python
    @app.route("/smpl_viewer/<path:filename>")
    def static_smpl_viewer(filename):
        # Allow importmap-style absolute paths like /smpl_viewer/vendor/three.module.js.
        return send_from_directory(VIEWER_DIR, filename)
```

- [ ] **Step 3: Write `viewer.js` (validate-mode only)**

```javascript
// label_mocap/smpl_viewer/viewer.js
//
// Validate mode: ?validate=1&seq=<src>/<name>&frame=<i>
// Renders one frame in 2D-aligned mode and triggers a PNG download.
// No interaction, no mode switching. Task 6 expands this.

import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const validate = params.get('validate') === '1';
const seq = params.get('seq');     // e.g. "10m/TiaoShui_a_male_5500_597"
const frameI = parseInt(params.get('frame') || '0', 10);

const status = document.getElementById('status');
function setStatus(t) { status.textContent = t; console.log('[viewer]', t); }

if (!validate) {
  setStatus('Task 5 only supports ?validate=1&seq=<src>/<name>&frame=<i>. Task 6 adds full UI.');
} else if (!seq) {
  setStatus('missing ?seq=<src>/<name>');
} else {
  main(seq, frameI).catch(e => {
    setStatus('ERROR: ' + e.message);
    console.error(e);
  });
}

async function main(seqId, fi) {
  const [src, name] = seqId.split('/');
  setStatus(`fetching meta for ${seqId} …`);
  const meta = await (await fetch(`/seq/${src}/${name}/meta`)).json();
  setStatus(`forwarding SMPL (first call may take ~10s) …`);
  const facesBuf = await (await fetch(meta.faces_url)).arrayBuffer();
  const frameBuf = await (await fetch(`/seq/${src}/${name}/frame/${fi}.bin`)).arrayBuffer();

  const faces = new Int32Array(facesBuf);                     // (F*3,)
  const verts = new Float32Array(frameBuf, 0, 6890 * 3);      // (6890*3,)
  // joints + root_pos follow but unused in validate

  // Three.js scene
  const W = window.innerWidth, H = window.innerHeight;
  const renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('c'),
    antialias: true,
    preserveDrawingBuffer: true, // needed for toDataURL
  });
  renderer.setPixelRatio(1); // exact pixel match for diffing
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();

  // 2D-aligned camera: at origin, looking -Z, fov_y matches intrinsics
  const fovDeg = 2 * Math.atan(meta.image_h / (2 * meta.K.fy)) * 180 / Math.PI;
  const camera = new THREE.PerspectiveCamera(fovDeg, meta.image_w / meta.image_h, 0.01, 1000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.up.set(0, 1, 0);
  // setViewOffset for principal-point shift; for diving cx=W/2, cy=H/2 → offset zero,
  // but we still call it so the formula is exercised end-to-end.
  const offX = meta.image_w / 2 - meta.K.cx;
  const offY = meta.image_h / 2 - meta.K.cy;
  camera.setViewOffset(meta.image_w, meta.image_h, offX, offY, meta.image_w, meta.image_h);

  // Background image plane: large plane at z=-50 covering the camera fov exactly.
  const bgZ = -50;
  const bgH = 2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * Math.abs(bgZ);
  const bgW = bgH * (meta.image_w / meta.image_h);
  const tex = new THREE.TextureLoader().load(`/seq/${src}/${name}/img/${fi}.jpg`,
    () => onTextureReady());
  tex.colorSpace = THREE.SRGBColorSpace;
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(bgW, bgH),
    new THREE.MeshBasicMaterial({ map: tex, depthWrite: false })
  );
  bg.position.set(0, 0, bgZ);
  bg.renderOrder = 0;
  scene.add(bg);

  // Mesh wireframe in src coords (already verified Y+=up, -Z=depth)
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
  geom.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x00dd00, wireframe: true,
    depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = 10;
  scene.add(mesh);

  function onTextureReady() {
    setStatus(`rendering frame ${fi} of ${seqId}`);
    renderer.render(scene, camera);
    // Download PNG
    const tag = `${src}_${name}_f${String(fi).padStart(4, '0')}`;
    const a = document.createElement('a');
    a.download = `viewer_${tag}.png`;
    a.href = renderer.domElement.toDataURL('image/png');
    a.click();
    setStatus(`done. saved viewer_${tag}.png. compare to alignment_check output.`);
  }
}
```

- [ ] **Step 4: Write `compare_alignment.py`**

```python
"""Compare GT overlays vs viewer screenshots, report mesh-edge offset.

Usage:
    PY label_mocap/smpl_viewer/compare_alignment.py \
       --gt-dir /tmp/align_gt \
       --viewer-dir /tmp/align_viewer \
       --max-px 2.0
"""
import argparse
import re
import sys
from pathlib import Path

import cv2
import numpy as np


def edge_offset_px(gt_bgr, viewer_bgr):
    """Return median displacement (px) between green-channel edges of GT and viewer.

    GT: green dots at projected vert positions on the raw image.
    Viewer: green wireframe on the raw image (same image, same camera).

    Compare via Canny on the green-only images, then compute the
    per-pixel distance from each viewer edge pixel to the nearest GT edge.
    """
    def green_mask(img):
        # Pull pixels that are dominantly green
        b, g, r = cv2.split(img)
        m = ((g > 80) & (g > b.astype(int) + 30) & (g > r.astype(int) + 30)).astype(np.uint8) * 255
        return m

    gt_resized = cv2.resize(gt_bgr, (viewer_bgr.shape[1], viewer_bgr.shape[0]),
                            interpolation=cv2.INTER_AREA)
    gm = green_mask(gt_resized)
    vm = green_mask(viewer_bgr)
    # Distance transform on inverse of GT mask
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
        # gt_<seq_tag>_f<NNNN>.png  ->  viewer_<seq_tag>_f<NNNN>.png
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
```

- [ ] **Step 5: Run the alignment proof end-to-end**

This step is **manual** — it requires a browser. Document the exact procedure for the engineer:

1. Generate GT overlays:

   ```bash
   PY=/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python
   cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap
   $PY smpl_viewer/alignment_check.py \
     --raw-root /root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw \
     --seq olympic/a_famale_70 --frames 0 --output /tmp/align_gt
   $PY smpl_viewer/alignment_check.py \
     --raw-root /root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw \
     --seq 10m/TiaoShui_a_male_5500_597 --frames 0,300,596 --output /tmp/align_gt
   ```

2. Start the server (use `127.0.0.1` — exposing to all interfaces is unnecessary for validation):

   ```bash
   $PY smpl_viewer/server.py \
     --raw-root /root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw \
     --port 5173
   ```

3. In a browser (or any WebGL-capable headless renderer the engineer has, e.g. Chrome with `--headless=new --window-size=1920,1080`), open each URL in turn:
   - `http://localhost:5173/?validate=1&seq=olympic/a_famale_70&frame=0`
   - `http://localhost:5173/?validate=1&seq=10m/TiaoShui_a_male_5500_597&frame=0`
   - `http://localhost:5173/?validate=1&seq=10m/TiaoShui_a_male_5500_597&frame=300`
   - `http://localhost:5173/?validate=1&seq=10m/TiaoShui_a_male_5500_597&frame=596`

   Each tab auto-downloads `viewer_<tag>.png`. Move them to `/tmp/align_viewer/`.

4. Diff:

   ```bash
   $PY smpl_viewer/compare_alignment.py \
     --gt-dir /tmp/align_gt --viewer-dir /tmp/align_viewer --max-px 2.0
   ```

   Expected: every line ends in `OK`, exit code 0.

- [ ] **Step 6: If alignment fails — debug checklist (do not skip — this is the failure mode the spec calls out as risk #1 and #2)**

If `compare_alignment.py` reports `> 2 px`:

1. **Check `meta.image_w / image_h`** — should be 1920 × 1080. If swapped, fix `cv2.imread(...).shape[:2]` order in `server.py` (it returns `(H, W)`, code uses `h, w = img.shape[:2]`, which is correct).
2. **Check fov_y formula** — must use `image_h`, not `image_w`. The viewer code already does this; just confirm `fovDeg` log value: `2*atan(1080/(2*1850))*180/π ≈ 33.40°`.
3. **Portrait sanity** — for the 10m seq, the diver in the GT overlay appears sideways relative to "human up"; the viewer canvas should show the *same* sideways orientation. If the viewer rotates the image but the mesh doesn't (or vice versa), the mismatch is a single 90° rotation. Fix by **not rotating either** — both stay native. Task 6 adds an explicit display-rotate toggle for the user; Task 5 leaves it unrotated.
4. **Vertex Z sign** — log `verts[0]` from JS; if Z>0 you've accidentally negated somewhere. Source coords from `process_diving_sequence(coord="src")` give Z<0 (verified in Task 1 tests).
5. **Background plane size** — `bgH = 2*tan(fov_y/2)*|bgZ|` and `bgW = bgH*(W/H)`. If aspect is off, the plane will stretch. Confirm by sticking an axis-aligned tape-measure pattern on the GT image first.

When you fix anything, re-run Step 5.

- [ ] **Step 7: Commit (only after Step 5 passes)**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap
git add smpl_viewer/viewer.html smpl_viewer/viewer.js smpl_viewer/server.py \
        smpl_viewer/compare_alignment.py
git commit -m "feat(smpl_viewer): validate-mode renders 2D-aligned frame, alignment <2px"
```

---
## Task 6: Camera state machine — `camera_modes.js` with 3D ↔ 2D slerp

**Files:**
- Create: `label_mocap/smpl_viewer/camera_modes.js`

`camera_modes.js` knows nothing about SMPL. It owns one `THREE.PerspectiveCamera`, an `OrbitControls`, a current "mode" (`'3d'`|`'2d'`), and a 1-second tween. The viewer asks it for the camera and tells it "go to 2d" / "go to 3d". It returns the camera and the recommended **bg plane params** (`{position: Vec3, size:[w,h], visible: bool, frustum_visible: bool}`) for the current frame.

> No tests in this task — it's pure DOM + WebGL state. We exercise it visually in Task 7. Per the spec, "切换都是从'当前'插值到'上次保存的目标'" — saved-state restoration is part of the contract.

- [ ] **Step 1: Write `camera_modes.js`**

```javascript
// label_mocap/smpl_viewer/camera_modes.js
// One PerspectiveCamera, two modes (3d/2d), 1s slerp on switch.
// Each switch interpolates from the *current* pose to the *last saved* target pose.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TWEEN_MS = 1000;

export class CameraModes {
  /**
   * @param {object} opts
   *   - canvas: the renderer canvas (for OrbitControls input)
   *   - meta:   {K:{fx,fy,cx,cy}, image_w, image_h}
   *   - bgPlaneZ3D: distance to image plane in 3D mode (positive number, default 1.5)
   *   - bgPlaneZ2D: distance to image plane in 2D mode (default 50)
   */
  constructor({ canvas, meta, bgPlaneZ3D = 1.5, bgPlaneZ2D = 50 }) {
    this.canvas = canvas;
    this.meta = meta;
    this.bgPlaneZ3D = bgPlaneZ3D;
    this.bgPlaneZ2D = bgPlaneZ2D;

    const fovY = 2 * Math.atan(meta.image_h / (2 * meta.K.fy)) * 180 / Math.PI;
    const aspect = meta.image_w / meta.image_h;
    this.camera = new THREE.PerspectiveCamera(fovY, aspect, 0.01, 200);
    this.camera.up.set(0, 1, 0);

    // Apply principal-point offset once; both modes use the same K.
    const offX = meta.image_w / 2 - meta.K.cx;
    const offY = meta.image_h / 2 - meta.K.cy;
    this.camera.setViewOffset(meta.image_w, meta.image_h, offX, offY,
                              meta.image_w, meta.image_h);

    // Default 3D pose: behind and above the diver, looking at origin.
    this._pose3D = {
      position: new THREE.Vector3(2.5, 1.0, -2.5),
      quaternion: this._quatLookingAt(
        new THREE.Vector3(2.5, 1.0, -2.5),
        new THREE.Vector3(0, 0, -8)),
      target: new THREE.Vector3(0, 0, -8),  // OrbitControls target; per-frame updated by viewer
      fov: fovY,
    };
    // 2D pose: at origin, looking -Z, fov locked to intrinsics.
    this._pose2D = {
      position: new THREE.Vector3(0, 0, 0),
      quaternion: this._quatLookingAt(new THREE.Vector3(0, 0, 0),
                                      new THREE.Vector3(0, 0, -1)),
      target: new THREE.Vector3(0, 0, -1),
      fov: fovY,
    };

    this.mode = '3d';
    this._applyPose(this._pose3D);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.copy(this._pose3D.target);

    this._tween = null;
  }

  _quatLookingAt(eye, target) {
    const m = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  _applyPose(p) {
    this.camera.position.copy(p.position);
    this.camera.quaternion.copy(p.quaternion);
    this.camera.fov = p.fov;
    this.camera.updateProjectionMatrix();
  }

  _capturePose(target = 'auto') {
    // Save current camera state into the slot the user is leaving.
    const slot = (target === 'auto') ? (this.mode === '3d' ? this._pose3D : this._pose2D)
                                     : (target === '3d' ? this._pose3D : this._pose2D);
    slot.position.copy(this.camera.position);
    slot.quaternion.copy(this.camera.quaternion);
    slot.target.copy(this.controls.target);
    slot.fov = this.camera.fov;
  }

  /** Update the 3D OrbitControls target (call per frame to follow root joint). */
  set3DFollowTarget(vec3) {
    this._pose3D.target.copy(vec3);
    if (this.mode === '3d' && !this._tween) this.controls.target.copy(vec3);
  }

  /** Returns true while a tween is in progress. */
  isAnimating() { return this._tween !== null; }

  /** Returns 'background plane params' for the current state, used by viewer to position the bg plane. */
  bgPlaneParams() {
    const fovY = THREE.MathUtils.degToRad(this.camera.fov);
    if (this.mode === '3d') {
      // Plane in front of camera at bgPlaneZ3D, sized to fov (frustum near).
      const h = 2 * Math.tan(fovY / 2) * this.bgPlaneZ3D;
      const w = h * this.meta.image_w / this.meta.image_h;
      return { z: -this.bgPlaneZ3D, w, h, frustum_visible: true };
    } else {
      const h = 2 * Math.tan(fovY / 2) * this.bgPlaneZ2D;
      const w = h * this.meta.image_w / this.meta.image_h;
      return { z: -this.bgPlaneZ2D, w, h, frustum_visible: false };
    }
  }

  switchTo(mode) {
    if (mode !== '2d' && mode !== '3d') throw new Error(`bad mode: ${mode}`);
    if (this.mode === mode || this._tween) return;

    // Save the pose we're leaving.
    this._capturePose('auto');

    // Lock controls during the tween (we re-enable after if landing in 3d).
    this.controls.enabled = false;

    const from = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
      target: this.controls.target.clone(),
      fov: this.camera.fov,
    };
    const to = (mode === '2d') ? this._pose2D : this._pose3D;

    const startTs = performance.now();
    this._tween = { from, to, startTs, dest: mode };
  }

  /** Advance any active tween. Call once per frame *before* renderer.render(). */
  update(now = performance.now()) {
    if (!this._tween) {
      if (this.mode === '3d') this.controls.update();
      return;
    }
    const { from, to, startTs, dest } = this._tween;
    const t = Math.min(1, (now - startTs) / TWEEN_MS);
    const k = 0.5 - 0.5 * Math.cos(Math.PI * t); // ease-in-out

    this.camera.position.lerpVectors(from.position, to.position, k);
    this.camera.quaternion.copy(from.quaternion).slerp(to.quaternion, k);
    this.controls.target.lerpVectors(from.target, to.target, k);
    this.camera.fov = from.fov + (to.fov - from.fov) * k;
    this.camera.updateProjectionMatrix();

    if (t >= 1) {
      this.mode = dest;
      this._tween = null;
      this.controls.enabled = (this.mode === '3d');
      // Snap to the exact target to kill any rounding error.
      this._applyPose(to);
      this.controls.target.copy(to.target);
    }
  }
}
```

- [ ] **Step 2: Eyeball-syntax-check the module loads in the browser**

Run the dev server and open `http://localhost:5173/smpl_viewer/camera_modes.js` directly in the browser. The browser should serve the JS source (the `static_smpl_viewer` route from Task 5 covers this). Any syntax error would show in DevTools; correct it before moving on.

```bash
# (no automated check — visual only)
```

- [ ] **Step 3: Commit**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap
git add smpl_viewer/camera_modes.js
git commit -m "feat(smpl_viewer): camera_modes.js — one camera, 3D/2D state machine, 1s slerp"
```

---
## Task 7: Full viewer — sequence dropdown, frame slider/play, mesh, joints, mode toggle

**Files:**
- Modify: `label_mocap/smpl_viewer/viewer.html` (full UI)
- Modify: `label_mocap/smpl_viewer/viewer.js` (full bootstrap)

This task replaces the validate-mode viewer with the production UI: sidebar (sequence list, frame slider, play/pause, speed, mode toggle, joint-angle panel), main canvas with grid + axes + frustum + bg plane + mesh + bones + keypoints. Validate mode keeps working (just an extra branch that auto-switches mode and snaps a PNG).

> Reuse pattern: the BONES table, ANGLES table, sidebar markup, slider/play/speed wiring, and "joint angles" overlay already exist in `kps3d/kps3d_viewer.html`. **Do not invent new patterns; copy and adapt.** The viewer.js below references the same `BONES` and `ANGLES` arrays.

- [ ] **Step 1: Write `viewer.html` (full sidebar)**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>SMPL Viewer</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { height:100%; background:#111; color:#eee; font-family:monospace; overflow:hidden; }
  body { display:flex; }
  #canvas-container { position:relative; flex:1; }
  canvas { display:block; width:100%; height:100%; }
  #status { position:absolute; top:8px; left:8px; background:rgba(0,0,0,0.55);
            padding:5px 9px; font-size:11px; color:#aaa; pointer-events:none; }
  #angle-panel { position:absolute; top:8px; right:8px; background:rgba(0,0,0,0.7);
                 border:1px solid #333; border-radius:4px; padding:8px 10px;
                 font-size:11px; line-height:1.6; min-width:160px; pointer-events:none; }
  #angle-panel h3 { color:#7df; font-size:11px; margin-bottom:3px;
                    border-bottom:1px solid #333; padding-bottom:2px; }
  .ar { display:flex; justify-content:space-between; gap:10px; }
  .ar span:first-child { color:#999; }
  .ar span:last-child { color:#ffa; }

  #sidebar { width:260px; background:#1a1a1a; border-left:1px solid #333;
             display:flex; flex-direction:column; padding:10px; gap:10px; overflow-y:auto; }
  #sidebar h2 { font-size:12px; color:#7df; border-bottom:1px solid #333; padding-bottom:4px; }
  .g { display:flex; flex-direction:column; gap:4px; }
  .g > label { font-size:10px; color:#888; }
  .row { display:flex; gap:5px; }
  button, select {
    flex:1; padding:5px 8px; background:#2a2a2a; border:1px solid #444;
    color:#eee; border-radius:3px; font:inherit; cursor:pointer;
  }
  button:hover, select:hover { background:#3a3a3a; }
  button.on { background:#0066cc; border-color:#0088ff; }
  input[type=range] { width:100%; accent-color:#0088ff; }
  #frame-info { font-size:10px; color:#666; text-align:right; }
</style>
</head>
<body>
<div id="canvas-container">
  <canvas id="c"></canvas>
  <div id="status">loading…</div>
  <div id="angle-panel"><h3>Joint Angles</h3><div id="angle-list"></div></div>
</div>
<div id="sidebar">
  <h2>SMPL Viewer</h2>

  <div class="g">
    <label>序列</label>
    <select id="seq-select"></select>
  </div>

  <div class="g">
    <label>相机模式</label>
    <div class="row">
      <button id="btn-mode-3d" class="on">3D 自由</button>
      <button id="btn-mode-2d">2D 对齐</button>
    </div>
  </div>

  <div class="g">
    <label>播放</label>
    <div class="row">
      <button id="btn-play">▶ 播放</button>
      <button id="btn-prev" style="flex:0;padding:5px 9px">◀</button>
      <button id="btn-next" style="flex:0;padding:5px 9px">▶|</button>
    </div>
  </div>

  <div class="g">
    <label>帧</label>
    <input type="range" id="frame-slider" min="0" step="1" value="0">
    <div id="frame-info">— / —</div>
  </div>

  <div class="g">
    <label>速度</label>
    <div class="row" style="align-items:center">
      <input type="range" id="speed-slider" min="1" max="60" value="24" step="1">
      <span id="speed-val" style="color:#ffa;min-width:46px;text-align:right">24 fps</span>
    </div>
  </div>

  <div class="g">
    <label>显示</label>
    <div class="row">
      <button id="btn-mesh" class="on">网格</button>
      <button id="btn-points" class="on">关键点</button>
      <button id="btn-bones" class="on">骨骼</button>
    </div>
    <div class="row">
      <button id="btn-grid" class="on">底网</button>
      <button id="btn-axes">轴</button>
      <button id="btn-bg" class="on">底图</button>
    </div>
  </div>
</div>

<script type="importmap">
{ "imports": {
    "three": "/smpl_viewer/vendor/three.module.js",
    "three/addons/controls/OrbitControls.js": "/smpl_viewer/vendor/OrbitControls.js"
} }
</script>
<script type="module" src="/viewer.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace `viewer.js` with the full bootstrap**

```javascript
// label_mocap/smpl_viewer/viewer.js
import * as THREE from 'three';
import { CameraModes } from '/smpl_viewer/camera_modes.js';

// Shared schema with kps3d_viewer.html
// BONES: [child_kp_idx, parent_kp_idx, group]
// SMPL joint indices match the 24-joint convention used by data_convert.
const BONES = [
  [0,3,0],[3,6,0],[6,9,0],[9,12,0],[12,15,0],
  [9,13,1],[13,16,1],[16,18,1],[18,20,1],[20,22,1],
  [9,14,2],[14,17,2],[17,19,2],[19,21,2],[21,23,2],
  [0,1,3],[1,4,3],[4,7,3],[7,10,3],
  [0,2,4],[2,5,4],[5,8,4],[8,11,4],
];
const BONE_COLORS = [0xd4b800, 0x4da6ff, 0xff7733, 0x33cc66, 0xcc44cc];

const ANGLES = [
  ['R-Elbow',16,18,20], ['L-Elbow',17,19,21],
  ['R-Knee',  1, 4, 7], ['L-Knee',  2, 5, 8],
  ['R-Shoulder',9,16,18], ['L-Shoulder',9,17,19],
  ['R-Hip',  0, 1, 4], ['L-Hip',  0, 2, 5],
  ['Spine',  0, 6,12],
];

const params = new URLSearchParams(location.search);
const validate = params.get('validate') === '1';
const validateSeq = params.get('seq');
const validateFrame = parseInt(params.get('frame') || '0', 10);

const $ = id => document.getElementById(id);
const status = $('status');
function setStatus(t) { status.textContent = t; }

// ── Three.js skeleton ─────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({
  canvas: $('c'), antialias: true, preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setClearColor(0x111111, 1);
const scene = new THREE.Scene();

let cam = null;            // CameraModes instance, created after meta loads
let bg = null;             // background image plane
let bgTex = null;
let mesh = null;
let joints3D = null;       // Group containing joint dots and bones
let bonesGroup = null;
let pointsGroup = null;
let frustum = null;
let grid = null;
let axes = null;

const flags = { mesh: true, points: true, bones: true, grid: true, axes: false, bg: true };

function ensureGridAxes() {
  if (!grid) {
    grid = new THREE.GridHelper(20, 40, 0x335577, 0x223344);
    grid.position.y = -1.0;          // below typical body height in src coords
    grid.material.opacity = 0.6;
    grid.material.transparent = true;
    scene.add(grid);
  }
  if (!axes) {
    axes = new THREE.AxesHelper(0.5);
    axes.visible = flags.axes;
    scene.add(axes);
  }
  grid.visible = flags.grid;
  axes.visible = flags.axes;
}

function makeFrustum(meta) {
  // Wireframe frustum from origin in src coords, depth = bgPlaneZ3D + 0.5
  const fovY = THREE.MathUtils.degToRad(2 * Math.atan(meta.image_h / (2 * meta.K.fy)) * 180 / Math.PI);
  const aspect = meta.image_w / meta.image_h;
  const d = 2.0;
  const h = 2 * Math.tan(fovY / 2) * d;
  const w = h * aspect;
  const corners = [
    new THREE.Vector3( w/2,  h/2, -d), new THREE.Vector3(-w/2,  h/2, -d),
    new THREE.Vector3(-w/2, -h/2, -d), new THREE.Vector3( w/2, -h/2, -d),
  ];
  const O = new THREE.Vector3();
  const segs = [
    O, corners[0], O, corners[1], O, corners[2], O, corners[3],
    corners[0], corners[1], corners[1], corners[2],
    corners[2], corners[3], corners[3], corners[0],
  ];
  const geom = new THREE.BufferGeometry().setFromPoints(segs);
  return new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: 0x66aaff }));
}

// ── Sequence loading ──────────────────────────────────────────────────────
let curSeq = null;     // {src,name,meta,faces:Int32Array}
let curFrame = 0;
let curN = 0;
let frameCache = new Map();   // i -> {verts:Float32Array(6890*3), joints:Float32Array(24*3), root:Float32Array(3)}
let playing = false;
let fps = 24;
let lastTickTs = 0;
let accT = 0;

async function loadSeqList() {
  const resp = await fetch('/seqs');
  const j = await resp.json();
  const sel = $('seq-select');
  sel.innerHTML = '';
  j.seqs.forEach(s => {
    const o = document.createElement('option');
    o.value = `${s.src}/${s.name}`;
    o.textContent = `${s.src}/${s.name} (${s.n_frames}f${s.portrait ? ', portrait' : ''})`;
    sel.appendChild(o);
  });
  return j.seqs;
}

async function selectSeq(seqId) {
  const [src, name] = seqId.split('/');
  setStatus(`loading meta for ${seqId}…`);
  const meta = await (await fetch(`/seq/${src}/${name}/meta`)).json();
  setStatus(`forwarding SMPL (~10s on first call)…`);
  const facesBuf = await (await fetch(meta.faces_url)).arrayBuffer();
  const faces = new Int32Array(facesBuf);

  // Reset state
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
  if (bonesGroup) { scene.remove(bonesGroup); bonesGroup = null; }
  if (pointsGroup) { scene.remove(pointsGroup); pointsGroup = null; }
  if (frustum) { scene.remove(frustum); frustum.geometry.dispose(); frustum.material.dispose(); frustum = null; }
  if (bg) { scene.remove(bg); bg.geometry.dispose(); bg.material.dispose(); bg = null; }
  if (bgTex) { bgTex.dispose(); bgTex = null; }
  frameCache.clear();

  curSeq = { src, name, meta, faces };
  curN = meta.n_frames;
  curFrame = 0;

  $('frame-slider').max = curN - 1;
  $('frame-info').textContent = `0 / ${curN - 1}`;

  // Build static scene parts
  ensureGridAxes();
  cam = new CameraModes({ canvas: renderer.domElement, meta });
  // background plane (texture set per-frame)
  bg = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ depthWrite: false }));
  bg.renderOrder = 0;
  scene.add(bg);
  // mesh
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6890 * 3), 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
  geom.computeVertexNormals();
  mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    color: 0x00dd00, wireframe: true, depthTest: false, depthWrite: false,
  }));
  mesh.renderOrder = 10;
  scene.add(mesh);
  // joints (points + bones group)
  pointsGroup = new THREE.Group();
  pointsGroup.renderOrder = 11;
  scene.add(pointsGroup);
  for (let i = 0; i < 24; i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false }));
    p.renderOrder = 11;
    pointsGroup.add(p);
  }
  bonesGroup = new THREE.Group();
  bonesGroup.renderOrder = 11;
  scene.add(bonesGroup);
  for (const [, , g] of BONES) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: BONE_COLORS[g], depthTest: false }));
    line.renderOrder = 11;
    bonesGroup.add(line);
  }
  frustum = makeFrustum(meta);
  scene.add(frustum);

  await loadFrame(0);
  applyMode(cam.mode);  // sets visibility
  setStatus(`${seqId} ready (${curN} frames)`);
}

async function loadFrame(i) {
  if (frameCache.has(i)) return frameCache.get(i);
  const { src, name } = curSeq;
  const buf = await (await fetch(`/seq/${src}/${name}/frame/${i}.bin`)).arrayBuffer();
  const verts = new Float32Array(buf, 0, 6890 * 3);
  const joints = new Float32Array(buf, 6890 * 3 * 4, 24 * 3);
  const root = new Float32Array(buf, (6890 * 3 + 24 * 3) * 4, 3);
  const entry = { verts, joints, root };
  frameCache.set(i, entry);
  return entry;
}

async function setFrame(i) {
  curFrame = Math.max(0, Math.min(curN - 1, i | 0));
  $('frame-slider').value = curFrame;
  $('frame-info').textContent = `${curFrame} / ${curN - 1}`;

  const f = await loadFrame(curFrame);
  // mesh
  const pos = mesh.geometry.attributes.position;
  pos.array.set(f.verts);
  pos.needsUpdate = true;
  // joints
  for (let j = 0; j < 24; j++) {
    const x = f.joints[j * 3], y = f.joints[j * 3 + 1], z = f.joints[j * 3 + 2];
    pointsGroup.children[j].position.set(x, y, z);
  }
  for (let bi = 0; bi < BONES.length; bi++) {
    const [a, b] = BONES[bi];
    const line = bonesGroup.children[bi];
    line.geometry.setFromPoints([
      new THREE.Vector3(f.joints[a * 3], f.joints[a * 3 + 1], f.joints[a * 3 + 2]),
      new THREE.Vector3(f.joints[b * 3], f.joints[b * 3 + 1], f.joints[b * 3 + 2]),
    ]);
    line.geometry.attributes.position.needsUpdate = true;
  }
  // 3D follow target = pelvis (joint 0)
  cam.set3DFollowTarget(new THREE.Vector3(f.joints[0], f.joints[1], f.joints[2]));
  // background image
  const newTex = await new Promise(resolve => {
    new THREE.TextureLoader().load(`/seq/${curSeq.src}/${curSeq.name}/img/${curFrame}.jpg`, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      resolve(t);
    });
  });
  if (bgTex) bgTex.dispose();
  bgTex = newTex;
  bg.material.map = bgTex;
  bg.material.needsUpdate = true;
  layoutBg();
  // joint angles
  renderAngles(f.joints);
}

function layoutBg() {
  const p = cam.bgPlaneParams();
  bg.geometry.dispose();
  bg.geometry = new THREE.PlaneGeometry(p.w, p.h);
  bg.position.set(0, 0, p.z);
  bg.visible = flags.bg;
  frustum.visible = (cam.mode === '3d');
}

function renderAngles(joints) {
  const html = ANGLES.map(([label, a, v, b]) => {
    const ax = joints[a*3]-joints[v*3], ay = joints[a*3+1]-joints[v*3+1], az = joints[a*3+2]-joints[v*3+2];
    const bx = joints[b*3]-joints[v*3], by = joints[b*3+1]-joints[v*3+1], bz = joints[b*3+2]-joints[v*3+2];
    const la = Math.hypot(ax,ay,az), lb = Math.hypot(bx,by,bz);
    let deg = 0;
    if (la > 1e-9 && lb > 1e-9) {
      const c = Math.min(1, Math.max(-1, (ax*bx + ay*by + az*bz) / (la*lb)));
      deg = Math.acos(c) * 180 / Math.PI;
    }
    return `<div class="ar"><span>${label}</span><span>${deg.toFixed(1)}°</span></div>`;
  }).join('');
  $('angle-list').innerHTML = html;
}

function applyMode(mode) {
  $('btn-mode-3d').classList.toggle('on', mode === '3d');
  $('btn-mode-2d').classList.toggle('on', mode === '2d');
  layoutBg();
}

// ── UI wiring ──────────────────────────────────────────────────────────────
$('seq-select').addEventListener('change', e => selectSeq(e.target.value));
$('btn-mode-3d').addEventListener('click', () => { cam.switchTo('3d'); applyMode('3d'); });
$('btn-mode-2d').addEventListener('click', () => { cam.switchTo('2d'); applyMode('2d'); });
$('btn-play').addEventListener('click', () => {
  playing = !playing;
  $('btn-play').textContent = playing ? '⏸ 暂停' : '▶ 播放';
  $('btn-play').classList.toggle('on', playing);
});
$('btn-prev').addEventListener('click', () => setFrame(curFrame - 1));
$('btn-next').addEventListener('click', () => setFrame(curFrame + 1));
$('frame-slider').addEventListener('input', e => setFrame(+e.target.value));
$('speed-slider').addEventListener('input', e => {
  fps = +e.target.value; $('speed-val').textContent = `${fps} fps`;
});
const flagBtns = [
  ['btn-mesh','mesh'], ['btn-points','points'], ['btn-bones','bones'],
  ['btn-grid','grid'], ['btn-axes','axes'], ['btn-bg','bg'],
];
flagBtns.forEach(([id, key]) => {
  $(id).addEventListener('click', e => {
    flags[key] = !flags[key];
    e.target.classList.toggle('on', flags[key]);
    if (mesh && key === 'mesh') mesh.visible = flags.mesh;
    if (pointsGroup && key === 'points') pointsGroup.visible = flags.points;
    if (bonesGroup && key === 'bones') bonesGroup.visible = flags.bones;
    if (grid && key === 'grid') grid.visible = flags.grid;
    if (axes && key === 'axes') axes.visible = flags.axes;
    if (bg && key === 'bg') bg.visible = flags.bg;
  });
});

window.addEventListener('resize', resize);
function resize() {
  const c = renderer.domElement;
  const w = c.clientWidth, h = c.clientHeight;
  renderer.setSize(w, h, false);
  if (cam) {
    cam.camera.aspect = w / h;
    cam.camera.updateProjectionMatrix();
  }
}

// ── Render loop ────────────────────────────────────────────────────────────
async function tick(ts) {
  requestAnimationFrame(tick);
  if (playing && curN > 0) {
    accT += ts - lastTickTs;
    const iv = 1000 / fps;
    if (accT >= iv) {
      accT = accT % iv;
      await setFrame((curFrame + 1) % curN);
    }
  }
  lastTickTs = ts;
  if (cam) {
    cam.update(ts);
    layoutBg();    // 3D bg plane stays at constant near distance regardless of orbit
    renderer.render(scene, cam.camera);
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
(async function () {
  const seqs = await loadSeqList();
  resize();
  if (validate) {
    // Validate-mode auto-flow: pick seq, switch to 2D instantly, render, download.
    if (validateSeq) {
      $('seq-select').value = validateSeq;
      await selectSeq(validateSeq);
      // jump to 2D pose immediately (skip slerp by snapping)
      cam.switchTo('2d');
      // advance the tween to completion
      cam.update(performance.now() + 9999);
      applyMode('2d');
      await setFrame(validateFrame);
      renderer.render(scene, cam.camera);
      const tag = `${validateSeq.replace('/', '_')}_f${String(validateFrame).padStart(4, '0')}`;
      const a = document.createElement('a');
      a.download = `viewer_${tag}.png`;
      a.href = renderer.domElement.toDataURL('image/png');
      a.click();
      setStatus(`saved viewer_${tag}.png`);
      return;
    }
  }
  if (seqs.length > 0) await selectSeq(seqs[0].src + '/' + seqs[0].name);
  requestAnimationFrame(ts => { lastTickTs = ts; tick(ts); });
})();
```

- [ ] **Step 3: Smoke-run the full viewer in a browser**

```bash
PY=/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap
$PY smpl_viewer/server.py --raw-root /root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw --port 5173
```

In the browser:

1. Open `http://localhost:5173/`. The dropdown shows all seqs; the first auto-loads.
2. Confirm 3D mode: orbit with mouse, see frustum + bg plane near, mesh + bones + joints in src coords.
3. Drag frame slider — mesh + image + joint angles all update.
4. Click "2D 对齐" — camera slerps over 1 second to 2D, mesh snaps onto the bg image.
5. Click "3D 自由" — slerps back to the previous orbit pose.
6. Click "播放" — plays at 24 fps.
7. Click each of mesh/points/bones/grid/axes/bg buttons — toggles work.
8. Switch sequences via dropdown — old mesh/bg disappear, new one loads.

- [ ] **Step 4: Re-run validate-mode end-to-end with the new viewer**

```bash
# After regenerating GT via Task 2 commands…
# Open these URLs (each auto-downloads viewer_<tag>.png):
#   http://localhost:5173/?validate=1&seq=olympic/a_famale_70&frame=0
#   http://localhost:5173/?validate=1&seq=10m/TiaoShui_a_male_5500_597&frame=0
#   http://localhost:5173/?validate=1&seq=10m/TiaoShui_a_male_5500_597&frame=300
#   http://localhost:5173/?validate=1&seq=10m/TiaoShui_a_male_5500_597&frame=596
$PY smpl_viewer/compare_alignment.py --gt-dir /tmp/align_gt --viewer-dir /tmp/align_viewer --max-px 2.0
```
Expected: all `OK`, exit 0. (Confirms Task 6 + Task 7 didn't regress alignment.)

- [ ] **Step 5: Commit**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap
git add smpl_viewer/viewer.html smpl_viewer/viewer.js
git commit -m "feat(smpl_viewer): full UI — sequence list, slider/play, mesh+joints, 3D/2D toggle"
```

---
## Task 8: Final pass — full test run, README polish, finishing review

**Files:**
- Modify: `label_mocap/smpl_viewer/README.md`

- [ ] **Step 1: Run the full pytest suite**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap && \
/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python -m pytest -v
```
Expected: all tests from Tasks 1, 2, 3, 4 pass — 18 tests total (4 + 4 + 4 + 6).

- [ ] **Step 2: Re-run the alignment proof for both fixtures**

Same as Task 7 Step 4 — confirm landscape and portrait both pass `compare_alignment.py --max-px 2.0`.

- [ ] **Step 3: Spec-coverage self-check**

Open `docs/superpowers/specs/2026-06-09-smpl-viewer-design.md` next to this plan. For each numbered requirement and 自测项, confirm a task implements it. The expected mapping:

| Spec requirement | Task |
|---|---|
| Backend `/seqs` `/meta` `/faces.bin` `/frame/<i>.bin` `/img/<i>.jpg` | T3, T4 |
| `coord` kwarg on `process_diving_sequence` | T1 |
| Source-coordinate forward (no rotation) | T1, T2 |
| Cached SMPL forward per-seq | T4 |
| `viewer.html` + Three.js + ES modules + importmap | T5, T7 |
| One PerspectiveCamera, src coords | T6, T7 |
| 3D mode: OrbitControls + frustum + near-plane bg | T6, T7 |
| 2D mode: at origin, looking -Z, fov_y from intrinsics, setViewOffset | T5, T6, T7 |
| 1-second slerp between modes, ease-in-out | T6 |
| Save & restore prior pose per-mode | T6 |
| 24 keypoints + bone groups (sharing kps3d_viewer's BONES) | T7 |
| Frame slider, play/pause, speed, dropdown | T7 |
| Joint-angle panel (sharing kps3d_viewer's ANGLES) | T7 |
| Alignment validation pre-interaction (gate) | T2, T5 |
| `validate=1` URL param auto-downloads PNG | T5, T7 |
| `compare_alignment.py` mesh-edge offset < 2px | T5 |
| `verts.byteLength === 6890*3*4` (binary frame layout) | T4 (test_frame_bin_layout) |
| `frame/<i>.bin` shape correct | T4 |
| Mode switch round-trip preserves pose | T6 (`_capturePose('auto')`) |
| Sequence switch clears prior state | T7 (selectSeq disposes/clears) |

If anything is unmapped, add a follow-up task before merging.

- [ ] **Step 4: Update README with troubleshooting section**

Append to `smpl_viewer/README.md`:

```markdown
## Troubleshooting

- **First frame request hangs ~10s** — first call to `/frame/0.bin` triggers a
  whole-sequence SMPL forward in Python. Subsequent frames are <50ms (cache
  hit). The cache lives in process memory until restart; ~50 MB per sequence.
- **portrait sequence appears sideways in 2D mode** — this is expected. Raw
  JPGs are unrotated (1920×1080), and the SMPL pose data is in the same
  orientation. The validate alignment is still pixel-tight on the body
  silhouette. Future task (out of scope here): an explicit display-rotate
  toggle so the user can flip the canvas 90° for portrait sequences.
- **`compare_alignment.py` reports > 2 px** — review the Task 5 Step 6
  debug checklist in `docs/superpowers/plans/2026-06-09-smpl-viewer.md`.
- **Three.js 404 in browser console** — the `/smpl_viewer/<path>` route
  serves `vendor/three.module.js`. Confirm it returns 200 with `curl -I
  http://localhost:5173/smpl_viewer/vendor/three.module.js`.
- **`pytest` cannot import `data_convert`** — `tests/conftest.py` injects
  the rollout repo path; if you renamed it, update `ROLLOUT` there.

## Architecture cheat sheet

```
Browser                              Flask server
─────────                            ───────────
viewer.html                          /                  → viewer.html
  ├─ /viewer.js (ES module)          /viewer.js         → static
  └─ importmap → /smpl_viewer/...    /smpl_viewer/<*>   → static
  
viewer.js
  ├─ fetch /seqs                     /seqs              → scan dataset
  ├─ fetch /seq/<src>/<name>/meta    /seq/.../meta      → image dims + K
  ├─ fetch faces.bin (one-shot)      /seq/.../faces.bin → SMPL faces (Int32)
  ├─ fetch frame/<i>.bin (per-frame) /seq/.../frame/<i> → verts+joints+root
  ├─ fetch img/<i>.jpg (per-frame)   /seq/.../img/<i>   → raw JPG
  └─ camera_modes.js                 (no server side)
```
```

- [ ] **Step 5: Commit and close out**

```bash
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project/label_mocap
git add smpl_viewer/README.md
git commit -m "docs(smpl_viewer): troubleshooting + architecture cheat sheet"
```

- [ ] **Step 6: Use superpowers:finishing-a-development-branch**

Implementation is complete and validated; switch to that skill to decide on PR / merge / cleanup.

---

## Self-Review Notes (engineer reading this plan, please verify)

- **No placeholder content**: every code block is concrete; no "TBD"/"similar to". Task 4 Step 3 includes a `abort(500)` deliberately as a sentinel that Step 4 of the same task replaces — this is intentional scaffolding within a task, not a cross-task placeholder.
- **Type consistency**:
  - Frame binary layout is `(6890*3 + 24*3 + 3) * 4` bytes everywhere (T4 server, T4 tests, T7 viewer.js `loadFrame`).
  - `meta.K = {fx, fy, cx, cy}` — same shape in T3 server, T3 tests, T6 `CameraModes` constructor, T7 viewer.
  - `meta.image_w / image_h` (not `width / height`) used consistently.
  - Mode names `'3d'` / `'2d'` (lowercase, string) consistent in `CameraModes.switchTo`, `applyMode`, button state.
- **Spec gaps explicitly handled**: portrait display-rotate toggle from spec is **deferred** with a README note (see Troubleshooting). The spec's "portrait序列把贴图平面绕 -Z 旋 90° CW" (line 77) is in 3D mode only — Task 7's `layoutBg` does not implement this rotation; the 2D-aligned proof works without it because alignment is between mesh and image **as captured**, not as displayed upright. If the validation step in Task 5 fails because the user expected an upright canvas, the README points to the deferred toggle as the future fix.
- **External coupling**: only one cross-repo edit (`diving_convert.py`, T1). Two separate commits land in two different repos (T1 Step 5).
