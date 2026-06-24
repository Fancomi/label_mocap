# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A suite of **browser-only** SMPL human-pose tools. All viewing/editing runs as static ES modules served over HTTP — no Python, Flask, torch, or network data API in any playback/editing path. User data is chosen locally in the browser and never uploaded. The Python under `smpl_*/` and `smpl_web_viewer/tools/` is **offline tooling only** (asset conversion, exporters, server tests), not part of the runtime.

The repo deploys as-is to GitHub Pages from `main`. Root `index.html` is the landing page linking the three apps.

## Commands

```bash
npm test            # full suite: web (node --test) + tools (python unittest) + server
npm run test:web    # JS unit tests only — the usual engineering smoke test
npm run test:tools  # Python exporter/converter tests (PYTHONPATH=smpl_web_viewer)
npm run test:server # Python stdlib static-server test

# run a single JS test file
node --test label/tests/projection.test.js

# serve an app locally (static server; open the printed URL)
npm run serve        # smpl_viewer at :8902 (also `make serve`)
npm run serve:label  # repo root at :5175 → open /label/
npm run serve:pcd    # repo root at :5176 → open /pcd_label/
npm run serve:web    # smpl_web_viewer sample app at :5174
```

`pytest.ini` drives a **legacy** Python math/data suite that needs `pytest`, `numpy`, and local diving fixtures. It is not the default smoke test — use `npm test`.

## Architecture: two shared kernels, three apps

The central design is a layered kernel that multiple apps consume. When changing behavior, decide first **which layer** it belongs to — kernel changes affect every app.

- **`smpl_core/`** — pure SMPL math kernel (no DOM, no three.js). `smpl_model.js` (binary .bin/.meta loader), `lbs.js` (`forwardSmpl`, linear blend skinning), `math3d.js`, `rotations.js`, `joint_names.js`. `forwardSmpl` also exposes per-joint **world rotation** — consumers need this for correct gizmo framing (see Known pitfalls).

- **`smpl_edit/`** — world-frame editing kernel, also DOM/three-agnostic where possible. Single sources of truth:
  - **Rotation = quaternion.** `rotation_state.js` holds root + 21 joint local quats; euler is an editable *view* with an anti-jump draft cache. Never make euler authoritative.
  - **Annotation = `AnnotationStore` over `CocoDocument`.** `coco_document.js` round-trips `player_0.json` with fidelity — it only mutates fields that were actually edited. Don't rewrite the whole document.
  - IK is a **plug-in**: `ik_plugin.js#installIK(ctx)` wires `ik_controller`/`ik_handle`/`ik_solver`/`ik_chains` via dependency injection. The host app calls one line and stays IK-name-free; uninstall is clean. Add IK features inside the plugin, not in app code.
  - Also: `pose_gizmo`, `root_handle`, `joint_picker`, `gizmo_frame`, `view_frame`, `ui_controller`.

- **Apps** (each `<app>/index.html` + `<app>/src/app.js` assembles the kernels):
  - **`label/`** — main 2D-image/video SMPL annotator. Tabbed exclusive edit modes [Pose/Root/Bbox/Beta]; in-place JSON save (Chrome/Edge File System Access, else download). `src/io/` = data sources, `src/scene/` = three.js wiring, `src/edit/` = bbox/derived/occlusion.
  - **`pcd_label/`** — 3D LiDAR point-cloud + SMPL annotator. Reuses `smpl_edit` wholesale; adds `pcd_scene`, `orbit_cam`, point-cloud decode/colormap. Up-axis/front-axis are **camera-only** (geometry never rotates).
  - **`smpl_viewer/` & `smpl_web_viewer/`** — read-only viewers. `smpl_viewer` is the GitHub Pages main entry; `smpl_web_viewer` is the sample app and home of most Python tooling + many unit tests. Annotator output (`player_0.json`) loads directly in the viewers — keep that format compatible.

three.js is **vendored** (`smpl_web_viewer/public/vendor/`) and wired through an `importmap` in each app's `index.html`; all apps share that one copy.

## Conventions and pitfalls

- **Tests cover pure logic only.** three.js / WebGL / DOM code is verified in-browser, not unit-tested. New code that *can* be pure should be, and should get a `*.test.js`.
- **Data rotation is forbidden for editing.** Portrait/N×90° image data is view-only; never bake a rotation into stored pose. Frame identity = image **position** in the ordered list, not the `image_id` value.
- **Gizmo frame bug** (`memory/pose-gizmo-frame-bug.md`): pose dragging jumps unless the per-joint gizmo uses the joint's **parent world rotation** to map local↔world. This is why `forwardSmpl` exposes world rotations.
- **GitHub Pages can't serve Git LFS pointer files.** Any asset loaded by default from a Pages route (web runtime models under `smpl_web_viewer/public/models/`, vendored three.js) must be committed as a real file, not an LFS pointer. See `ASSETS.md` for the full runtime/offline/debug/sample asset boundaries. `main` is the deployable branch.

## Specs & history

`docs/superpowers/specs/` and `docs/superpowers/plans/` hold the design docs and milestone plans (dated). They are useful context, not runtime entry points.
