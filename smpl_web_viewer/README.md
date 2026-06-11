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
node --test tests/*.test.js
PYTHONPATH=. python3 -m unittest discover -s tests -p 'test_*.py'
```

## Verified

Fresh verification on 2026-06-10:

- `node --test smpl_web_viewer/tests/*.test.js`: 47 tests passed.
- `PYTHONPATH=smpl_web_viewer python3 -m unittest discover -s smpl_web_viewer/tests -p 'test_*.py'`: 17 tests passed.
- `PYTHONPATH=. python3 smpl_web_viewer/tools/export_smpl_model.py --pkl smpl_viewer/_data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl --out smpl_web_viewer/public/models`: generated `smpl_neutral.meta.json`, `smpl_neutral.f32.bin`, and `smpl_neutral.i32.bin`.
- `PYTHONPATH=smpl_web_viewer/tools python3 smpl_web_viewer/tools/make_sample_assets.py --source /Users/penghaotian/Downloads/20260609/a_famale_224 --out smpl_web_viewer/public/samples/a_famale_224`: generated `manifest.json` and `a1..a4/sequence.json` without copying images.
- `node tools/static_server.mjs --root . --port 5174`: served `index.html`, `src/app.js`, vendored Three.js, model metadata, and sample sequence JSON over local HTTP.
