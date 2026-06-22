// pcd_label/src/io/manifest.js
// 解析导出端 manifest.json（lidar_pcap_export_pointcloud_frames.cpp 的 png-sequence）。
export function parseManifest(raw) {
  if (!raw || raw.format !== 'png-sequence') {
    throw new Error(`unsupported manifest format: ${raw && raw.format} (expected png-sequence)`);
  }
  return {
    framePattern: raw.frame_pattern,
    frameCount: raw.frame_count,
    fps: raw.fps ?? 10,
    pointWidth: raw.point_width,
    pointHeight: raw.point_height,
    scale: raw.scale,
    center: raw.center,
  };
}

export function frameFileName(pattern, index) {
  return pattern.replace(/%0(\d+)d/, (_, w) => String(index).padStart(Number(w), '0'));
}
