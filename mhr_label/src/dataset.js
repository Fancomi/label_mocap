// mhr_label/src/dataset.js — MHR 数据集的目录约定与校验(纯逻辑)。
// 页面按人体模型划分:本页 = MHR(sam-3d-body),/label/ = SMPL;视角数(1 个或多个)由数据决定,两页都不以视角区分。
//
// 数据集目录(由 tools/mhr/convert_sam3d_bundle.py 生成,下发给标注员):
//   <dataset>/json_results/player_0/player_0.json   标注;info.body_model = 'mhr',其 cameras[] 决定有哪些视角、
//                                                    各用哪个视频、怎么转正(view_rotation_deg),标注员不需要在页面上选
//   <dataset>/<cameras[i].video>                    各视角原视频
//   <dataset>/json_results/sam3d_<cameraId>_pred.json  各视角的独立预测(可选,供逐帧「采用」)
import { bodyModelNameOf } from '../../smpl_core/body_model.js';

export const ANNOTATION_PATH = 'json_results/player_0/player_0.json';

// 返回 null = 可打开;否则返回给标注员看的错误说明。
export function checkMhrDoc(raw, paths) {
  if (!raw || !Array.isArray(raw.images)) return `缺少标注文件 ${ANNOTATION_PATH}(或不是 COCO 格式)。请选择数据集根目录。`;
  const model = bodyModelNameOf(raw);
  if (model !== 'mhr') return `这是 ${model.toUpperCase()} 数据,请用「SMPL 标注器」(/label/)打开。`;
  const cams = raw.cameras;
  if (!Array.isArray(cams) || cams.length < 1) return '标注缺少 cameras[](每个视角的视频、内外参、转正配置)。请用离线转换工具重新生成数据集。';
  const ids = new Set();
  for (const c of cams) {
    if (!c.id || ids.has(c.id)) return `cameras[] 的 id 缺失或重复: ${c.id}`;
    ids.add(c.id);
    if (!c.video) return `相机 ${c.id} 没有指定 video`;
    if (!paths.includes(c.video)) return `相机 ${c.id} 指定的视频不在目录里: ${c.video}`;
    for (const k of ['cam_K', 'R', 't', 'width', 'height']) if (c[k] == null) return `相机 ${c.id} 缺少 ${k}`;
  }
  return null;
}
