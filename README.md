# label_mocap

Browser-only SMPL / MHR pose viewers and annotators. Every page is static ES
modules; data is chosen locally in the browser and never uploaded. Python and
`tools/` are offline tooling only.

## Main Entry

```bash
npm run serve
# or
make serve
```

Open <http://127.0.0.1:8902/>. The root `index.html` is the landing page linking
every app (it is also the GitHub Pages entry):

| Page | What it is |
| --- | --- |
| `smpl_viewer/viewer.html` | Read-only SMPL sequence viewer. |
| `label/` | SMPL annotator on images / video (single view). |
| `mhr_label/` | MHR (sam-3d-body) annotator on calibrated multi-view video. |
| `pcd_label/` | SMPL annotator on LiDAR point clouds. |
| `kpt_label/` | 2D keypoint annotator. |

During development serve with the repo static server (it sends `no-store`, so
edited ES modules are never served stale): `npm run serve:label` → `:5175`.

## Tests

The reproducible top-level test entry does not require `pytest`. It needs Node 18+
and a `python3` with `numpy` (`pip install -r requirements.txt`):

```bash
npm test
# or
make test
```

Equivalent split commands:

```bash
npm run test:web
npm run test:tools
npm run test:server
```

The legacy `pytest.ini` remains for the older Python math/data tests. Those
tests require `pytest`, `numpy`, and local raw diving fixtures, so they are not
the default engineering smoke test.

## Project Map

| Path | Role |
| --- | --- |
| `smpl_core/` | Pure body-model math: SMPL / MHR forward, `BodyModel` interface. |
| `smpl_edit/` | Shared editing kernel: pose state, annotation store, handles, IK plugin, shortcuts. |
| `smpl_render/` | Shared rendering: renderer, 2D/3D camera modes, zoom / view rotation / transition, view recorder. |
| `label/`, `mhr_label/`, `pcd_label/`, `kpt_label/` | Annotator apps (`index.html` + `src/app.js` assemble the kernels). |
| `tools/mhr/` | Offline MHR tooling: web-model export, sam-3d-body bundle converter, camera estimate, batch derivation. |
| `smpl_viewer/` | Read-only local-data viewer and compatibility static server. |
| `smpl_web_viewer/` | Static sample viewer, Web SMPL runtime, exporters, and most JS/Python unit tests. |
| `tests/` | Top-level smoke tests for current static serving and local-data browser helpers. |
| `kps3d/` | Older 3D keypoint viewer/reference UI. |
| `docs/` | `CONTRACTS.md` (cross-annotator contract), `mhr-data-notes.md` (MHR model/data/calibration facts), GVHMR CORS requirement. |

## Ports And Scripts

| Command | Port | Purpose |
| --- | ---: | --- |
| `npm run serve` / `make serve` / `bash smpl_viewer/run.sh` | 8902 | Main viewer from repo root. |
| `python3 -m smpl_viewer.server` | 8902 | Python stdlib static compatibility server. |
| `npm run serve:web` / `make serve-web` | 5174 | `smpl_web_viewer` sample app. |
| `npm run serve:label` / `serve:pcd` / `serve:kpt` | 5175 / 5176 / 5177 | Repo root via `smpl_web_viewer/tools/static_server.mjs`; open the app path. |

## Assets

See `ASSETS.md` for runtime, offline, debug-only, and sample asset boundaries.
In particular, `smpl_web_viewer/public/debug/**` is debug-only and is loaded
only when the sample app is opened with `?debugRef=1`.

## Branch Policy

`main` is the deployable branch for the static viewer. Keep runtime assets
needed by GitHub Pages as normal files, not Git LFS pointers. Large source SMPL
assets and debug reference meshes may be LFS-backed only when they are not
required by the Pages runtime.
