// smpl_edit/transform_picker.js
// 收紧 TransformControls 平移手柄的「不可见命中体(picker)」,使命中范围贴合可见
// 几何(所见即所得)。vendored 版轴 picker 是 r=0.2 的锥(可见箭头 r≈0.04),会向
// 轴心鼓出、盖住 XY/YZ/XZ 平面方片,抢走对方片的点击。
//
// 实现要点(vendored r160 的 setupGizmo 行为):
//  - 每个 picker 子网格有独立几何,且位置/旋转已「烘入顶点」、object.scale 每帧被
//    统一重置 → 只能缩放几何顶点(geometry.scale,持久且不被每帧重置)。
//  - 轴锥烘焙后沿世界轴对齐、中心在该轴 ±0.3、半径在另两轴:只缩「垂直于轴」的两
//    维即可收细半径,而保持长度/位置不变(沿轴维 scale=1,中心在轴上不漂移;垂直
//    维中心为 0,缩放不漂移)。每轴的垂直维不同,故逐轴区分。
//  - 中心八面体在原点,均匀 0.5 收到可见尺寸(0.2→0.1)。
//  - 平面方片是用户要点的目标,保留不动(略大于可见但居中对齐,不影响点选)。
// 仅动 translate picker(rotate 手柄不受影响);结构缺失或已处理时安全跳过。
export function tightenTranslatePicker(tc) {
  if (!tc || !tc.userData || tc.userData._pickerTightened) return;
  const picker = tc._gizmo && tc._gizmo.picker && tc._gizmo.picker.translate;
  if (!picker) return;
  for (const m of picker.children) {
    const g = m.geometry;
    if (!g || typeof g.scale !== 'function') continue;
    // 轴锥:只收垂直于该轴的两维(把半径 0.2 收到约 0.05),长度/位置不变。
    if (m.name === 'X') g.scale(1, 0.25, 0.25);
    else if (m.name === 'Y') g.scale(0.25, 1, 0.25);
    else if (m.name === 'Z') g.scale(0.25, 0.25, 1);
    // 中心八面体:均匀收到可见尺寸。
    else if (m.name === 'XYZ') g.scale(0.5, 0.5, 0.5);
    // 平面方片(XY/YZ/XZ):保留,是点选目标。
  }
  tc.userData._pickerTightened = true;
}
