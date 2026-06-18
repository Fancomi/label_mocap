// label/src/edit/bbox_overlay.js — DOM overlay for the 2D bbox.
//
// Draws the annotation bbox (image-pixel [x,y,w,h]) as an absolutely
// positioned <div> on top of the WebGL canvas, plus 4 draggable corner
// handles. Mapping is purely 2D: image pixels <-> displayed-canvas pixels,
// using the canvas's on-screen rect and the image dimensions. This avoids
// fragile 3D bbox math and gives pixel-accurate corner control.
import { resizeBboxByCorner } from './bbox_edit.js';

const CORNERS = ['tl', 'tr', 'bl', 'br'];

export class BboxOverlay {
  constructor({ stageEl, canvasEl, getCam, getStore, getBboxVisible, onEdit }) {
    this._stage = stageEl;
    this._canvas = canvasEl;
    this._getCam = getCam;
    this._getStore = getStore;
    this._getBboxVisible = getBboxVisible || (() => true);
    this._onEdit = onEdit || (() => {});
    this._bbox = null;
    this._editing = false;

    const box = document.createElement('div');
    box.style.cssText =
      'position:absolute;border:1px solid #ffcc33;box-sizing:border-box;' +
      'pointer-events:none;display:none;z-index:5';
    this._box = box;
    this._stage.appendChild(box);

    this._handles = {};
    for (const corner of CORNERS) {
      const h = document.createElement('div');
      h.dataset.corner = corner;
      h.style.cssText =
        'position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;' +
        'background:#ffcc33;border:1px solid #222;border-radius:2px;' +
        'pointer-events:auto;cursor:crosshair;display:none;z-index:6';
      h.addEventListener('pointerdown', (e) => this._onPointerDown(e, corner));
      this._handles[corner] = h;
      this._stage.appendChild(h);
    }
    this._onMove = (e) => this._onPointerMove(e);
    this._onUp = (e) => this._onPointerUp(e);
  }

  // Map an image-pixel point [ix,iy] to a stage-relative on-screen px point.
  // 走 camera 的 imageToCanvasNorm:支持缩放/平移(z=1、pan=0 时退化为 ix/imageW,与原线性式一致)。
  _imgToScreen(ix, iy, cam, rect, stageRect) {
    const [u, v] = cam.imageToCanvasNorm(ix, iy);
    const sx = rect.left - stageRect.left + u * rect.width;
    const sy = rect.top - stageRect.top + v * rect.height;
    return [sx, sy];
  }

  // Map a stage-relative on-screen px point back to image pixels.
  // 走 camera 的 canvasNormToImage,与 _imgToScreen 互逆。
  _screenToImg(sx, sy, cam, rect, stageRect) {
    const u = (sx + stageRect.left - rect.left) / rect.width;
    const v = (sy + stageRect.top - rect.top) / rect.height;
    return cam.canvasNormToImage(u, v);
  }

  render(bbox) {
    this._bbox = bbox ? bbox.slice() : null;
    const cam = this._getCam();
    const visible = bbox && cam && cam.mode === '2d' && this._getBboxVisible();
    if (!visible) {
      this._box.style.display = 'none';
      for (const corner of CORNERS) this._handles[corner].style.display = 'none';
      return;
    }
    const rect = this._canvas.getBoundingClientRect();
    const stageRect = this._stage.getBoundingClientRect();
    const [x, y, w, h] = bbox;
    const [sx0, sy0] = this._imgToScreen(x, y, cam, rect, stageRect);
    const [sx1, sy1] = this._imgToScreen(x + w, y + h, cam, rect, stageRect);
    this._box.style.display = 'block';
    this._box.style.left = `${sx0}px`;
    this._box.style.top = `${sy0}px`;
    this._box.style.width = `${sx1 - sx0}px`;
    this._box.style.height = `${sy1 - sy0}px`;
    const pts = {
      tl: [sx0, sy0], tr: [sx1, sy0], bl: [sx0, sy1], br: [sx1, sy1],
    };
    for (const corner of CORNERS) {
      const [hx, hy] = pts[corner];
      const handle = this._handles[corner];
      handle.style.display = 'block';
      handle.style.left = `${hx}px`;
      handle.style.top = `${hy}px`;
    }
  }

  _onPointerDown(e, corner) {
    const store = this._getStore();
    if (!this._bbox || !store || !store.current()) return;
    e.preventDefault();
    e.stopPropagation();
    this._dragCorner = corner;
    this._moved = false;
    e.target.setPointerCapture(e.pointerId);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
  }

  _onPointerMove(e) {
    if (!this._dragCorner || !this._bbox) return;
    const cam = this._getCam();
    const store = this._getStore();
    if (!cam || !store || !store.current()) return;
    const rect = this._canvas.getBoundingClientRect();
    const stageRect = this._stage.getBoundingClientRect();
    const sx = e.clientX - stageRect.left;
    const sy = e.clientY - stageRect.top;
    const [ix, iy] = this._screenToImg(sx, sy, cam, rect, stageRect);
    if (!this._moved) { store.beginEdit(); this._moved = true; }
    const next = resizeBboxByCorner(this._bbox, this._dragCorner, [ix, iy]);
    store.applyFields({ bbox: next });
    this._onEdit();
    this.render(next);
  }

  _onPointerUp() {
    if (!this._dragCorner) return;
    const store = this._getStore();
    if (this._moved && store) store.commitEdit();
    this._dragCorner = null;
    this._moved = false;
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
  }
}
