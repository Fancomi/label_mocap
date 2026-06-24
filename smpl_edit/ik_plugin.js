// smpl_edit/ik_plugin.js
// IK 子系统的「一键插拔插件」。本体 app.js 只需调用 installIK(ctx) 一行,
// 不出现任何 IK 名字;装上/拆下都不影响本体的姿势/根节点编辑链路。
//
// 插件内部持有 ikController / ikHandle / ikEnabled(闭包局部,不污染本体作用域),
// 并通过 ctx 提供的扩展点接入本体:
//  - registerGuard(handle):把 ikHandle 并入本体的拖拽/悬停守卫聚合;
//  - registerSyncHook(fn):fn 在本体 syncUI 末尾被调,返回 true 表示「接管了当前交互」
//    (本体据此不再挂自己的单关节旋转 gizmo)。
import { IKController } from './ik_controller.js';
import { IKHandle } from './ik_handle.js';
import { PoleHandle } from './pole_handle.js';
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

  // 末端拖拽手柄:按下冻结参考、拖拽绝对求解、松开清参考。
  const ikHandle = new IKHandle({
    scene: ctx.scene.threeScene(),
    camera: ctx.camera,
    canvas: ctx.canvas,
    controls: ctx.controls,
    getMode: ctx.getMode,
    getStore: ctx.getStore,
    onStart: () => {
      const chain = ikController.chainFor((ctx.getUI()?.selectedJoint ?? -1) + 1);
      if (chain) ikController.beginDrag(chain);
    },
    onDrag: (worldPos) => ikController.solveTo(worldPos),
    onEnd: () => ikController.endDrag(),
  });

  // 并入本体守卫聚合:模式/标签切换拦截 isDragging、相机/拾取锁 isEngaged。
  ctx.registerGuard(ikHandle);

  // 极向量手柄:按下冻结参考、拖拽仅旋转弯折平面、松开把世界 pole 写入存储。
  const poleHandle = new PoleHandle({
    scene: ctx.scene.threeScene(),
    camera: ctx.camera,
    canvas: ctx.canvas,
    controls: ctx.controls,
    getStore: ctx.getStore,
    onStart: () => {
      const chain = ikController.chainFor((ctx.getUI()?.selectedJoint ?? -1) + 1);
      if (chain) ikController.beginPoleDrag(chain);
    },
    onDrag: (worldPos) => ikController.solveToPole(worldPos),
    onEnd: () => ikController.endPoleDrag(),
  });
  ctx.registerGuard(poleHandle);

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
    const sel = ui.selectedJoint;
    const ikChain = ikEnabled ? ikController.chainFor((sel ?? -1) + 1) : null;
    if (!ctx.isPlaying() && ui.mode === 'pose' && ikChain && ctx.getLastJoints()) {
      selection.bindChain(ikChain.name);            // 换链重置回 'end',同链保持
      ikHandle.attach(ctx.scene.jointWorldPosition(sel + 1));
      const stored = ikController.storedPole(ikChain.name);
      poleHandle.attach(stored ?? ikController.autoPoleViz(ikChain));
      // 单活动:按 selection 决定谁出箭头、谁作占位标识。attach 后再 setActive(setActive 为准)。
      const active = selection.active();
      ikHandle.setActive(active === 'end');
      poleHandle.setActive(active === 'pole');
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

  // 切换拾取:在画布上自挂一条轻量 pointerdown/up 监听,只 raycast 两个占位标识 mesh
  // (末端立方体 / 极向量球)。命中且未拖拽 → 按被点 mesh 的身份设 active 并重挂。
  // 不复用 JointPicker:占位 mesh 不是关节球,且活动柄存在时会落入 engage 闸。
  const canvas = ctx.canvas;
  const onPointerDown = (e) => { _down = { x: e.clientX, y: e.clientY, moved: false }; };
  const onPointerMove = (e) => {
    if (!_down || _down.moved) return;
    if (Math.hypot(e.clientX - _down.x, e.clientY - _down.y) > CLICK_THRESH) _down.moved = true;
  };
  const onPointerUp = (e) => {
    const down = _down; _down = null;
    if (!takeoverActive || !down || down.moved) return;           // 非接管态 / 拖拽 → 不切换
    if (ikHandle.isDragging() || poleHandle.isDragging()) return; // 正在拖箭头 → 不切换
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    _ray.setFromCamera(ndc, ctx.camera);
    const endMarker = ikHandle.markerMesh();
    const poleMarker = poleHandle.markerMesh();
    const hits = _ray.intersectObjects([endMarker, poleMarker], false);
    if (!hits.length) return;
    const obj = hits[0].object;
    if (obj === endMarker) selection.select('end');
    else if (obj === poleMarker) selection.select('pole');
    else return;
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
    ctx.jointGridButtons.forEach((b) => { b.disabled = false; b.classList.remove('ik'); });
  };
}
