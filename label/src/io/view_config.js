// label/src/io/view_config.js — 由标注文档推出「怎么显示」的配置(纯逻辑)。
// 单视角旧数据(无 cameras):返回 null,沿用既有单相机路径(相机在原点、无旋转)。
// 多相机文档:主视角 = cameras[0];显示旋转、内参、视频文件、帧率、帧→解码序号都由数据给出,
// 标注员不需要也不能在页面上改 —— 下发数据时写好即可。
import { CameraRig } from '../../../smpl_edit/camera_rig.js';

export function viewConfigOf(raw, cameraId = null) {
  const rig = CameraRig.fromDoc(raw);
  if (!rig) return null;
  const id = cameraId ?? raw.cameras[0].id;
  const v = rig.view(id);
  const cam = v.raw;
  const images = raw.images ?? [];
  return {
    rig, cameraId: id,
    width: v.width, height: v.height, K: { ...v.K },
    pose: rig.camToWorld(id),
    rotationDeg: v.rotationDeg,
    calibrationAccepted: cam.calibration_accepted,
    video: cam.video ?? null,
    fps: Number.isFinite(cam.fps) && cam.fps > 0 ? cam.fps : null,
    // 帧位置 i → 该相机视频的解码序号;images[i].views[id] 缺省时 = i,null = 该相机本帧无画面。
    decodeIndex: (i) => {
      const views = images[i]?.views;
      if (!views || !(id in views)) return i;
      return views[id];
    },
    // 世界点 → 该相机原生像素(存储用);相机背后返回 null。
    projectNative: (X) => {
      const uv = rig.project(id, X);
      return uv ? rig.nativePixelFromView(id, uv) : null;
    },
  };
}
