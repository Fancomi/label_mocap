// label/src/ui/panels.js — numeric/slider readout + edit panels.
// Pure DOM glue; mutates RotationState / AnnotationStore / CameraModes via
// the provided getter callbacks (no app singletons imported).
const $ = (id) => document.getElementById(id);
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;


export class Panels {
  // getBody:当前 BodyModel(关节角读数表 angleReadouts 来自它)。
  constructor({ getRotation, getStore, getCam, getUI, getLastJoints, getBody, onEdit }) {
    this._getRotation = getRotation;
    this._getBody = getBody;
    this._getStore = getStore;
    this._getCam = getCam;
    this._getUI = getUI;
    this._getLastJoints = getLastJoints;
    this._onEdit = onEdit;
    this._shapeEditing = false;
    this._shapeSliders = [];     // [{ el, key, index }],由 setBody 按 body.shapeGroups 重建
    this._activeDragEl = null;   // element currently being dragged (slider)
    this._bindEulerInputs();
    this._bindShapeReset();
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
    // 体型滑块归位到中心(0)。range 无法置空,0 即「无数据」的视觉表示。
    const clearShape = () => { for (const { el } of this._shapeSliders) this._setVal(el, '0'); };
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
    if ($('bbox-ro')) $('bbox-ro').textContent = bb
      ? `${Math.round(bb[0])}, ${Math.round(bb[1])}, ${Math.round(bb[2])}, ${Math.round(bb[3])}`
      : '—';

    if (!rot || !cur) {
      // 无数据(或仅 bbox 帧):清空姿态/整体欧拉、整体平移、关节角度,并把体型滑块归 0。
      // 否则切到未标注数据时会残留上一份数据的滑块/读数。
      clearSet('pose');
      clearSet('root');
      for (const id of ['pos-x', 'pos-y', 'pos-z']) this._setVal($(id), '');
      $('angle-list').innerHTML = '';
      clearShape();
    } else {
      // POSE set: only when a joint is selected in pose mode.
      if (ui && ui.mode === 'pose' && ui.selectedJoint != null) {
        writeSet('pose', rot.getJointEuler(ui.selectedJoint));
        // MHR 关节的自由度受 rig 限制(如肘只有 rz):不可编辑的轴只读显示。
        const editable = rot.editableChannels ? rot.editableChannels(ui.selectedJoint) : [0, 1, 2];
        ['x', 'y', 'z'].forEach((ax, i) => {
          for (const id of [`pose-eul-${ax}`, `pose-eul-${ax}-s`]) { const el = $(id); if (el) el.disabled = !editable.includes(i); }
        });
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
      // 体型滑块反映当前参数。_setVal 跳过正在拖的滑块,undo/切帧刷新其余滑块不冲掉拖拽。
      for (const { el, key, index } of this._shapeSliders) this._setVal(el, String(cur[key]?.[index] ?? 0));
    }

    // Intrinsics always reflect live K.
    const cam = this._getCam();
    if (cam && cam.K && $('k-fx')) {
      this._setVal($('k-fx'), String(cam.K.fx));
      this._setVal($('k-fy'), String(cam.K.fy));
      this._setVal($('k-cx'), String(cam.K.cx));
      this._setVal($('k-cy'), String(cam.K.cy));
    }
  }

  renderAngles(joints) {
    const html = (this._getBody()?.angleReadouts ?? []).map(([label, a, v, b]) => {
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
        // 姿态状态可能把值夹在关节限位内(MHR):滑块/输入框回到实际值,拖过限位就「拖不下去」。
        const back = rot.getJointEuler(ui.selectedJoint);
        axes.forEach(([num, slider], i) => {
          if (Math.abs(back[i] - e[i]) * DEG < 0.05) return;
          const v = (back[i] * DEG).toFixed(1);
          $(num).value = v; $(slider).value = v;
        });
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

  // ── Shape sliders(按 body.shapeGroups 生成;SMPL = 10 个 β,MHR = 分组体型/缩放)──
  setBody(body) {
    const host = $('beta-sliders');
    host.innerHTML = '';
    this._shapeSliders = [];
    for (const g of body.shapeGroups ?? []) {
      const box = document.createElement('details');
      box.open = !!g.open;
      const sum = document.createElement('summary');
      sum.textContent = `${g.title} (${g.indices.length})`;
      box.appendChild(sum);
      g.indices.forEach((index, n) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:5px';
        const lab = document.createElement('span');
        lab.textContent = g.labels[n];
        lab.title = g.labels[n];
        lab.style.cssText = 'font-size:10px;color:#888;width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        const el = document.createElement('input');
        el.type = 'range'; el.min = String(g.min); el.max = String(g.max); el.step = String(g.step); el.value = '0';
        el.style.flex = '1';
        wrap.appendChild(lab); wrap.appendChild(el);
        box.appendChild(wrap);
        this._bindShapeSlider(el, g.key, index);
        this._shapeSliders.push({ el, key: g.key, index });
      });
      host.appendChild(box);
    }
  }

  _bindShapeSlider(el, key, index) {
    el.addEventListener('pointerdown', () => { this._activeDragEl = el; });
    el.addEventListener('input', () => {
      if (this._readOnly()) return;
      const store = this._getStore();
      const cur = store?.current();
      if (!cur || !Array.isArray(cur[key])) return;
      if (!this._shapeEditing) { store.beginEdit(); this._shapeEditing = true; }
      const arr = cur[key].slice();
      arr[index] = parseFloat(el.value) || 0;
      store.applyFields({ [key]: arr });
      this._onShapeEdit(key, arr);
    });
    // Commit on release. 'change' alone is unreliable (it may not fire before
    // the user clicks elsewhere); pointerup/pointercancel guarantee the undo
    // unit is closed the moment the drag ends, so an immediate Ctrl+Z reverts it.
    const endDrag = () => {
      this._activeDragEl = null;
      if (this._readOnly() || !this._shapeEditing) return;
      this._getStore().commitEdit();
      this._shapeEditing = false;
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('change', endDrag);
  }

  // 姿态参数里的体型项(MHR 柔性长度)也在姿态编辑状态里:同步过去,避免下次姿态拖拽把它写回旧值。
  _onShapeEdit(key, arr) {
    const rot = this._getRotation();
    if (rot && key === 'mhr_pose' && rot.setPoseParams) rot.setPoseParams(arr);
    this._onEdit();
  }

  _bindShapeReset() {
    $('btn-beta-reset').addEventListener('click', () => {
      if (this._readOnly()) return;
      const store = this._getStore();
      const cur = store?.current();
      if (!cur) return;
      const fields = {};
      for (const { el, key, index } of this._shapeSliders) {
        fields[key] ??= cur[key].slice();
        fields[key][index] = 0;
        el.value = '0';
      }
      store.beginEdit();
      store.applyFields(fields);
      store.commitEdit();
      if (fields.mhr_pose) this._onShapeEdit('mhr_pose', fields.mhr_pose);
      else this._onEdit();
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
  // 页面没有内参输入框(如多视角页:内参来自标定,不可改)时跳过。
  _bindIntrinsicsInputs() {
    if (!$('k-fx')) return;
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
