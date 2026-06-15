// label/src/io/source_loader.js

// 内容校验:帧轴实际由 coco.imageIds()/store.frameCount() 驱动,这里只需确认
// 至少有背景或数据之一,否则视为空数据集报错。不再构造帧数组。
// background 为 null 或 { kind, count };dataFrameIndices 为有标注的帧位置列表。
export function assertHasContent({ bgCount, dataFrameIndices }) {
  if (bgCount <= 0 && dataFrameIndices.length === 0) {
    throw new Error('no content: neither background nor data provided');
  }
}

// 竖拍 = 物理图像高大于宽 → 标注器仅查看。
export function isPortrait({ width, height }) {
  return height > width;
}
