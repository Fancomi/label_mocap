# SMPL Web Viewer

Pure Web runtime for SMPL playback. Runtime loads local static assets only:
SMPL model constants, sequence JSON, image/video background, and vendored JS.

## Run

```bash
cd smpl_web_viewer
node tools/static_server.mjs --root . --port 5174
```

Open http://127.0.0.1:5174/.

The viewer expects local sample assets under `public/`. Generated model
constants live in `public/models/` and are loaded as static JSON/bin assets.

## Test

```bash
cd smpl_web_viewer
npm test
npm run test:tools
```

From the repository root, prefer the unified commands:

```bash
npm run test:web
npm run test:tools
```

## Debug Reference Mesh

`public/debug/**` is a Python reference mesh used only for alignment debugging.
The app does not load it by default. Open with `?debugRef=1` to enable the red
reference overlay:

```txt
http://127.0.0.1:5174/?debugRef=1
```

## Verified

Fresh verification on 2026-06-11:

- Root `npm run test:web`: 61 JS tests passed.
- Package-local `npm test`: 53 JS tests passed.
- Root/package `test:tools`: 19 Python unittest tests passed.
- `PYTHONPATH=. python3 smpl_web_viewer/tools/export_smpl_model.py --pkl smpl_viewer/_data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl --out smpl_web_viewer/public/models`: generated `smpl_neutral.meta.json`, `smpl_neutral.f32.bin`, and `smpl_neutral.i32.bin`.
- `PYTHONPATH=smpl_web_viewer/tools python3 smpl_web_viewer/tools/make_sample_assets.py --source /Users/penghaotian/Downloads/20260609/a_famale_224 --out smpl_web_viewer/public/samples/a_famale_224`: generated `manifest.json` and `a1..a4/sequence.json` without copying images.
- `node tools/static_server.mjs --root . --port 5174`: served `index.html`, `src/app.js`, vendored Three.js, model metadata, and sample sequence JSON over local HTTP.
