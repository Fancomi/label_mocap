// pcd_label/src/io/manifest.js
// 解析导出端 manifest.json（lidar_pcap_export_pointcloud_frames.cpp 的 png-sequence）。
export function parseManifest(raw) {
  if (!raw || raw.format !== 'png-sequence') {
    throw new Error(`不支持的 manifest 格式: ${raw && raw.format}（应为 png-sequence）。该目录可能不是点云序列。`);
  }
  // 必填字段校验:缺任一即明确报错,避免后续静默黑屏或误报「点云解码失败」。
  const miss = [];
  if (!raw.frame_pattern) miss.push('frame_pattern');
  if (!(raw.frame_count > 0)) miss.push('frame_count');
  if (!(raw.point_width > 0)) miss.push('point_width');
  if (!(raw.point_height > 0)) miss.push('point_height');
  if (!(raw.scale > 0)) miss.push('scale');
  if (typeof raw.center !== 'number') miss.push('center');
  if (miss.length) throw new Error(`manifest.json 缺少必需字段: ${miss.join(', ')}`);
  return {
    framePattern: raw.frame_pattern,
    frameCount: raw.frame_count,
    fps: raw.fps ?? 10,
    pointWidth: raw.point_width,
    pointHeight: raw.point_height,
    scale: raw.scale,
    center: raw.center,
    // 背景 loop 目录（lidar_extract_background 的产出）靠这两个字段自我声明。
    kind: raw.kind ?? 'full',   // 'foreground' | 'background' | 'full'
    loop: !!raw.loop,
  };
}

export function frameFileName(pattern, index) {
  return pattern.replace(/%0(\d+)d/, (_, w) => String(index).padStart(Number(w), '0'));
}
