// label/src/io/source_loader.js

// 内容校验:帧轴实际由 coco.imageIds()/store.frameCount() 驱动,这里只需确认
// 至少有背景或数据之一,否则视为空数据集报错。不再构造帧数组。
// background 为 null 或 { kind, count };dataFrameIndices 为有标注的帧位置列表。
// hint.hasManifest:目录含 manifest.json(很可能是点云序列被误喂给图像标注器)。
export function assertHasContent({ bgCount, dataFrameIndices, hint = {} }) {
  if (bgCount <= 0 && dataFrameIndices.length === 0) {
    if (hint.hasManifest) {
      throw new Error('该目录像是点云序列(含 manifest.json),请用 pcd 点云标注器打开;图像标注请选含 .jpg + player_0.json 的目录');
    }
    throw new Error('该目录无可标注内容:未找到图像(.jpg/.jpeg)或标注 JSON');
  }
}

// 竖拍 = 物理图像高大于宽 → 标注器仅查看。
export function isPortrait({ width, height }) {
  return height > width;
}
