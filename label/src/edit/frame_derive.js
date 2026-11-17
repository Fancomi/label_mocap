// label/src/edit/frame_derive.js — 单帧派生量(纯逻辑):由人体前向结果算 2D 关键点、遮挡、逐视角框(训练用标签)。
// 在该帧「定稿」时调用一次(AnnotationStore.onCommitted),结果随帧缓存在文档里;保存只序列化。
// 批量补算(整段视频)属于离线工具箱,不在页面里做。
import { reprojectKeypoints, bboxFromProjected, occlusionFromMesh } from './derived.js';

// out:BodyModel.forward 结果 { vertices, joints };
// views:多相机 = [{ cameraId, cfg }](cfg = view_config.js#viewConfigOf),第 0 个为文档主相机;
//        单视角 = [{ cameraId: null, project: K, camPos: [0,0,0] }]。
// pos:帧位置(查该相机本帧有无画面)。返回要写回该帧的字段。
export function deriveFrame(body, out, views, pos) {
  const per = (v) => {
    const project = v.cfg ? v.cfg.projectNative : v.project;
    const camPos = v.cfg ? v.cfg.pose.t : v.camPos;
    const d = {
      keypoints: reprojectKeypoints(out.joints, project, body.keypointSlots, body.keypointJoints),
      occlution_joint: occlusionFromMesh(out.joints, out.vertices, body.faces, camPos, body.keypointSlots, body.keypointJoints),
    };
    if (v.cfg) { const b = bboxFromProjected(out.vertices, project); if (b) d.bbox = b; }
    return d;
  };
  if (!views[0].cfg) return per(views[0]);   // 单视角:bbox 是人画的输入,不派生
  const per_view = {};
  for (const v of views) {
    if (v.cfg.decodeIndex(pos) == null) continue;   // 该相机本帧无画面
    per_view[v.cameraId] = per(v);
  }
  const main = per_view[views[0].cameraId];
  return main ? { per_view, ...main } : { per_view };
}
