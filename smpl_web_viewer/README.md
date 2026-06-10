# SMPL Web Viewer

Pure Web runtime for SMPL playback. Runtime loads local static assets only:
SMPL model constants, sequence JSON, image/video background, and vendored JS.

## Run

```bash
cd smpl_web_viewer
node tools/static_server.mjs --root . --port 5174
```

Open http://127.0.0.1:5174/.

## Test

```bash
cd smpl_web_viewer
node --test tests/*.test.js
```
