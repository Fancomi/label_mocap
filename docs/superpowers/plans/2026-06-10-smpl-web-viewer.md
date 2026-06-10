# SMPL Web Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `smpl_web_viewer/`, a pure Web SMPL viewer that loads local SMPL model constants and SMPL parameter JSON, computes vertices/joints in a browser Worker using CPU TypedArrays, and renders playback with Three.js.

**Architecture:** Keep the existing `smpl_viewer/` untouched. Add a sibling static app with no npm runtime dependencies: ES modules, vendored Three.js, Node built-in tests, and a tiny Node static server for local HTTP. Use Python only for offline conversion tools; browser runtime reads `.json`/`.bin` files and never calls Python or loads precomputed per-frame mesh.

**Tech Stack:** JavaScript ES modules, Node `node:test`, Web Worker / `worker_threads`, Three.js r160 copied from `smpl_viewer/vendor/`, Python stdlib + numpy/scipy for offline conversion, TypedArray binary assets.

---

## File Structure

Create:

```text
smpl_web_viewer/
├── README.md                         # Run, convert, test, and offline constraints
├── index.html                        # First screen is the viewer
├── package.json                      # type=module and local test scripts only
├── tools/
│   ├── static_server.mjs             # No-dependency static HTTP server
│   ├── export_smpl_model.py          # Offline pkl -> meta/bin converter
│   ├── convert_sequence.py           # pose_files JSON -> sequence.json
│   └── make_sample_assets.py         # Build local sample from a_famale_224
├── public/
│   ├── models/.gitkeep
│   ├── samples/.gitkeep
│   └── vendor/
│       ├── three.module.js           # Copied from smpl_viewer/vendor
│       └── OrbitControls.js          # Copied from smpl_viewer/vendor
├── src/
│   ├── app.js                        # App bootstrap and UI wiring
│   ├── data/
│   │   └── sequence_loader.js        # Fetch/validate sequence JSON
│   ├── smpl/
│   │   ├── math3d.js                 # Matrix/vector helpers
│   │   ├── smpl_model.js             # Fetch model meta/bin and slice TypedArrays
│   │   ├── lbs.js                    # CPU SMPL forward
│   │   └── smpl_worker.js            # Worker protocol and frame cache
│   └── viewer/
│       ├── camera_modes.js           # Projection/alignment helpers
│       ├── background.js             # Image sequence/video abstraction
│       ├── playback.js               # Frame clock and controls state
│       └── scene.js                  # Three.js scene objects
└── tests/
    ├── test_exporter.py              # stdlib unittest for binary writer helpers
    ├── test_sequence_converter.py    # stdlib unittest for parameter normalization
    ├── smpl_math.test.js             # Node tests for math3d
    ├── smpl_model.test.js            # Node tests for model loader on tiny fixture
    ├── lbs.test.js                   # Node tests for toy LBS
    ├── smpl_worker.test.js           # Node worker_threads protocol test
    └── fixtures/
        └── tiny_model/
            ├── tiny.meta.json
            ├── tiny.f32.bin
            └── tiny.i32.bin
```

Modify:

```text
docs/superpowers/plans/2026-06-10-smpl-web-viewer.md
```

Do not modify:

```text
smpl_viewer/
tests/                      # existing Python viewer tests remain as-is
```

---

## Task 1: Static App Skeleton

**Files:**
- Create: `smpl_web_viewer/package.json`
- Create: `smpl_web_viewer/index.html`
- Create: `smpl_web_viewer/README.md`
- Create: `smpl_web_viewer/tools/static_server.mjs`
- Create: `smpl_web_viewer/public/models/.gitkeep`
- Create: `smpl_web_viewer/public/samples/.gitkeep`
- Create: `smpl_web_viewer/public/vendor/three.module.js`
- Create: `smpl_web_viewer/public/vendor/OrbitControls.js`
- Create: `smpl_web_viewer/src/app.js`

- [ ] **Step 1: Create the failing smoke test**

Create `smpl_web_viewer/tests/static_app.test.js`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('index loads app module and local vendor import map', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<script type="module" src="\.\/src\/app\.js"><\/script>/);
  assert.match(html, /public\/vendor\/three\.module\.js/);
  assert.doesNotMatch(html, /https?:\/\//);
});
```

- [ ] **Step 2: Run the failing smoke test**

Run:

```bash
node --test smpl_web_viewer/tests/static_app.test.js
```

Expected: FAIL with `ENOENT` for `smpl_web_viewer/index.html`.

- [ ] **Step 3: Add minimal static app files**

Create `smpl_web_viewer/package.json`:

```json
{
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.js",
    "serve": "node tools/static_server.mjs --root . --port 5174"
  }
}
```

Create `smpl_web_viewer/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SMPL Web Viewer</title>
  <script type="importmap">
    {
      "imports": {
        "three": "./public/vendor/three.module.js",
        "three/addons/controls/OrbitControls.js": "./public/vendor/OrbitControls.js"
      }
    }
  </script>
  <link rel="stylesheet" href="./src/viewer/style.css">
</head>
<body>
  <main id="app" class="shell">
    <aside class="panel">
      <h1>SMPL Web Viewer</h1>
      <button id="loadSample" type="button">Load sample</button>
      <button id="playPause" type="button">Play</button>
      <input id="frameSlider" type="range" min="0" max="0" value="0">
      <output id="status">Idle</output>
    </aside>
    <section id="viewport" class="viewport" aria-label="SMPL viewport"></section>
  </main>
  <script type="module" src="./src/app.js"></script>
</body>
</html>
```

Create `smpl_web_viewer/src/app.js`:

```js
const statusEl = document.querySelector('#status');
statusEl.textContent = 'Static app loaded';
```

Create `smpl_web_viewer/tools/static_server.mjs`:

```js
import { createReadStream, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { createServer } from 'node:http';

const args = new Map(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v, a[i + 1]] : []));
const root = resolve(args.get('--root') ?? '.');
const port = Number(args.get('--port') ?? 5174);
const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.bin', 'application/octet-stream'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png']
]);

createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = resolve(join(root, rel));
  if (!file.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not file');
    res.writeHead(200, { 'content-type': types.get(extname(file)) ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`SMPL Web Viewer static server: http://127.0.0.1:${port}/`);
});
```

Create empty `.gitkeep` files under `public/models` and `public/samples`.

Copy vendor files:

```bash
mkdir -p smpl_web_viewer/public/vendor
cp smpl_viewer/vendor/three.module.js smpl_web_viewer/public/vendor/three.module.js
cp smpl_viewer/vendor/OrbitControls.js smpl_web_viewer/public/vendor/OrbitControls.js
```

Create `smpl_web_viewer/README.md`:

```markdown
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
```

- [ ] **Step 4: Run smoke test and commit**

Run:

```bash
node --test smpl_web_viewer/tests/static_app.test.js
```

Expected: PASS.

Commit:

```bash
git add smpl_web_viewer
git commit -m "chore(smpl_web_viewer): scaffold static app"
```

---

## Task 2: Offline Model Asset Exporter

**Files:**
- Create: `smpl_web_viewer/tools/export_smpl_model.py`
- Create: `smpl_web_viewer/tests/test_exporter.py`

- [ ] **Step 1: Write failing Python tests for binary packing**

Create `smpl_web_viewer/tests/test_exporter.py`:

```python
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from tools.export_smpl_model import add_array, write_asset


class ExporterTest(unittest.TestCase):
    def test_add_array_records_offsets_in_bytes(self):
        meta = {"arrays": {}}
        f32 = bytearray()
        i32 = bytearray()
        add_array(meta, f32, i32, "v_template", np.array([[1, 2, 3]], dtype=np.float32))
        add_array(meta, f32, i32, "faces", np.array([[0, 1, 2]], dtype=np.int32))
        self.assertEqual(meta["arrays"]["v_template"]["offset"], 0)
        self.assertEqual(meta["arrays"]["v_template"]["shape"], [1, 3])
        self.assertEqual(meta["arrays"]["v_template"]["dtype"], "float32")
        self.assertEqual(len(f32), 12)
        self.assertEqual(meta["arrays"]["faces"]["offset"], 0)
        self.assertEqual(meta["arrays"]["faces"]["dtype"], "int32")
        self.assertEqual(len(i32), 12)

    def test_write_asset_outputs_meta_and_bins(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            write_asset(out, {
                "v_template": np.zeros((2, 3), dtype=np.float32),
                "faces": np.array([[0, 1, 2]], dtype=np.int32),
                "parents": np.array([-1, 0], dtype=np.int32),
            })
            meta = json.loads((out / "smpl_neutral.meta.json").read_text())
            self.assertEqual(meta["schema"], "smpl-web-model-v1")
            self.assertTrue((out / "smpl_neutral.f32.bin").exists())
            self.assertTrue((out / "smpl_neutral.i32.bin").exists())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
PYTHONPATH=smpl_web_viewer python3 -m unittest discover -s smpl_web_viewer/tests -p 'test_exporter.py'
```

Expected: FAIL with `ModuleNotFoundError: No module named 'tools.export_smpl_model'`.

- [ ] **Step 3: Implement exporter helpers and CLI**

Create `smpl_web_viewer/tools/__init__.py` as empty.

Create `smpl_web_viewer/tools/export_smpl_model.py`:

```python
import argparse
import json
import pickle
from pathlib import Path

import numpy as np


def _dense(array):
    if "scipy.sparse" in str(type(array)):
        return np.asarray(array.todense())
    return np.asarray(array)


def add_array(meta, f32, i32, name, array):
    arr = np.asarray(array)
    if arr.dtype.kind == "f":
        arr = np.asarray(arr, dtype="<f4", order="C")
        offset = len(f32)
        f32.extend(arr.tobytes(order="C"))
        dtype = "float32"
        bin_name = "smpl_neutral.f32.bin"
    elif arr.dtype.kind in ("i", "u"):
        arr = np.asarray(arr, dtype="<i4", order="C")
        offset = len(i32)
        i32.extend(arr.tobytes(order="C"))
        dtype = "int32"
        bin_name = "smpl_neutral.i32.bin"
    else:
        raise TypeError(f"unsupported dtype for {name}: {arr.dtype}")
    meta["arrays"][name] = {
        "bin": bin_name,
        "offset": offset,
        "length": int(arr.size),
        "shape": list(arr.shape),
        "dtype": dtype,
    }


def write_asset(out_dir, arrays):
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = {"schema": "smpl-web-model-v1", "arrays": {}}
    f32 = bytearray()
    i32 = bytearray()
    for name, arr in arrays.items():
        add_array(meta, f32, i32, name, arr)
    (out_dir / "smpl_neutral.meta.json").write_text(json.dumps(meta, indent=2), encoding="utf8")
    (out_dir / "smpl_neutral.f32.bin").write_bytes(f32)
    (out_dir / "smpl_neutral.i32.bin").write_bytes(i32)


def load_smpl_pkl(path):
    with Path(path).open("rb") as f:
        data = pickle.load(f, encoding="latin1")
    posedirs = np.reshape(_dense(data["posedirs"]), [-1, data["posedirs"].shape[-1]]).T
    parents = np.asarray(_dense(data["kintree_table"])[0], dtype=np.int32)
    parents[0] = -1
    return {
        "v_template": _dense(data["v_template"]),
        "shapedirs": _dense(data["shapedirs"]),
        "posedirs": posedirs,
        "J_regressor": _dense(data["J_regressor"]),
        "weights": _dense(data["weights"]),
        "faces": _dense(data["f"]).astype(np.int32),
        "parents": parents[:24],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pkl", default="smpl_viewer/_data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl")
    ap.add_argument("--out", default="smpl_web_viewer/public/models")
    args = ap.parse_args()
    write_asset(Path(args.out), load_smpl_pkl(args.pkl))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests and optional real export**

Run:

```bash
PYTHONPATH=smpl_web_viewer python3 -m unittest discover -s smpl_web_viewer/tests -p 'test_exporter.py'
```

Expected: PASS.

If the active Python has scipy available, run:

```bash
PYTHONPATH=. python3 smpl_web_viewer/tools/export_smpl_model.py \
  --pkl smpl_viewer/_data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl \
  --out smpl_web_viewer/public/models
```

Expected: writes `smpl_neutral.meta.json`, `smpl_neutral.f32.bin`, `smpl_neutral.i32.bin`. If scipy is missing, leave generated assets absent and document the command output in the final status.

- [ ] **Step 5: Commit**

```bash
git add smpl_web_viewer/tools smpl_web_viewer/tests/test_exporter.py smpl_web_viewer/public/models
git commit -m "feat(smpl_web_viewer): add smpl model exporter"
```

---

## Task 3: Sequence Converter

**Files:**
- Create: `smpl_web_viewer/tools/convert_sequence.py`
- Create: `smpl_web_viewer/tools/make_sample_assets.py`
- Create: `smpl_web_viewer/tests/test_sequence_converter.py`

- [ ] **Step 1: Write failing converter tests**

Create `smpl_web_viewer/tests/test_sequence_converter.py`:

```python
import json
import tempfile
import unittest
from pathlib import Path

from tools.convert_sequence import convert_records, image_name


class SequenceConverterTest(unittest.TestCase):
    def test_convert_records_keeps_smpl_params_only(self):
        records = [{
            "frame": 7,
            "root_pos": [1, 2, 3],
            "root_rota": [0.1, 0.2, 0.3],
            "body_pose": [0.0] * 63,
            "betas": [0.0] * 10,
            "left_hand_pose": [9.0],
        }]
        out = convert_records("sample/a1", records, "./images/a1/")
        frame = out["frames"][0]
        self.assertEqual(out["schema"], "smpl-web-sequence-v1")
        self.assertEqual(frame["frame"], 7)
        self.assertNotIn("left_hand_pose", frame)
        self.assertEqual(len(frame["body_pose"]), 63)
        self.assertEqual(len(frame["betas"]), 10)

    def test_image_name_formats_four_digits(self):
        self.assertEqual(image_name("%04d.jpg", 12), "0012.jpg")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
PYTHONPATH=smpl_web_viewer python3 -m unittest discover -s smpl_web_viewer/tests -p 'test_sequence_converter.py'
```

Expected: FAIL with `ModuleNotFoundError: No module named 'tools.convert_sequence'`.

- [ ] **Step 3: Implement converter**

Create `smpl_web_viewer/tools/convert_sequence.py`:

```python
import argparse
import json
from pathlib import Path


def image_name(pattern, frame):
    return pattern % frame


def _require_len(record, key, n):
    value = record.get(key)
    if not isinstance(value, list) or len(value) != n:
        raise ValueError(f"{key} must be a list of length {n}")
    return [float(x) for x in value]


def convert_records(name, records, image_base_url, fps=30, width=1920, height=1080):
    frames = []
    for record in records:
        frames.append({
            "frame": int(record["frame"]),
            "root_pos": _require_len(record, "root_pos", 3),
            "root_rota": _require_len(record, "root_rota", 3),
            "body_pose": _require_len(record, "body_pose", 63),
            "betas": _require_len(record, "betas", 10),
        })
    return {
        "schema": "smpl-web-sequence-v1",
        "name": name,
        "fps": int(fps),
        "image": {
            "type": "image_sequence",
            "baseUrl": image_base_url,
            "pattern": "%04d.jpg",
            "width": int(width),
            "height": int(height),
        },
        "camera": {"fx": 1850, "fy": 1850, "cx": 960, "cy": 540},
        "frames": frames,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--name", required=True)
    ap.add_argument("--image-base-url", required=True)
    ap.add_argument("--output", required=True, type=Path)
    args = ap.parse_args()
    data = json.loads(args.input.read_text())
    out = convert_records(args.name, data["records"], args.image_base_url)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, indent=2), encoding="utf8")


if __name__ == "__main__":
    main()
```

Create `smpl_web_viewer/tools/make_sample_assets.py`:

```python
import argparse
import shutil
from pathlib import Path

from convert_sequence import convert_records
import json


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, type=Path)
    ap.add_argument("--out", default="smpl_web_viewer/public/samples/a_famale_224", type=Path)
    ap.add_argument("--copy-images", action="store_true")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = {"schema": "smpl-web-sample-manifest-v1", "sequences": []}
    for actor in ("a1", "a2", "a3", "a4"):
        pose_path = args.source / "a" / actor / "pose_files" / f"{actor}.json"
        image_dir = args.source / "a" / actor / "images"
        seq_dir = args.out / actor
        seq_dir.mkdir(parents=True, exist_ok=True)
        records = json.loads(pose_path.read_text())["records"]
        image_base = f"./{actor}/images/"
        sequence = convert_records(f"a_famale_224/{actor}", records, image_base)
        (seq_dir / "sequence.json").write_text(json.dumps(sequence, indent=2), encoding="utf8")
        if args.copy_images:
            dst = seq_dir / "images"
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(image_dir, dst)
        manifest["sequences"].append({"name": actor, "url": f"./{actor}/sequence.json"})
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests and optionally generate sample**

Run:

```bash
PYTHONPATH=smpl_web_viewer python3 -m unittest discover -s smpl_web_viewer/tests -p 'test_sequence_converter.py'
```

Expected: PASS.

Run sample conversion if the source exists:

```bash
PYTHONPATH=smpl_web_viewer/tools python3 smpl_web_viewer/tools/make_sample_assets.py \
  --source /Users/penghaotian/Downloads/20260609/a_famale_224 \
  --out smpl_web_viewer/public/samples/a_famale_224
```

Expected: writes `manifest.json` and four `sequence.json` files. Use `--copy-images` only when a fully self-contained sample is needed; otherwise images are not copied.

- [ ] **Step 5: Commit**

```bash
git add smpl_web_viewer/tools smpl_web_viewer/tests/test_sequence_converter.py smpl_web_viewer/public/samples
git commit -m "feat(smpl_web_viewer): convert smpl parameter sequences"
```

---

## Task 4: TypedArray Math Helpers

**Files:**
- Create: `smpl_web_viewer/src/smpl/math3d.js`
- Create: `smpl_web_viewer/tests/smpl_math.test.js`

- [ ] **Step 1: Write failing math tests**

Create `smpl_web_viewer/tests/smpl_math.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { axisAngleToMat3, mat4Mul, transformPoint } from '../src/smpl/math3d.js';

test('axisAngleToMat3 returns identity for zero vector', () => {
  assert.deepEqual(Array.from(axisAngleToMat3([0, 0, 0])).map(x => +x.toFixed(6)), [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ]);
});

test('axisAngleToMat3 rotates around z axis', () => {
  const r = axisAngleToMat3([0, 0, Math.PI / 2]);
  const p = transformPoint([
    r[0], r[1], r[2], 0,
    r[3], r[4], r[5], 0,
    r[6], r[7], r[8], 0,
    0, 0, 0, 1
  ], [1, 0, 0]);
  assert.ok(Math.abs(p[0]) < 1e-6);
  assert.ok(Math.abs(p[1] - 1) < 1e-6);
});

test('mat4Mul composes translations', () => {
  const a = [1,0,0,1, 0,1,0,2, 0,0,1,3, 0,0,0,1];
  const b = [1,0,0,4, 0,1,0,5, 0,0,1,6, 0,0,0,1];
  const out = mat4Mul(a, b);
  assert.deepEqual(out.slice(3, 12).filter((_, i) => i % 4 === 0), [5, 7, 9]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test smpl_web_viewer/tests/smpl_math.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement math helpers**

Create `smpl_web_viewer/src/smpl/math3d.js`:

```js
export function axisAngleToMat3(v) {
  const x = v[0], y = v[1], z = v[2];
  const angle = Math.hypot(x, y, z);
  if (angle < 1e-8) return new Float32Array([1,0,0, 0,1,0, 0,0,1]);
  const nx = x / angle, ny = y / angle, nz = z / angle;
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return new Float32Array([
    t*nx*nx + c,      t*nx*ny - s*nz,   t*nx*nz + s*ny,
    t*ny*nx + s*nz,   t*ny*ny + c,      t*ny*nz - s*nx,
    t*nz*nx - s*ny,   t*nz*ny + s*nx,   t*nz*nz + c
  ]);
}

export function mat4FromRt(R, t) {
  return new Float32Array([
    R[0], R[1], R[2], t[0],
    R[3], R[4], R[5], t[1],
    R[6], R[7], R[8], t[2],
    0, 0, 0, 1
  ]);
}

export function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4 + 0] * b[0 * 4 + c] +
        a[r * 4 + 1] * b[1 * 4 + c] +
        a[r * 4 + 2] * b[2 * 4 + c] +
        a[r * 4 + 3] * b[3 * 4 + c];
    }
  }
  return out;
}

export function transformPoint(m, p) {
  const x = p[0], y = p[1], z = p[2];
  return new Float32Array([
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ]);
}
```

- [ ] **Step 4: Run test and commit**

Run:

```bash
node --test smpl_web_viewer/tests/smpl_math.test.js
```

Expected: PASS.

Commit:

```bash
git add smpl_web_viewer/src/smpl/math3d.js smpl_web_viewer/tests/smpl_math.test.js
git commit -m "feat(smpl_web_viewer): add typedarray math helpers"
```

---

## Task 5: Model Loader

**Files:**
- Create: `smpl_web_viewer/src/smpl/smpl_model.js`
- Create: `smpl_web_viewer/tests/smpl_model.test.js`
- Create: `smpl_web_viewer/tests/fixtures/tiny_model/tiny.meta.json`
- Create: `smpl_web_viewer/tests/fixtures/tiny_model/tiny.f32.bin`
- Create: `smpl_web_viewer/tests/fixtures/tiny_model/tiny.i32.bin`

- [ ] **Step 1: Write failing model loader test**

Create `smpl_web_viewer/tests/smpl_model.test.js`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { loadModelFromFiles } from '../src/smpl/smpl_model.js';

test('loadModelFromFiles slices arrays by meta offsets', async () => {
  const base = new URL('./fixtures/tiny_model/', import.meta.url);
  const model = await loadModelFromFiles(
    new URL('tiny.meta.json', base),
    async (url) => readFile(url)
  );
  assert.equal(model.v_template.length, 6);
  assert.equal(model.faces.length, 3);
  assert.deepEqual(Array.from(model.parents), [-1, 0]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test smpl_web_viewer/tests/smpl_model.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create tiny fixture and model loader**

Create tiny fixture with Node:

```bash
mkdir -p smpl_web_viewer/tests/fixtures/tiny_model
node - <<'NODE'
const fs = require('node:fs');
const path = 'smpl_web_viewer/tests/fixtures/tiny_model';
fs.writeFileSync(`${path}/tiny.f32.bin`, Buffer.from(new Float32Array([0,0,0, 1,0,0]).buffer));
fs.writeFileSync(`${path}/tiny.i32.bin`, Buffer.from(new Int32Array([0,1,0, -1,0]).buffer));
fs.writeFileSync(`${path}/tiny.meta.json`, JSON.stringify({
  schema: 'smpl-web-model-v1',
  arrays: {
    v_template: { bin: 'tiny.f32.bin', offset: 0, length: 6, shape: [2,3], dtype: 'float32' },
    faces: { bin: 'tiny.i32.bin', offset: 0, length: 3, shape: [1,3], dtype: 'int32' },
    parents: { bin: 'tiny.i32.bin', offset: 12, length: 2, shape: [2], dtype: 'int32' }
  }
}, null, 2));
NODE
```

Create `smpl_web_viewer/src/smpl/smpl_model.js`:

```js
function arrayFromBuffer(buffer, spec) {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const bytes = view.buffer.slice(view.byteOffset + spec.offset, view.byteOffset + spec.offset + spec.length * 4);
  return spec.dtype === 'float32' ? new Float32Array(bytes) : new Int32Array(bytes);
}

export async function loadModelFromFiles(metaUrl, readBinary) {
  const metaText = await readBinary(metaUrl);
  const meta = JSON.parse(
    typeof metaText === 'string'
      ? metaText
      : new TextDecoder().decode(metaText instanceof Uint8Array ? metaText : new Uint8Array(metaText))
  );
  const cache = new Map();
  const model = { meta };
  for (const [name, spec] of Object.entries(meta.arrays)) {
    if (!cache.has(spec.bin)) {
      cache.set(spec.bin, await readBinary(new URL(spec.bin, metaUrl)));
    }
    model[name] = arrayFromBuffer(cache.get(spec.bin), spec);
    model[`${name}Shape`] = spec.shape;
  }
  return model;
}

export async function loadModel(baseUrl = './public/models/smpl_neutral.meta.json') {
  return loadModelFromFiles(new URL(baseUrl, location.href), async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  });
}
```

- [ ] **Step 4: Run test and commit**

Run:

```bash
node --test smpl_web_viewer/tests/smpl_model.test.js
```

Expected: PASS.

Commit:

```bash
git add smpl_web_viewer/src/smpl/smpl_model.js smpl_web_viewer/tests/smpl_model.test.js smpl_web_viewer/tests/fixtures/tiny_model
git commit -m "feat(smpl_web_viewer): load binary smpl model assets"
```

---

## Task 6: CPU LBS Core

**Files:**
- Create: `smpl_web_viewer/src/smpl/lbs.js`
- Create: `smpl_web_viewer/tests/lbs.test.js`

- [ ] **Step 1: Write failing toy LBS test**

Create `smpl_web_viewer/tests/lbs.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forwardSmpl } from '../src/smpl/lbs.js';

function tinyModel() {
  return {
    v_template: new Float32Array([0,0,0, 1,0,0]),
    v_templateShape: [2,3],
    shapedirs: new Float32Array(2 * 3 * 1),
    shapedirsShape: [2,3,1],
    posedirs: new Float32Array(9 * 2 * 3),
    posedirsShape: [9,6],
    J_regressor: new Float32Array([1,0]),
    J_regressorShape: [1,2],
    weights: new Float32Array([1, 1]),
    weightsShape: [2,1],
    parents: new Int32Array([-1]),
    faces: new Int32Array([0,1,0])
  };
}

test('forwardSmpl applies root translation to verts and joints', () => {
  const out = forwardSmpl(tinyModel(), {
    root_rota: [0,0,0],
    root_pos: [10,20,30],
    body_pose: [],
    betas: [0]
  });
  assert.deepEqual(Array.from(out.joints), [10,20,30]);
  assert.deepEqual(Array.from(out.vertices), [10,20,30, 11,20,30]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test smpl_web_viewer/tests/lbs.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement minimal general LBS**

Create `smpl_web_viewer/src/smpl/lbs.js`:

```js
import { axisAngleToMat3, mat4FromRt, mat4Mul, transformPoint } from './math3d.js';

function vertexCount(model) { return model.v_templateShape[0]; }
function jointCount(model) { return model.J_regressorShape[0]; }

export function buildPoseRotations(frame, joints) {
  const out = new Array(joints);
  out[0] = axisAngleToMat3(frame.root_rota);
  for (let j = 1; j < joints; j++) {
    const k = (j - 1) * 3;
    const src = k + 2 < frame.body_pose.length ? [frame.body_pose[k], frame.body_pose[k + 1], frame.body_pose[k + 2]] : [0, 0, 0];
    out[j] = axisAngleToMat3(src);
  }
  return out;
}

export function blendShape(model, betas) {
  const verts = vertexCount(model);
  const betaCount = model.shapedirsShape[2];
  const out = new Float32Array(model.v_template);
  for (let v = 0; v < verts; v++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let b = 0; b < betaCount; b++) {
        sum += (betas[b] ?? 0) * model.shapedirs[(v * 3 + c) * betaCount + b];
      }
      out[v * 3 + c] += sum;
    }
  }
  return out;
}

export function regressJoints(model, vertices) {
  const joints = jointCount(model);
  const verts = vertexCount(model);
  const out = new Float32Array(joints * 3);
  for (let j = 0; j < joints; j++) {
    for (let v = 0; v < verts; v++) {
      const w = model.J_regressor[j * verts + v];
      out[j * 3 + 0] += w * vertices[v * 3 + 0];
      out[j * 3 + 1] += w * vertices[v * 3 + 1];
      out[j * 3 + 2] += w * vertices[v * 3 + 2];
    }
  }
  return out;
}

export function forwardSmpl(model, frame) {
  const verts = vertexCount(model);
  const jointsN = jointCount(model);
  const vShaped = blendShape(model, frame.betas);
  const joints = regressJoints(model, vShaped);
  const rot = buildPoseRotations(frame, jointsN);
  const transforms = new Array(jointsN);
  const relTransforms = new Array(jointsN);
  for (let j = 0; j < jointsN; j++) {
    const parent = model.parents[j];
    const rel = [
      joints[j * 3 + 0] - (parent >= 0 ? joints[parent * 3 + 0] : 0),
      joints[j * 3 + 1] - (parent >= 0 ? joints[parent * 3 + 1] : 0),
      joints[j * 3 + 2] - (parent >= 0 ? joints[parent * 3 + 2] : 0),
    ];
    const local = mat4FromRt(rot[j], rel);
    transforms[j] = parent >= 0 ? mat4Mul(transforms[parent], local) : local;
    const jp = transformPoint(transforms[j], [joints[j * 3], joints[j * 3 + 1], joints[j * 3 + 2]]);
    relTransforms[j] = new Float32Array(transforms[j]);
    relTransforms[j][3] -= jp[0];
    relTransforms[j][7] -= jp[1];
    relTransforms[j][11] -= jp[2];
  }
  const outVerts = new Float32Array(verts * 3);
  for (let v = 0; v < verts; v++) {
    const p = [vShaped[v * 3], vShaped[v * 3 + 1], vShaped[v * 3 + 2]];
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < jointsN; j++) {
      const w = model.weights[v * jointsN + j];
      if (w === 0) continue;
      const q = transformPoint(relTransforms[j], p);
      x += w * q[0]; y += w * q[1]; z += w * q[2];
    }
    outVerts[v * 3] = x + frame.root_pos[0];
    outVerts[v * 3 + 1] = y + frame.root_pos[1];
    outVerts[v * 3 + 2] = z + frame.root_pos[2];
  }
  const outJoints = new Float32Array(jointsN * 3);
  for (let j = 0; j < jointsN; j++) {
    outJoints[j * 3] = transforms[j][3] + frame.root_pos[0];
    outJoints[j * 3 + 1] = transforms[j][7] + frame.root_pos[1];
    outJoints[j * 3 + 2] = transforms[j][11] + frame.root_pos[2];
  }
  return { vertices: outVerts, joints: outJoints };
}
```

- [ ] **Step 4: Run test and commit**

Run:

```bash
node --test smpl_web_viewer/tests/lbs.test.js smpl_web_viewer/tests/smpl_math.test.js
```

Expected: PASS.

Commit:

```bash
git add smpl_web_viewer/src/smpl/lbs.js smpl_web_viewer/tests/lbs.test.js
git commit -m "feat(smpl_web_viewer): implement cpu smpl lbs core"
```

---

## Task 7: Worker Protocol

**Files:**
- Create: `smpl_web_viewer/src/smpl/smpl_worker.js`
- Create: `smpl_web_viewer/tests/smpl_worker.test.js`

- [ ] **Step 1: Write failing worker test**

Create `smpl_web_viewer/tests/smpl_worker.test.js`:

```js
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';

test('worker initializes a tiny model and forwards one frame', async () => {
  const worker = new Worker(new URL('../src/smpl/smpl_worker.js', import.meta.url), { type: 'module' });
  worker.postMessage({
    type: 'init',
    model: {
      v_template: new Float32Array([0,0,0, 1,0,0]),
      v_templateShape: [2,3],
      shapedirs: new Float32Array(6),
      shapedirsShape: [2,3,1],
      posedirs: new Float32Array(54),
      posedirsShape: [9,6],
      J_regressor: new Float32Array([1,0]),
      J_regressorShape: [1,2],
      weights: new Float32Array([1,1]),
      weightsShape: [2,1],
      parents: new Int32Array([-1]),
      faces: new Int32Array([0,1,0])
    }
  });
  assert.equal((await once(worker, 'message'))[0].type, 'ready');
  worker.postMessage({ type: 'frame', requestId: 1, frame: { root_rota: [0,0,0], root_pos: [1,2,3], body_pose: [], betas: [0] } });
  const msg = (await once(worker, 'message'))[0];
  assert.equal(msg.type, 'frameResult');
  assert.equal(msg.requestId, 1);
  assert.deepEqual(Array.from(new Float32Array(msg.vertices)), [1,2,3, 2,2,3]);
  worker.terminate();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test smpl_web_viewer/tests/smpl_worker.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement Worker**

Create `smpl_web_viewer/src/smpl/smpl_worker.js`:

```js
import { forwardSmpl } from './lbs.js';

let port;
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  port = self;
} else {
  const { parentPort } = await import('node:worker_threads');
  port = {
    postMessage: (msg, transfer) => parentPort.postMessage(msg, transfer),
    addEventListener: (_type, cb) => parentPort.on('message', (data) => cb({ data }))
  };
}

let model = null;

port.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    model = msg.model;
    port.postMessage({ type: 'ready' });
    return;
  }
  if (msg.type === 'frame') {
    if (!model) {
      port.postMessage({ type: 'error', requestId: msg.requestId, message: 'worker not initialized' });
      return;
    }
    const t0 = performance.now();
    const out = forwardSmpl(model, msg.frame);
    port.postMessage({
      type: 'frameResult',
      requestId: msg.requestId,
      ms: performance.now() - t0,
      vertices: out.vertices.buffer,
      joints: out.joints.buffer,
    }, [out.vertices.buffer, out.joints.buffer]);
  }
});
```

- [ ] **Step 4: Run test and commit**

Run:

```bash
node --test smpl_web_viewer/tests/smpl_worker.test.js
```

Expected: PASS.

Commit:

```bash
git add smpl_web_viewer/src/smpl/smpl_worker.js smpl_web_viewer/tests/smpl_worker.test.js
git commit -m "feat(smpl_web_viewer): add smpl worker protocol"
```

---

## Task 8: Sequence Loader and Playback State

**Files:**
- Create: `smpl_web_viewer/src/data/sequence_loader.js`
- Create: `smpl_web_viewer/src/viewer/playback.js`
- Create: `smpl_web_viewer/tests/sequence_loader.test.js`
- Create: `smpl_web_viewer/tests/playback.test.js`

- [ ] **Step 1: Write failing tests**

Create `smpl_web_viewer/tests/sequence_loader.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSequence } from '../src/data/sequence_loader.js';

test('normalizeSequence validates frame array lengths', () => {
  const seq = normalizeSequence({
    schema: 'smpl-web-sequence-v1',
    name: 'x',
    fps: 30,
    image: { type: 'image_sequence', baseUrl: './', pattern: '%04d.jpg', width: 1920, height: 1080 },
    camera: { fx: 1850, fy: 1850, cx: 960, cy: 540 },
    frames: [{ frame: 0, root_pos: [0,0,0], root_rota: [0,0,0], body_pose: Array(63).fill(0), betas: Array(10).fill(0) }]
  });
  assert.equal(seq.frames.length, 1);
});
```

Create `smpl_web_viewer/tests/playback.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Playback } from '../src/viewer/playback.js';

test('Playback clamps frame index', () => {
  const p = new Playback(3);
  p.setFrame(99);
  assert.equal(p.frame, 2);
  p.setFrame(-1);
  assert.equal(p.frame, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test smpl_web_viewer/tests/sequence_loader.test.js smpl_web_viewer/tests/playback.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement loader and playback**

Create `smpl_web_viewer/src/data/sequence_loader.js`:

```js
function requireLen(value, n, name) {
  if (!Array.isArray(value) || value.length !== n) throw new Error(`${name} must have length ${n}`);
  return value.map(Number);
}

export function normalizeSequence(data) {
  if (data.schema !== 'smpl-web-sequence-v1') throw new Error(`unsupported schema: ${data.schema}`);
  return {
    ...data,
    frames: data.frames.map((f) => ({
      frame: Number(f.frame),
      root_pos: requireLen(f.root_pos, 3, 'root_pos'),
      root_rota: requireLen(f.root_rota, 3, 'root_rota'),
      body_pose: requireLen(f.body_pose, 63, 'body_pose'),
      betas: requireLen(f.betas, 10, 'betas'),
    }))
  };
}

export async function loadSequence(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load sequence ${url}: ${res.status}`);
  return normalizeSequence(await res.json());
}
```

Create `smpl_web_viewer/src/viewer/playback.js`:

```js
export class Playback {
  constructor(frameCount, fps = 30) {
    this.frameCount = frameCount;
    this.fps = fps;
    this.frame = 0;
    this.playing = false;
    this._accum = 0;
  }

  setFrame(frame) {
    this.frame = Math.max(0, Math.min(this.frameCount - 1, Math.trunc(frame)));
    return this.frame;
  }

  toggle() {
    this.playing = !this.playing;
    return this.playing;
  }

  tick(dtMs) {
    if (!this.playing || this.frameCount <= 0) return this.frame;
    this._accum += dtMs;
    const step = 1000 / this.fps;
    while (this._accum >= step) {
      this._accum -= step;
      this.frame = (this.frame + 1) % this.frameCount;
    }
    return this.frame;
  }
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
node --test smpl_web_viewer/tests/sequence_loader.test.js smpl_web_viewer/tests/playback.test.js
```

Expected: PASS.

Commit:

```bash
git add smpl_web_viewer/src/data smpl_web_viewer/src/viewer/playback.js smpl_web_viewer/tests/sequence_loader.test.js smpl_web_viewer/tests/playback.test.js
git commit -m "feat(smpl_web_viewer): load sequences and playback state"
```

---

## Task 9: Camera and Background Helpers

**Files:**
- Create: `smpl_web_viewer/src/viewer/camera_modes.js`
- Create: `smpl_web_viewer/src/viewer/background.js`
- Create: `smpl_web_viewer/tests/camera_modes.test.js`
- Create: `smpl_web_viewer/tests/background.test.js`

- [ ] **Step 1: Write failing tests**

Create `smpl_web_viewer/tests/camera_modes.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectSrc, verticalFovDeg } from '../src/viewer/camera_modes.js';

test('projectSrc matches diving projection formula', () => {
  const p = projectSrc([0, 1, -10], { fx: 1850, fy: 1850, cx: 960, cy: 540 });
  assert.equal(p[0], 960);
  assert.equal(p[1], 355);
});

test('verticalFovDeg is positive', () => {
  assert.ok(verticalFovDeg(1080, 1850) > 0);
});
```

Create `smpl_web_viewer/tests/background.test.js`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageUrlForFrame } from '../src/viewer/background.js';

test('imageUrlForFrame expands percent pattern', () => {
  assert.equal(imageUrlForFrame({ baseUrl: './images/', pattern: '%04d.jpg' }, 7), './images/0007.jpg');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test smpl_web_viewer/tests/camera_modes.test.js smpl_web_viewer/tests/background.test.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement helpers**

Create `smpl_web_viewer/src/viewer/camera_modes.js`:

```js
export function projectSrc([x, y, z], k) {
  return [
    k.fx * x / (-z) + k.cx,
    k.fy * (-y) / (-z) + k.cy
  ];
}

export function verticalFovDeg(imageHeight, fy) {
  return 2 * Math.atan(imageHeight / (2 * fy)) * 180 / Math.PI;
}

export function viewOffsetForCamera(imageWidth, imageHeight, camera) {
  return {
    fullWidth: imageWidth,
    fullHeight: imageHeight,
    x: imageWidth / 2 - camera.cx,
    y: imageHeight / 2 - camera.cy,
    width: imageWidth,
    height: imageHeight,
  };
}
```

Create `smpl_web_viewer/src/viewer/background.js`:

```js
export function imageUrlForFrame(image, frame) {
  const match = image.pattern.match(/%0(\d+)d/);
  if (!match) return `${image.baseUrl}${image.pattern.replace('%d', String(frame))}`;
  return `${image.baseUrl}${image.pattern.replace(match[0], String(frame).padStart(Number(match[1]), '0'))}`;
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
node --test smpl_web_viewer/tests/camera_modes.test.js smpl_web_viewer/tests/background.test.js
```

Expected: PASS.

Commit:

```bash
git add smpl_web_viewer/src/viewer/camera_modes.js smpl_web_viewer/src/viewer/background.js smpl_web_viewer/tests/camera_modes.test.js smpl_web_viewer/tests/background.test.js
git commit -m "feat(smpl_web_viewer): add camera and background helpers"
```

---

## Task 10: Three.js Scene and App Integration

**Files:**
- Create: `smpl_web_viewer/src/viewer/scene.js`
- Create: `smpl_web_viewer/src/viewer/style.css`
- Modify: `smpl_web_viewer/src/app.js`
- Modify: `smpl_web_viewer/README.md`

- [ ] **Step 1: Write failing app integration smoke test**

Create `smpl_web_viewer/tests/app_static.test.js`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('app imports scene, worker, model loader, and sequence loader', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /from '\.\/viewer\/scene\.js'/);
  assert.match(app, /from '\.\/smpl\/smpl_model\.js'/);
  assert.match(app, /from '\.\/data\/sequence_loader\.js'/);
  assert.match(app, /new Worker\(new URL\('\.\/smpl\/smpl_worker\.js'/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test smpl_web_viewer/tests/app_static.test.js
```

Expected: FAIL because `app.js` does not import those modules.

- [ ] **Step 3: Implement scene and app wiring**

Create `smpl_web_viewer/src/viewer/scene.js`:

```js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { verticalFovDeg } from './camera_modes.js';

export class SmplScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101418);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    this.camera.position.set(0, 1, 5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.mesh = null;
    this.points = null;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setTopology(faces) {
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6890 * 3), 3));
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x54d6ff, wireframe: true }));
    this.scene.add(this.mesh);
    const pointGeom = new THREE.BufferGeometry();
    pointGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    this.points = new THREE.Points(pointGeom, new THREE.PointsMaterial({ color: 0xffd166, size: 0.035 }));
    this.scene.add(this.points);
  }

  updateFrame(vertices, joints) {
    if (!this.mesh || !this.points) return;
    this.mesh.geometry.attributes.position.array.set(vertices);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
    this.points.geometry.attributes.position.array.set(joints);
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  configure2DCamera(sequence) {
    this.camera.fov = verticalFovDeg(sequence.image.height, sequence.camera.fy);
    this.camera.aspect = sequence.image.width / sequence.image.height;
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    this.camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
```

Replace `smpl_web_viewer/src/app.js` with:

```js
import { loadSequence } from './data/sequence_loader.js';
import { loadModel } from './smpl/smpl_model.js';
import { Playback } from './viewer/playback.js';
import { SmplScene } from './viewer/scene.js';

const statusEl = document.querySelector('#status');
const slider = document.querySelector('#frameSlider');
const playButton = document.querySelector('#playPause');
const loadButton = document.querySelector('#loadSample');
const scene = new SmplScene(document.querySelector('#viewport'));
let playback = new Playback(0);
let sequence = null;
let requestId = 0;
let pending = new Map();

const worker = new Worker(new URL('./smpl/smpl_worker.js', import.meta.url), { type: 'module' });
worker.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'ready') statusEl.textContent = 'Model loaded';
  if (msg.type === 'frameResult') {
    pending.delete(msg.requestId);
    scene.updateFrame(new Float32Array(msg.vertices), new Float32Array(msg.joints));
    statusEl.textContent = `frame ${playback.frame} forward ${msg.ms.toFixed(1)}ms`;
  }
  if (msg.type === 'error') statusEl.textContent = msg.message;
});

async function loadSample() {
  statusEl.textContent = 'Loading model...';
  const model = await loadModel('./public/models/smpl_neutral.meta.json');
  scene.setTopology(model.faces);
  worker.postMessage({ type: 'init', model });
  statusEl.textContent = 'Loading sequence...';
  sequence = await loadSequence('./public/samples/a_famale_224/a1/sequence.json');
  playback = new Playback(sequence.frames.length, sequence.fps);
  slider.max = String(sequence.frames.length - 1);
  slider.value = '0';
  scene.configure2DCamera(sequence);
  requestFrame(0);
}

function requestFrame(frameIndex) {
  if (!sequence) return;
  const id = ++requestId;
  pending.set(id, frameIndex);
  worker.postMessage({ type: 'frame', requestId: id, frame: sequence.frames[frameIndex] });
}

loadButton.addEventListener('click', () => loadSample().catch((err) => { statusEl.textContent = err.message; }));
playButton.addEventListener('click', () => {
  playButton.textContent = playback.toggle() ? 'Pause' : 'Play';
});
slider.addEventListener('input', () => {
  playback.setFrame(Number(slider.value));
  requestFrame(playback.frame);
});

let last = performance.now();
function loop(now) {
  const frameBefore = playback.frame;
  playback.tick(now - last);
  last = now;
  if (sequence && playback.frame !== frameBefore && pending.size < 2) {
    slider.value = String(playback.frame);
    requestFrame(playback.frame);
  }
  scene.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```

Create `smpl_web_viewer/src/viewer/style.css`:

```css
html, body {
  margin: 0;
  height: 100%;
  font: 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #e8edf2;
  background: #101418;
}

.shell {
  display: grid;
  grid-template-columns: 280px 1fr;
  height: 100vh;
  min-height: 0;
}

.panel {
  border-right: 1px solid #26313a;
  padding: 16px;
  display: grid;
  align-content: start;
  gap: 12px;
  background: #151b21;
}

.panel h1 {
  font-size: 18px;
  margin: 0 0 8px;
}

button, input {
  width: 100%;
  box-sizing: border-box;
}

.viewport {
  min-width: 0;
  min-height: 0;
  position: relative;
}
```

- [ ] **Step 4: Run static tests and commit**

Run:

```bash
node --test smpl_web_viewer/tests/app_static.test.js smpl_web_viewer/tests/static_app.test.js
```

Expected: PASS.

Commit:

```bash
git add smpl_web_viewer/src smpl_web_viewer/index.html smpl_web_viewer/tests/app_static.test.js smpl_web_viewer/README.md
git commit -m "feat(smpl_web_viewer): wire threejs viewer app"
```

---

## Task 11: Full Verification and Browser Smoke

**Files:**
- Modify: `smpl_web_viewer/README.md`

- [ ] **Step 1: Run all JS and Python unit tests**

Run:

```bash
node --test smpl_web_viewer/tests/*.test.js
PYTHONPATH=smpl_web_viewer python3 -m unittest discover -s smpl_web_viewer/tests -p 'test_*.py'
```

Expected: all tests PASS.

- [ ] **Step 2: Generate local assets**

Run model export:

```bash
PYTHONPATH=. python3 smpl_web_viewer/tools/export_smpl_model.py \
  --pkl smpl_viewer/_data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl \
  --out smpl_web_viewer/public/models
```

Expected: model assets are present. If scipy is unavailable in the local Python, record the failure and use the repo/user-provided Python environment before browser verification.

Run sample conversion:

```bash
PYTHONPATH=smpl_web_viewer/tools python3 smpl_web_viewer/tools/make_sample_assets.py \
  --source /Users/penghaotian/Downloads/20260609/a_famale_224 \
  --out smpl_web_viewer/public/samples/a_famale_224
```

Expected: `smpl_web_viewer/public/samples/a_famale_224/manifest.json` and `a1..a4/sequence.json` exist.

- [ ] **Step 3: Start local static server**

Run:

```bash
cd smpl_web_viewer
node tools/static_server.mjs --root . --port 5174
```

Expected: prints `SMPL Web Viewer static server: http://127.0.0.1:5174/`.

- [ ] **Step 4: Browser smoke**

Open `http://127.0.0.1:5174/`, click `Load sample`.

Expected:

- Status reaches `Model loaded`, then a frame forward timing.
- Mesh appears in viewport.
- Slider moves during playback.
- Browser console has no module loading errors and no external network requests.

- [ ] **Step 5: Update README with actual verification results**

Add a "Verified" section to `smpl_web_viewer/README.md`:

```markdown
## Verified

- `node --test smpl_web_viewer/tests/*.test.js`
- `PYTHONPATH=smpl_web_viewer python3 -m unittest discover -s smpl_web_viewer/tests -p 'test_*.py'`
- Static server: `node tools/static_server.mjs --root . --port 5174`
- Browser smoke: loaded `a_famale_224/a1` and displayed Worker-generated mesh
```

If any item could not be run, write the exact blocker instead of marking it verified.

- [ ] **Step 6: Commit**

```bash
git add smpl_web_viewer
git commit -m "docs(smpl_web_viewer): record verification"
```

---

## Self-Review

Spec coverage:

- New independent folder: Task 1 creates `smpl_web_viewer/`.
- No runtime Python/server/network: Tasks 1 and 10 use local ES modules and vendored Three.js; Task 11 verifies no external module loading.
- SMPL model constants: Task 2 exports meta/bin assets.
- Sequence JSON contains SMPL params only: Task 3 tests that converter drops non-runtime fields and does not emit mesh/joints.
- CPU TypedArray forward: Tasks 4-7 implement math, model loading, LBS, and Worker.
- Viewer and playback: Tasks 8-10 implement sequence loading, playback, camera helpers, and Three.js scene.
- Sample data: Tasks 3 and 11 generate `a_famale_224` sample metadata.
- Verification: Task 11 runs unit tests, conversion, static server, and browser smoke.

Placeholder scan:

- No placeholder red-flag instructions remain.
- Every implementation task has concrete files, tests, commands, and expected results.

Type consistency:

- `sequence_loader.js` returns frames with `root_pos`, `root_rota`, `body_pose`, `betas`.
- `lbs.js` and `smpl_worker.js` consume the same frame property names.
- `smpl_model.js` returns arrays plus `NameShape` properties used by `lbs.js`.
- `scene.js` accepts `faces`, `vertices`, and `joints` as TypedArrays produced by model/Worker.
