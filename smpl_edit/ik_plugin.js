// label/src/edit/ik_plugin.js
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

// 安装 IK 插件。返回 uninstall 函数(调用即彻底拆除,不留痕迹)。
export function installIK(ctx) {
  let ikEnabled = false;

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
      ikHandle.attach(ctx.scene.jointWorldPosition(sel + 1));
      return true; // 接管:本体不要再挂单关节旋转 gizmo
    }
    ikHandle.detach();
    return false;
  }
  ctx.registerSyncHook(syncHook);

  // 卸载:移除监听、隐藏按钮、detach 手柄、复位 joint-grid。彻底拆除不留痕迹。
  return function uninstallIK() {
    ctx.toggleButton.removeEventListener('click', onToggleClick);
    ctx.toggleButton.classList.remove('on');
    ctx.toggleButton.hidden = true;
    ikHandle.detach();
    ctx.jointGridButtons.forEach((b) => { b.disabled = false; b.classList.remove('ik'); });
  };
}
