// smpl_edit/joint_picker.js
import * as THREE from 'three';

// 点击判定阈值:pointerdown→pointerup 位移 < 此值(px)视为「点击」,
// 否则视为拖拽(平移/拖手柄),不触发关节选中/取消。与 app.js 平移阈值一致。
const CLICK_THRESH = 4;

// Raycast a pointer event against the scene's joint spheres.
// Returns the SMPL joint index (0..23) or null. onPick(smplIndex) is called on hit.
export class JointPicker {
  constructor({ canvas, camera, getJointMeshes, onPick, onMiss, canPick }) {
    this._canvas = canvas;
    this._camera = camera;
    this._getJointMeshes = getJointMeshes;
    this._onPick = onPick;
    this._onMiss = onMiss;
    this._canPick = canPick || (() => true);
    this._ray = new THREE.Raycaster();
    this._enabled = false;
    this._start = null; // pointerdown 起点 {x,y};拖拽过程累计位移用
    this._down = (e) => this._onPointerDown(e);
    this._move = (e) => this._onPointerMove(e);
    this._up = (e) => this._onPointerUp(e);
    canvas.addEventListener('pointerdown', this._down);
    canvas.addEventListener('pointermove', this._move);
    canvas.addEventListener('pointerup', this._up);
  }

  setEnabled(v) { this._enabled = v; }

  setCamera(camera) { if (camera) this._camera = camera; }

  _onPointerDown(e) {
    if (!this._enabled) { this._start = null; return; }
    // 仅记录起点,不在按下当场 raycast(否则会与平移拖拽竞争、误清选中)。
    this._start = { x: e.clientX, y: e.clientY, moved: false };
  }

  _onPointerMove(e) {
    if (!this._start || this._start.moved) return;
    if (Math.hypot(e.clientX - this._start.x, e.clientY - this._start.y) > CLICK_THRESH) {
      this._start.moved = true; // 超阈值 → 判定为拖拽
    }
  }

  _onPointerUp(e) {
    const start = this._start;
    this._start = null;
    if (!this._enabled || !start) return;
    if (start.moved) return; // 拖拽:不触发选中/取消
    if (this._canPick && !this._canPick()) return; // 拖手柄等情形不选
    const rect = this._canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this._ray.setFromCamera(ndc, this._camera);
    const meshes = this._getJointMeshes();
    const hits = this._ray.intersectObjects(meshes, false);
    if (hits.length) {
      const idx = hits[0].object.userData.jointIndex;
      if (typeof idx === 'number') this._onPick(idx);
    } else {
      this._onMiss && this._onMiss();
    }
  }

  dispose() {
    this._canvas.removeEventListener('pointerdown', this._down);
    this._canvas.removeEventListener('pointermove', this._move);
    this._canvas.removeEventListener('pointerup', this._up);
  }
}
