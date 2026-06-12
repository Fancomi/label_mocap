# Asset Boundaries

This repo contains runtime assets, offline conversion inputs, debug references,
and small samples. Keep these categories separate so GitHub Pages and local
tests remain predictable.

| Path | Category | Required at runtime | Notes |
| --- | --- | --- | --- |
| `smpl_web_viewer/public/models/smpl_neutral.meta.json` | Web runtime model | Yes | Loaded by both current viewers. |
| `smpl_web_viewer/public/models/smpl_neutral.f32.bin` | Web runtime model | Yes | Must be a real file for GitHub Pages. |
| `smpl_web_viewer/public/models/smpl_neutral.i32.bin` | Web runtime model | Yes | Must be a real file for GitHub Pages. |
| `smpl_viewer/vendor/` | Web runtime vendor JS | Yes | Vendored Three.js for `smpl_viewer/viewer.html`. |
| `smpl_web_viewer/public/vendor/` | Web runtime vendor JS | Yes for sample app | Vendored Three.js for `smpl_web_viewer/index.html`. |
| `smpl_viewer/_data/smpl/*.pkl` and `*.npy` | Offline Python SMPL source | No | Used by Python tools/tests/exporters, not by browser playback. |
| `smpl_web_viewer/tools/` | Offline tooling | No | Converts source SMPL and sequence data into static Web assets. |
| `smpl_web_viewer/public/samples/a_famale_224/` | Sample sequence | Only for sample app | Static sample JSON; images are referenced but not copied. |
| `smpl_web_viewer/public/debug/` | Debug-only reference mesh | No | Loaded only with `?debugRef=1`; may be LFS-backed. |
| `kps3d/kps3d.json` | Legacy/sample keypoint data | No | Used by the older keypoint viewer. |

GitHub Pages cannot serve unresolved Git LFS pointer files as usable binary
assets. Any asset loaded by default from a Pages route must be committed as a
normal file.
