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
