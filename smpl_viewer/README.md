# SMPL Viewer

HTML observer for diving SMPL sequences. One PerspectiveCamera, slerps between 3D-orbit and 2D-aligned views. Backend runs SMPL forward in source coordinates and ships binary frame data.

## Setup

All commands assume:

```bash
PY=/root/paddlejob/workspace/env_run/penghaotian/envs/lidar/bin/python
cd /root/paddlejob/workspace/env_run/penghaotian/sport_project
```

## Run

```bash
$PY label_mocap/smpl_viewer/server.py \
  --raw-root /root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw \
  --port 5173
```

Open <http://localhost:5173/>. Pick a sequence from the dropdown.

## Validate alignment

The fully-automated gate is `tests/test_camera_math.py` — it proves the
Three.js camera setup reproduces `project_src` algebraically. Run
`$PY -m pytest tests/test_camera_math.py -v`. The browser-based visual
check below is a future-manual sanity step.

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
$PY -m pytest
```

## Troubleshooting

- **First frame request hangs ~10s** — first call to `/frame/0.bin` triggers a
  whole-sequence SMPL forward in Python. Subsequent frames are <50ms (cache
  hit). The cache lives in process memory until restart; ~50 MB per sequence.
- **portrait sequence appears sideways in 2D mode** — this is expected. Raw
  JPGs are unrotated (1920×1080), and the SMPL pose data is in the same
  orientation. The algebraic alignment gate (`tests/test_camera_math.py`) is
  still tight on the body silhouette. Future task (out of scope here): an
  explicit display-rotate toggle so the user can flip the canvas 90° for
  portrait sequences.
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
