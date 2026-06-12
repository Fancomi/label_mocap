// label/src/ui/panels.js — numeric/slider readout + edit panels.
// Pure DOM glue; mutates RotationState / AnnotationStore / CameraModes via
// the provided getter callbacks (no app singletons imported).

const $ = (id) => document.getElementById(id);
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const JOINT_NAMES = ['Pelvis', 'L_Hip', 'R_Hip', 'Spine1', 'L_Knee', 'R_Knee', 'Spine2', 'L_Ankle', 'R_Ankle', 'Spine3', 'L_Foot', 'R_Foot', 'Neck', 'L_Collar', 'R_Collar', 'Head', 'L_Shoulder', 'R_Shoulder', 'L_Elbow', 'R_Elbow', 'L_Wrist', 'R_Wrist', 'L_Hand', 'R_Hand'];

const ANGLES = [
  ['R-Elbow', 16, 18, 20], ['L-Elbow', 17, 19, 21],
  ['R-Knee', 1, 4, 7], ['L-Knee', 2, 5, 8],
  ['R-Shoulder', 9, 16, 18], ['L-Shoulder', 9, 17, 19],
  ['R-Hip', 0, 1, 4], ['L-Hip', 0, 2, 5],
  ['Spine', 0, 6, 12],
];

export class Panels {
  constructor({ getRotation, getStore, getCam, getEditController, getLastJoints, onEdit }) {
    this._getRotation = getRotation;
    this._getStore = getStore;
    this._getCam = getCam;
    this._getEC = getEditController;
    this._getLastJoints = getLastJoints;
    this._onEdit = onEdit;
    this._betaEditing = false;
    this._bindEulerInputs();
    this._buildBetaSliders();
    this._bindPosInputs();
    this._bindIntrinsicsInputs();
  }

  _readOnly() { const ec = this._getEC(); return !!(ec && ec.readOnly); }

  // Write an input's value unless it is currently focused (avoid clobbering
  // the value a user is actively typing into).
  _setVal(el, v) { if (el && el !== document.activeElement) el.value = v; }

  // ── Joint <select> ────────────────────────────────────────────────────────
  populateJointSelect() {
    const sel = $('joint-select');
    sel.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = '选择关节…';
    sel.appendChild(blank);
    // index 0 = root (pelvis), then 21 body joints (SMPL joints 1..21).
    const rootOpt = document.createElement('option');
    rootOpt.value = 'root'; rootOpt.textContent = `0 ${JOINT_NAMES[0]} (root)`;
    sel.appendChild(rootOpt);
    for (let j = 0; j < 21; j++) {
      const opt = document.createElement('option');
      opt.value = String(j);
      opt.textContent = `${j + 1} ${JOINT_NAMES[j + 1]}`;
      sel.appendChild(opt);
    }
  }

  // The euler target: a body joint index if pose-tool has one selected, else root.
  _activeJoint() {
    const ec = this._getEC();
    if (ec && ec.tool === 'pose' && ec.selectedJoint != null) return ec.selectedJoint;
    return null; // root
  }

  // ── Refresh all readouts from current state ───────────────────────────────
  syncFromState() {
    const rot = this._getRotation();
    const store = this._getStore();
    const cur = store ? store.current() : null;

    if (!rot || !cur) {
      for (const id of ['eul-x', 'eul-y', 'eul-z', 'pos-x', 'pos-y', 'pos-z']) this._setVal($(id), '');
      $('bbox-ro').textContent = '—';
      $('angle-list').innerHTML = '';
    } else {
      const j = this._activeJoint();
      const e = j != null ? rot.getJointEuler(j) : rot.getRootEuler();
      this._setVal($('eul-x'), (e[0] * DEG).toFixed(1));
      this._setVal($('eul-y'), (e[1] * DEG).toFixed(1));
      this._setVal($('eul-z'), (e[2] * DEG).toFixed(1));
      const p = cur.root_pos || [0, 0, 0];
      this._setVal($('pos-x'), (+p[0]).toFixed(3));
      this._setVal($('pos-y'), (+p[1]).toFixed(3));
      this._setVal($('pos-z'), (+p[2]).toFixed(3));
      if (cur.bbox) {
        const [x, y, w, h] = cur.bbox;
        $('bbox-ro').textContent = `${Math.round(x)}, ${Math.round(y)}, ${Math.round(w)}, ${Math.round(h)}`;
      } else {
        $('bbox-ro').textContent = '—';
      }
      const lj = this._getLastJoints();
      if (lj) this.renderAngles(lj);
      // beta sliders reflect current betas (skip while user is dragging)
      if (!this._betaEditing) {
        const betas = cur.betas || [];
        for (let i = 0; i < 10; i++) {
          const s = $(`beta-${i}`);
          if (s) this._setVal(s, String(betas[i] ?? 0));
        }
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

  // ── Euler XYZ inputs ──────────────────────────────────────────────────────
  _bindEulerInputs() {
    const ids = ['eul-x', 'eul-y', 'eul-z'];
    const readE = () => ids.map((id) => (parseFloat($(id).value) || 0) * RAD);
    for (const id of ids) {
      const el = $(id);
      el.addEventListener('focus', () => { if (!this._readOnly()) this._getStore().beginEdit(); });
      el.addEventListener('input', () => {
        if (this._readOnly()) return;
        const rot = this._getRotation();
        const store = this._getStore();
        if (!rot || !store || !store.current()) return;
        const e = readE();
        const j = this._activeJoint();
        if (j != null) rot.setJointEuler(j, e);
        else rot.setRootEuler(e);
        store.applyFields(rot.toAxisAngle());
        this._onEdit();
      });
      const commit = () => { if (!this._readOnly()) this._getStore().commitEdit(); };
      el.addEventListener('change', commit);
      el.addEventListener('blur', commit);
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
      s.addEventListener('input', () => {
        if (this._readOnly()) return;
        const store = this._getStore();
        if (!store || !store.current()) return;
        if (!this._betaEditing) { store.beginEdit(); this._betaEditing = true; }
        store.applyFields({ betas: readBetas() });
        this._onEdit();
      });
      s.addEventListener('change', () => {
        if (this._readOnly() || !this._betaEditing) return;
        this._getStore().commitEdit();
        this._betaEditing = false;
      });
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
