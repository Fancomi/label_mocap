// smpl_edit/ik_plugin.js
// IK 子系统的「一键插拔插件」。本体 app.js 只需调用 installIK(ctx) 一行,
// 不出现任何 IK 名字;装上/拆下都不影响本体的姿势/根节点编辑链路。
//
// 插件内部持有 ikController + 两个 DragHandle(末端柄 / 极向量柄)+ ikEnabled(闭包局部),
// 并通过 ctx 提供的扩展点接入本体:
//  - registerGuard(handle):把手柄并入本体的拖拽/悬停守卫聚合;
//  - registerSyncHook(fn):fn 在本体 syncUI 末尾被调,返回 true 表示「接管了当前交互」
//    (本体据此不再挂自己的单关节旋转 gizmo)。
// 单活动:任一时刻只有一个柄出三轴箭头,另一个缩为可点选标识 mesh;点 marker 切换(见下)。
import { IKController } from './ik_controller.js';
import { DragHandle, makeHandleMarker } from './drag_handle.js';
import { HandleSelection } from './handle_selection.js';
import * as THREE from 'three';

// 安装 IK 插件。返回 uninstall 函数(调用即彻底拆除,不留痕迹)。
export function installIK(ctx) {
  let ikEnabled = false;

  const selection = new HandleSelection();
  let takeoverActive = false;        // syncHook 置位:当前是否处于 IK 接管态(决定切换监听是否生效)
  const CLICK_THRESH = 4;            // 与 joint_picker 一致:位移 < 4px 视为点击
  const _ray = new THREE.Raycaster();
  let _down = null;                  // pointerdown 起点 {x,y,moved}
  let _hitMarker = null;             // pointerdown 命中的标识 mesh(null=未命中);驱动切换与 JointPicker 让位

  // 反解控制器:依赖注入,parents 通过 getParents 按需读取(不再 setParents)。
  const ikController = new IKController({
    getRotation: ctx.getRotation,
    getStore: ctx.getStore,
    getLastJoints: ctx.getLastJoints,
    getLastWorldRot: ctx.getLastWorldRot,
    getSkeleton: () => 'smpl',
    getParents: ctx.getParents,
    onEdit: ctx.onEdit,
  });

  // 当前选中链(末端柄/极向量柄共用的解析入口):依 UI 选中关节求链,无则 null。
  const currentChain = () => ikController.chainFor((ctx.getUI()?.selectedJoint ?? -1) + 1);

  // 两柄共享的场景接线;差异仅在 marker 外观、回调、活动态是否仍显示 marker。
  const handleBase = { scene: ctx.scene.threeScene(), camera: ctx.camera, canvas: ctx.canvas, getStore: ctx.getStore };

  // 末端拖拽手柄:按下冻结参考、拖拽绝对求解、松开清参考。非活动态显示灰白立方体占位。
  const ikHandle = new DragHandle({
    ...handleBase,
    marker: makeHandleMarker(new THREE.BoxGeometry(0.04, 0.04, 0.04), 0xcccccc),
    onStart: () => { const c = currentChain(); if (c) ikController.beginDrag(c); },
    onDrag: (worldPos) => ikController.solveTo(worldPos),
    onEnd: () => ikController.endDrag(),
  });
  ctx.registerGuard(ikHandle);

  // 极向量手柄:按下冻结参考、拖拽仅旋转弯折平面、松开把世界 pole 写入存储。
  // 青球两态都显示(活动时作头标,非活动时作占位标识)。
  const poleHandle = new DragHandle({
    ...handleBase,
    marker: makeHandleMarker(new THREE.SphereGeometry(0.025, 16, 12), 0x00d0d0),
    markerAlwaysVisible: true,
    onStart: () => { const c = currentChain(); if (c) ikController.beginPoleDrag(c); },
    onDrag: (worldPos) => ikController.solveToPole(worldPos),
    onEnd: () => ikController.endPoleDrag(),
  });
  ctx.registerGuard(poleHandle);

  // active 视口切换时,两柄也要换相机(多视口下 TransformControls 须跟随 active 相机)。
  // 其它 app(单视口)不传 registerCameraConsumer 时 ?. 静默跳过。
  ctx.registerCameraConsumer?.((c) => { ikHandle.setCamera(c); poleHandle.setCamera(c); });

  // 多视口:把两柄 TC 的指针→NDC 重映射成 active 视口子矩形(覆写整块-canvas getPointer)。
  // 单视口 app 不传 ndcMapper 时跳过,走整块 canvas 旧路径(零回归)。
  if (ctx.ndcMapper) { ikHandle.setNdcMapper?.(ctx.ndcMapper); poleHandle.setNdcMapper?.(ctx.ndcMapper); }

  // 占位标识点击守卫:按在 marker 上的瞬间 isEngaged=true,使 JointPicker 的 canPick 失效,
  // 避免它把「点 marker」当作 miss 而清掉关节选中(否则切换会被它抢先清选打断)。
  ctx.registerGuard({ isEngaged: () => !!_hitMarker, isDragging: () => false });

  // 开关按钮:本体默认隐藏(index.html 带 hidden),install 时显形。
  ctx.toggleButton.hidden = false;
  const onToggleClick = () => {
    ikEnabled = !ikEnabled;
    ctx.toggleButton.classList.toggle('on', ikEnabled);
    ctx.setStatus(ikEnabled ? 'IK 拖拽已开启:拖手腕/脚踝' : 'IK 拖拽已关闭');
    ctx.requestSync();
  };
  ctx.toggleButton.addEventListener('click', onToggleClick);

  // syncUI 末尾钩子:收敛原本体里的「joint-grid 末端灰显」+「IK 分支」。
  // 返回 true 表示本插件接管了当前交互(本体不再挂单关节旋转 gizmo)。
  function syncHook() {
    const ui = ctx.getUI();
    if (!ui) return false;
    // joint-grid 末端灰显/描边:IK 开启时只有末端关节(腕/踝)可拖,其余灰掉;
    // 关闭时复位(disabled=false、去 .ik)。
    ctx.jointGridButtons.forEach((b, j) => {
      const isEnd = ikEnabled && !!ikController.chainFor(j + 1);
      b.disabled = ikEnabled && !isEnd;
      b.classList.toggle('ik', isEnd);
    });
    const ikChain = ikEnabled ? currentChain() : null;
    if (!ctx.isPlaying() && ui.mode === 'pose' && ikChain && ctx.getLastJoints()) {
      selection.bindChain(ikChain.name);            // 换链重置回 'end',同链保持
      ikHandle.attach(ctx.scene.jointWorldPosition(ui.selectedJoint + 1));
      const stored = ikController.storedPole(ikChain.name);
      poleHandle.attach(stored ?? ikController.autoPoleViz(ikChain));
      // 单活动:按 selection 决定谁出箭头、谁作占位标识(attach 后再 setActive,以 setActive 为准)。
      ikHandle.setActive(selection.active() === 'end');
      poleHandle.setActive(selection.active() === 'pole');
      takeoverActive = true;
      return true; // 接管:本体不要再挂单关节旋转 gizmo
    }
    selection.reset();
    takeoverActive = false;
    ikHandle.detach();
    poleHandle.detach();
    return false;
  }
  ctx.registerSyncHook(syncHook);

  // 切换拾取:在画布上自挂轻量 pointerdown/move/up。pointerdown 时 raycast 两个标识 mesh
  // (末端立方体 / 极向量球),记下命中的那个 → 既用于 pointerup 决定切到哪个柄,也经上面
  // 注册的 guard 让 JointPicker 本次点击 canPick 失效(不把点 marker 当 miss 而清选)。
  // 不复用 JointPicker:标识 mesh 不是关节球,且语义(切换 vs 选关节)不同。
  const canvas = ctx.canvas;
  const markerUnder = (e) => {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    _ray.setFromCamera(ndc, ctx.camera);
    const hits = _ray.intersectObjects([ikHandle.markerMesh(), poleHandle.markerMesh()], false);
    return hits.length ? hits[0].object : null;
  };
  const onPointerDown = (e) => {
    _down = { x: e.clientX, y: e.clientY, moved: false };
    // 仅在 IK 接管态判定命中;_hitMarker 同时驱动切换与 JointPicker 让位 guard。
    _hitMarker = takeoverActive ? markerUnder(e) : null;
  };
  const onPointerMove = (e) => {
    if (!_down || _down.moved) return;
    if (Math.hypot(e.clientX - _down.x, e.clientY - _down.y) > CLICK_THRESH) _down.moved = true;
  };
  const onPointerUp = () => {
    const down = _down; _down = null;
    const hit = _hitMarker; _hitMarker = null;
    if (!down || down.moved || !hit) return;                      // 拖拽 / 未按在 marker → 不切换
    if (ikHandle.isDragging() || poleHandle.isDragging()) return; // 正在拖箭头 → 不切换
    selection.select(hit === poleHandle.markerMesh() ? 'pole' : 'end');
    ctx.requestSync(); // 重挂:syncHook 据 selection 重新 setActive
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);

  // 卸载:移除监听、隐藏按钮、detach 手柄、复位 joint-grid。彻底拆除不留痕迹。
  return function uninstallIK() {
    ctx.toggleButton.removeEventListener('click', onToggleClick);
    ctx.toggleButton.classList.remove('on');
    ctx.toggleButton.hidden = true;
    ikHandle.detach();
    poleHandle.detach();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    selection.reset();
    takeoverActive = false;
    _hitMarker = null;
    ctx.jointGridButtons.forEach((b) => { b.disabled = false; b.classList.remove('ik'); });
  };
}
