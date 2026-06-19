// pcd_label/src/ui/pcd_panels.js
// 数值/滑杆读出 + 编辑面板。裁剪自 label/src/ui/panels.js：去掉相机内参与 bbox。
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

export class PcdPanels {
  constructor({ getRotation, getStore, getUI, getLastJoints, onEdit }) {
    this._getRotation = getRotation;
    this._getStore = getStore;
    this._getUI = getUI;
    this._getLastJoints = getLastJoints;
    this._onEdit = onEdit;
    this._betaEditing = false;
    this._activeDragEl = null;
    this._bindEulerInputs();
    this._buildBetaSliders();
    this._bindPosInputs();
  }

  _readOnly() { const ui = this._getUI(); return !!(ui && ui.readOnly); }

  _setVal(el, v) {
    if (!el) return;
    if (el === this._activeDragEl) return;
    if (el === document.activeElement && el.type !== 'range') return;
    el.value = v;
  }

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
      this._setVal($(`${prefix}-eul-x`), dx); this._setVal($(`${prefix}-eul-y`), dy); this._setVal($(`${prefix}-eul-z`), dz);
      this._setVal($(`${prefix}-eul-x-s`), dx); this._setVal($(`${prefix}-eul-y-s`), dy); this._setVal($(`${prefix}-eul-z-s`), dz);
    };

    if (!rot || !cur) {
      clearSet('pose'); clearSet('root');
      for (const id of ['pos-x', 'pos-y', 'pos-z']) this._setVal($(id), '');
      $('angle-list').innerHTML = '';
    } else {
      if (ui && ui.mode === 'pose' && ui.selectedJoint != null) writeSet('pose', rot.getJointEuler(ui.selectedJoint));
      else clearSet('pose');
      writeSet('root', rot.getRootEuler());
      const p = cur.root_pos || [0, 0, 0];
      this._setVal($('pos-x'), (+p[0]).toFixed(3));
      this._setVal($('pos-y'), (+p[1]).toFixed(3));
      this._setVal($('pos-z'), (+p[2]).toFixed(3));
      const lj = this._getLastJoints();
      if (lj) this.renderAngles(lj);
      const betas = cur.betas || [];
      for (let i = 0; i < 10; i++) { const s = $(`beta-${i}`); if (s) this._setVal(s, String(betas[i] ?? 0)); }
    }
  }

  renderAngles(joints) {
    const html = ANGLES.map(([label, a, v, b]) => {
      const ax = joints[a*3]-joints[v*3], ay = joints[a*3+1]-joints[v*3+1], az = joints[a*3+2]-joints[v*3+2];
      const bx = joints[b*3]-joints[v*3], by = joints[b*3+1]-joints[v*3+1], bz = joints[b*3+2]-joints[v*3+2];
      const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
      let deg = 0;
      if (la > 1e-9 && lb > 1e-9) { const c = Math.min(1, Math.max(-1, (ax*bx+ay*by+az*bz)/(la*lb))); deg = Math.acos(c) * DEG; }
      return `<div style="display:flex;justify-content:space-between"><span>${label}</span><span>${deg.toFixed(1)}°</span></div>`;
    }).join('');
    $('angle-list').innerHTML = html;
  }

  _bindEulerInputs() { this._bindEulerSet('pose'); this._bindEulerSet('root'); }

  _bindEulerSet(prefix) {
    const axes = [[`${prefix}-eul-x`, `${prefix}-eul-x-s`], [`${prefix}-eul-y`, `${prefix}-eul-y-s`], [`${prefix}-eul-z`, `${prefix}-eul-z-s`]];
    const readDegs = () => axes.map(([num]) => parseFloat($(num).value) || 0);
    const commitTo = (degVals) => {
      if (this._readOnly()) return;
      const rot = this._getRotation(); const store = this._getStore();
      if (!rot || !store || !store.current()) return;
      const e = degVals.map((d) => (d || 0) * RAD);
      if (prefix === 'pose') { const ui = this._getUI(); if (!ui || ui.selectedJoint == null) return; rot.setJointEuler(ui.selectedJoint, e); }
      else rot.setRootEuler(e);
      store.applyFields(rot.toAxisAngle()); this._onEdit();
    };
    let editing = false;
    const begin = () => { if (this._readOnly() || editing) return; const s = this._getStore(); if (s && s.current()) { s.beginEdit(); editing = true; } };
    const commit = () => { if (this._readOnly() || !editing) return; this._getStore().commitEdit(); editing = false; };
    for (const [numId, sliderId] of axes) {
      const num = $(numId), slider = $(sliderId);
      if (!num || !slider) continue;
      num.addEventListener('focus', begin);
      num.addEventListener('input', () => { begin(); this._setVal(slider, num.value); commitTo(readDegs()); });
      num.addEventListener('change', commit); num.addEventListener('blur', commit);
      slider.addEventListener('pointerdown', () => { this._activeDragEl = slider; begin(); });
      slider.addEventListener('input', () => { begin(); num.value = slider.value; commitTo(readDegs()); });
      const endSlider = () => { this._activeDragEl = null; commit(); };
      slider.addEventListener('change', endSlider); slider.addEventListener('pointerup', endSlider); slider.addEventListener('pointercancel', endSlider);
    }
  }

  _buildBetaSliders() {
    const host = $('beta-sliders'); host.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;align-items:center;gap:5px';
      const lab = document.createElement('span'); lab.textContent = `β${i}`; lab.style.cssText = 'font-size:10px;color:#888;width:22px';
      const s = document.createElement('input'); s.type = 'range'; s.id = `beta-${i}`; s.min = '-5'; s.max = '5'; s.step = '0.1'; s.value = '0';
      wrap.appendChild(lab); wrap.appendChild(s); host.appendChild(wrap);
    }
    const readBetas = () => { const out = []; for (let i = 0; i < 10; i++) out.push(parseFloat($(`beta-${i}`).value) || 0); return out; };
    for (let i = 0; i < 10; i++) {
      const s = $(`beta-${i}`);
      s.addEventListener('pointerdown', () => { this._activeDragEl = s; });
      s.addEventListener('input', () => {
        if (this._readOnly()) return;
        const store = this._getStore(); if (!store || !store.current()) return;
        if (!this._betaEditing) { store.beginEdit(); this._betaEditing = true; }
        store.applyFields({ betas: readBetas() }); this._onEdit();
      });
      const endDrag = () => { this._activeDragEl = null; if (this._readOnly() || !this._betaEditing) return; this._getStore().commitEdit(); this._betaEditing = false; };
      s.addEventListener('pointerup', endDrag); s.addEventListener('pointercancel', endDrag); s.addEventListener('change', endDrag);
    }
    $('btn-beta-reset').addEventListener('click', () => {
      if (this._readOnly()) return;
      const store = this._getStore(); if (!store || !store.current()) return;
      for (let i = 0; i < 10; i++) $(`beta-${i}`).value = '0';
      store.beginEdit(); store.applyFields({ betas: Array(10).fill(0) }); store.commitEdit(); this._onEdit();
    });
  }

  _bindPosInputs() {
    const ids = ['pos-x', 'pos-y', 'pos-z'];
    const readP = () => ids.map((id) => parseFloat($(id).value) || 0);
    let editing = false;
    for (const id of ids) {
      const el = $(id);
      el.addEventListener('focus', () => { if (this._readOnly()) return; const store = this._getStore(); if (store && store.current() && !editing) { store.beginEdit(); editing = true; } });
      el.addEventListener('input', () => { if (this._readOnly()) return; const store = this._getStore(); if (!store || !store.current()) return; if (!editing) { store.beginEdit(); editing = true; } store.applyFields({ root_pos: readP() }); this._onEdit(); });
      const commit = () => { if (this._readOnly() || !editing) return; this._getStore().commitEdit(); editing = false; };
      el.addEventListener('change', commit); el.addEventListener('blur', commit);
    }
  }
}
