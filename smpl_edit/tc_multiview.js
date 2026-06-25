// smpl_edit/tc_multiview.js
// TransformControls 多视口辅助:三个手柄类(pose_gizmo/root_handle/drag_handle)
// 共用的「换 active 相机 / 指针→NDC 重映射 / 屏幕尺寸缩放」三件套,收敛成一份,
// 改 vendored TransformControls 接口时只动这里。tc 为 TransformControls 实例。
export function setTcCamera(tc, camera) { if (tc && camera) tc.camera = camera; }

// 覆写 tc 的整块-canvas getPointer,改用 fn(event)→{x,y} 给出的 active 视口子矩形 NDC。
export function setTcNdcMapper(tc, fn) {
  if (!tc || !fn) return;
  tc._getPointer = (event) => { const p = fn(event); return { x: p.x, y: p.y, button: event.button }; };
}

// 手柄屏幕尺寸(label 2D setViewOffset 假缩放下,按 1/zoom 反向抵消)。
export function setTcSize(tc, s) { if (tc && s > 0) tc.setSize(s); }
