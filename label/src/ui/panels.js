// label/src/ui/panels.js — numeric/slider readout + edit panels.
// Pure DOM glue; mutates RotationState / AnnotationStore / CameraModes via
// the provided getter callbacks (no app singletons imported).
import { JOINT_NAMES } from '../../../smpl_core/joint_names.js';

const $ = (id) => document.getElementById(id);
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;



const ANGLES = [
  ['R-Elbow', 16, 18, 20], ['L-Elbow', 17, 19, 21],
  ['R-Knee', 1, 4, 7], ['L-Knee', 2, 5, 8],
  ['R-Shoulder', 9, 16, 18], ['L-Shoulder', 9, 17, 19],
  ['R-Hip', 0, 1, 4], ['L-Hip', 0, 2, 5],
  ['Spine', 0, 6, 12],
];

export class Panels {
  constructor({ getRotation, getStore, getCam, getUI, getLastJoints, onEdit }) {
    this._getRotation = getRotation;
    this._getStore = getStore;
    this._getCam = getCam;
    this._getUI = getUI;
    this._getLastJoints = getLastJoints;
    this._onEdit = onEdit;
    this._betaEditing = false;
    this._activeDragEl = null;   // element currently being dragged (slider)
    this._bindEulerInputs();
    this._buildBetaSliders();
    this._bindPosInputs();
    this._bindIntrinsicsInputs();
  }

  _readOnly() { const ui = this._getUI(); return !!(ui && ui.readOnly); }

  // Write an input's value unless the user is actively editing it. A range
  // slider STAYS document.activeElement after pointerup, so relying on focus
  // alone makes post-undo refresh skip a just-released slider forever (until it
  // blurs). We therefore skip only: (a) the element currently being dragged
  // (tracked explicitly), or (b) a focused text/number input being typed into.
  _setVal(el, v) {
    if (!el) return;
    if (el === this._activeDragEl) return;
    if (el === document.activeElement && el.type !== 'range') return;
    el.value = v;
  }

  // ── Refresh all readouts from current state ───────────────────────────────
  syncFromState() {
    const rot = this._getRotation();
    const store = this._getStore();
    const ui = this._getUI();
    const cur = store ? store.current() : null;

    const clearSet = (prefix) => {
      for (const id of [`${prefix}-eul-x`, `${prefix}-eul-y`, `${prefix}-eul-z`, `${prefix}-eul-x-s`, `${prefix}-eul-y-s`, `${prefix}-eul-z-s`]) this._setVal($(id), '');
    };
    const writeSet = (prefix, e) => {
      const dx = (e[0] * DEG).toFixed(1), dy = (e[1] * DEG).toFixed(1), dz = (e[2] * DEG).toFixed(1);
      this._setVal($(`${prefix}-eul-x`), dx);
      this._setVal($(`${prefix}-eul-y`), dy);
      this._setVal($(`${prefix}-eul-z`), dz);
      this._setVal($(`${prefix}-eul-x-s`), dx);
      this._setVal($(`${prefix}-eul-y-s`), dy);
      this._setVal($(`${prefix}-eul-z-s`), dz);
    };

    // bbox 读出独立于 rotation:仅 bbox 帧(rot 为 null)也要显示框值。
    const bb = cur && Array.isArray(cur.bbox) && cur.bbox.some((v) => v !== 0) ? cur.bbox : null;
    $('bbox-ro').textContent = bb
      ? `${Math.round(bb[0])}, ${Math.round(bb[1])}, ${Math.round(bb[2])}, ${Math.round(bb[3])}`
      : '—';

    if (!rot || !cur) {
      clearSet('pose');
      clearSet('root');
      for (const id of ['pos-x', 'pos-y', 'pos-z']) this._setVal($(id), '');
      $('angle-list').innerHTML = '';
    } else {
      // POSE set: only when a joint is selected in pose mode.
      if (ui && ui.mode === 'pose' && ui.selectedJoint != null) {
        writeSet('pose', rot.getJointEuler(ui.selectedJoint));
      } else {
        clearSet('pose');
      }
      // ROOT set: always reflect root rotation.
      writeSet('root', rot.getRootEuler());
      const p = cur.root_pos || [0, 0, 0];
      this._setVal($('pos-x'), (+p[0]).toFixed(3));
      this._setVal($('pos-y'), (+p[1]).toFixed(3));
      this._setVal($('pos-z'), (+p[2]).toFixed(3));
      const lj = this._getLastJoints();
      if (lj) this.renderAngles(lj);
      // beta sliders reflect current betas. _setVal skips the slider that is
      // currently focused (i.e. being dragged), so an active drag is never
      // clobbered while post-undo / frame-nav refreshes all others.
      const betas = cur.betas || [];
      for (let i = 0; i < 10; i++) {
        const s = $(`beta-${i}`);
        if (s) this._setVal(s, String(betas[i] ?? 0));
      }
    }

    // Intrinsics always reflect live K.
    const cam = this._getCam();
    if (cam && cam.K) {
      this._setVal($('k-fx'), String(cam.K.fx));
      this._setVal($('k-fy'), String(cam.K.fy));
      this._setVal($('k-cx'), String(cam.K.cx));
      this._setVal($('k-cy'), String(cam.K.cy));
    }
  }

  renderAngles(joints) {
    const html = ANGLES.map(([label, a, v, b]) => {
      const ax = joints[a * 3] - joints[v * 3], ay = joints[a * 3 + 1] - joints[v * 3 + 1], az = joints[a * 3 + 2] - joints[v * 3 + 2];
      const bx = joints[b * 3] - joints[v * 3], by = joints[b * 3 + 1] - joints[v * 3 + 1], bz = joints[b * 3 + 2] - joints[v * 3 + 2];
      const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
      let deg = 0;
      if (la > 1e-9 && lb > 1e-9) {
        const c = Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (la * lb)));
        deg = Math.acos(c) * DEG;
      }
      return `<div style="display:flex;justify-content:space-between"><span>${label}</span><span>${deg.toFixed(1)}°</span></div>`;
    }).join('');
    $('angle-list').innerHTML = html;
  }

  // ── Euler XYZ inputs (numeric + sliders) ─────────────────────────────────
  // Two independent sets: 'pose' edits the selected joint, 'root' edits root.
  _bindEulerInputs() {
    this._bindEulerSet('pose');
    this._bindEulerSet('root');
  }

  _bindEulerSet(prefix) {
    const axes = [
      [`${prefix}-eul-x`, `${prefix}-eul-x-s`],
      [`${prefix}-eul-y`, `${prefix}-eul-y-s`],
      [`${prefix}-eul-z`, `${prefix}-eul-z-s`],
    ];
    const readDegs = () => axes.map(([num]) => parseFloat($(num).value) || 0);
    const commitTo = (degVals) => {
      if (this._readOnly()) return;
      const rot = this._getRotation();
      const store = this._getStore();
      if (!rot || !store || !store.current()) return;
      const e = degVals.map((d) => (d || 0) * RAD);
      if (prefix === 'pose') {
        const ui = this._getUI();
        if (!ui || ui.selectedJoint == null) return;
        rot.setJointEuler(ui.selectedJoint, e);
      } else {
        rot.setRootEuler(e);
      }
      store.applyFields(rot.toAxisAngle());
      this._onEdit();
    };
    // One editing session = one undo unit. begin() only opens a transaction
    // once; commit() only closes one that is open. Without this guard a single
    // release fires both pointerup+change (slider) or change+blur (number),
    // committing twice — the 2nd commit would push a before:null undo record
    // and a later Ctrl+Z would DELETE the annotation (data loss).
    let editing = false;
    const begin = () => { if (this._readOnly() || editing) return; const s = this._getStore(); if (s && s.current()) { s.beginEdit(); editing = true; } };
    const commit = () => { if (this._readOnly() || !editing) return; this._getStore().commitEdit(); editing = false; };
    for (const [numId, sliderId] of axes) {
      const num = $(numId);
      const slider = $(sliderId);
      if (!num || !slider) continue;
      num.addEventListener('focus', begin);
      num.addEventListener('input', () => {
        begin();
        this._setVal(slider, num.value);
        commitTo(readDegs());
      });
      num.addEventListener('change', commit);
      num.addEventListener('blur', commit);
      slider.addEventListener('pointerdown', () => { this._activeDragEl = slider; begin(); });
      slider.addEventListener('input', () => {
        begin();
        num.value = slider.value;
        commitTo(readDegs());
      });
      const endSlider = () => { this._activeDragEl = null; commit(); };
      slider.addEventListener('change', endSlider);
      slider.addEventListener('pointerup', endSlider);
      slider.addEventListener('pointercancel', endSlider);
    }
  }

  // ── Beta sliders ──────────────────────────────────────────────────────────
  _buildBetaSliders() {
    const host = $('beta-sliders');
    host.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:5px';
      const lab = document.createElement('span');
      lab.textContent = `β${i}`;
      lab.style.cssText = 'font-size:10px;color:#888;width:22px';
      const s = document.createElement('input');
      s.type = 'range'; s.id = `beta-${i}`;
      s.min = '-5'; s.max = '5'; s.step = '0.1'; s.value = '0';
      wrap.appendChild(lab); wrap.appendChild(s);
      host.appendChild(wrap);
    }
    const readBetas = () => {
      const out = [];
      for (let i = 0; i < 10; i++) out.push(parseFloat($(`beta-${i}`).value) || 0);
      return out;
    };
    for (let i = 0; i < 10; i++) {
      const s = $(`beta-${i}`);
      s.addEventListener('pointerdown', () => { this._activeDragEl = s; });
      s.addEventListener('input', () => {
        if (this._readOnly()) return;
        const store = this._getStore();
        if (!store || !store.current()) return;
        if (!this._betaEditing) { store.beginEdit(); this._betaEditing = true; }
        store.applyFields({ betas: readBetas() });
        this._onEdit();
      });
      // Commit on release. 'change' alone is unreliable (it may not fire before
      // the user clicks elsewhere); pointerup/pointercancel guarantee the undo
      // unit is closed the moment the drag ends, so an immediate Ctrl+Z reverts
      // this beta edit (was the bug: release→undo left sliders un-reverted).
      const endDrag = () => {
        this._activeDragEl = null;
        if (this._readOnly() || !this._betaEditing) return;
        this._getStore().commitEdit();
        this._betaEditing = false;
      };
      s.addEventListener('pointerup', endDrag);
      s.addEventListener('pointercancel', endDrag);
      s.addEventListener('change', endDrag);
    }
    $('btn-beta-reset').addEventListener('click', () => {
      if (this._readOnly()) return;
      const store = this._getStore();
      if (!store || !store.current()) return;
      for (let i = 0; i < 10; i++) $(`beta-${i}`).value = '0';
      store.beginEdit();
      store.applyFields({ betas: Array(10).fill(0) });
      store.commitEdit();
      this._onEdit();
    });
  }

  // ── Root pos inputs ───────────────────────────────────────────────────────
  _bindPosInputs() {
    const ids = ['pos-x', 'pos-y', 'pos-z'];
    const readP = () => ids.map((id) => parseFloat($(id).value) || 0);
    let editing = false;
    for (const id of ids) {
      const el = $(id);
      el.addEventListener('focus', () => {
        if (this._readOnly()) return;
        const store = this._getStore();
        if (store && store.current() && !editing) { store.beginEdit(); editing = true; }
      });
      el.addEventListener('input', () => {
        if (this._readOnly()) return;
        const store = this._getStore();
        if (!store || !store.current()) return;
        if (!editing) { store.beginEdit(); editing = true; }
        store.applyFields({ root_pos: readP() });
        this._onEdit();
      });
      const commit = () => {
        if (this._readOnly() || !editing) return;
        this._getStore().commitEdit(); editing = false;
      };
      el.addEventListener('change', commit);
      el.addEventListener('blur', commit);
    }
  }

  // ── Intrinsics inputs ─────────────────────────────────────────────────────
  _bindIntrinsicsInputs() {
    const ids = ['k-fx', 'k-fy', 'k-cx', 'k-cy'];
    for (const id of ids) {
      $(id).addEventListener('input', () => {
        if (this._readOnly()) return;
        const cam = this._getCam();
        if (!cam) return;
        cam.setIntrinsics({
          fx: parseFloat($('k-fx').value),
          fy: parseFloat($('k-fy').value),
          cx: parseFloat($('k-cx').value),
          cy: parseFloat($('k-cy').value),
        });
        this._onEdit();
      });
    }
    $('btn-k-reset').addEventListener('click', () => {
      const cam = this._getCam();
      if (!cam) return;
      cam.resetIntrinsics();
      this.syncFromState();
      this._onEdit();
    });
  }
}
