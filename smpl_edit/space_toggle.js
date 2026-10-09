// smpl_edit/space_toggle.js
// 把「世界轴 / 自身轴」切换按钮填进页面里所有带 data-space-toggle 的容器,并与 GizmoSpace 双向同步。
// 各面板(整体/姿势)只需放一个空容器,按钮与高亮逻辑全在这里。
import { GIZMO_SPACES } from './gizmo_space.js';

export function mountSpaceToggles(gizmoSpace, root = document) {
  const buttons = [];
  root.querySelectorAll('[data-space-toggle]').forEach((host) => {
    for (const s of GIZMO_SPACES) {
      const b = document.createElement('button');
      b.textContent = s.label;
      b.title = s.tip;
      b.dataset.space = s.id;
      b.addEventListener('click', () => gizmoSpace.set(s.id));
      host.appendChild(b);
      buttons.push(b);
    }
  });
  const paint = () => buttons.forEach((b) => b.classList.toggle('on', b.dataset.space === gizmoSpace.get()));
  paint();
  return gizmoSpace.onChange(paint);
}
