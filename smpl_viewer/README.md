# SMPL Viewer

Browser-only SMPL viewer. The page loads SMPL model constants from this repo,
then asks the user to select a local `a1` data directory in the browser. Runtime
data stays local; there is no Python, Flask, torch, pickle, OpenCV, or network
data API in the playback path.

## Run Locally

```bash
bash smpl_viewer/run.sh
```

Open <http://127.0.0.1:8902/>. The root page redirects to
`smpl_viewer/viewer.html`.

Optional arguments:

```bash
bash smpl_viewer/run.sh 8765
bash smpl_viewer/run.sh 8765 0.0.0.0
```

## Use Data

Click `选择本地 a1 目录` and select a directory like:

```txt
a_famale_224/a/a1
```

The viewer reads:

```txt
json_results/player_0/player_0.json
images/*.jpg
```

From `player_0.json`, each annotation frame must provide:

```txt
root_pos
root_rota
body_pose
betas
frame or image_id
```

If a browser does not support directory selection, the fallback flow first asks
for `player_0.json`, then opens a second picker for the JPG frames.

## GitHub Pages

The repository root `index.html` redirects to `smpl_viewer/viewer.html`, and
the viewer uses relative module, worker, vendor, and model paths. This lets the
same page work from a GitHub Pages project URL such as:

```txt
https://<user>.github.io/<repo>/smpl_viewer/viewer.html
```

The Web runtime model assets are stored as normal repo files under:

```txt
smpl_web_viewer/public/models/
```

Do not put these runtime model `.bin` files in Git LFS if the page is expected
to run on GitHub Pages.
