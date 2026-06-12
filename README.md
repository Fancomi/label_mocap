# label_mocap

SMPL/3D pose viewing utilities. The current main entry is the browser-only
SMPL viewer at `smpl_viewer/viewer.html`; it loads static model assets from the
repo and asks the user to choose local sequence data in the browser.

## Main Entry

```bash
npm run serve
# or
make serve
```

Open <http://127.0.0.1:8902/>. The root page redirects to
`smpl_viewer/viewer.html`.

GitHub Pages uses the repository root `index.html`, which also redirects to the
same viewer. A Pages URL should look like:

```txt
https://<user>.github.io/<repo>/smpl_viewer/viewer.html
```

## Tests

The reproducible top-level test entry does not require `pytest`:

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
| `smpl_viewer/` | Current browser-only local-data viewer and compatibility static server. |
| `smpl_web_viewer/` | Static sample viewer, Web SMPL runtime, exporters, and most JS/Python unit tests. |
| `tests/` | Top-level smoke tests for current static serving and local-data browser helpers. |
| `kps3d/` | Older 3D keypoint viewer/reference UI. |
| `docs/superpowers/` | Historical specs and plans; useful context, not runtime entry points. |

## Ports And Scripts

| Command | Port | Purpose |
| --- | ---: | --- |
| `npm run serve` / `make serve` / `bash smpl_viewer/run.sh` | 8902 | Main viewer from repo root. |
| `python3 -m smpl_viewer.server` | 8902 | Python stdlib static compatibility server. |
| `npm run serve:web` / `make serve-web` | 5174 | `smpl_web_viewer` sample app. |

## Assets

See `ASSETS.md` for runtime, offline, debug-only, and sample asset boundaries.
In particular, `smpl_web_viewer/public/debug/**` is debug-only and is loaded
only when the sample app is opened with `?debugRef=1`.

## Branch Policy

`main` is the deployable branch for the static viewer. Keep runtime assets
needed by GitHub Pages as normal files, not Git LFS pointers. Large source SMPL
assets and debug reference meshes may be LFS-backed only when they are not
required by the Pages runtime.
