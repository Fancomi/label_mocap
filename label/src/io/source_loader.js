// label/src/io/source_loader.js

// Build the unified frame list. `background` is null or { kind, count }.
// `dataFrameIndices` is the list of FRAME POSITIONS (indices into images[]) that have annotation data.
export function buildFrames({ background, dataFrameIndices }) {
  const bgCount = background ? background.count : 0;
  const maxDataId = dataFrameIndices.length ? Math.max(...dataFrameIndices) : -1;
  const total = Math.max(bgCount, maxDataId + 1);
  if (total <= 0) throw new Error('no content: neither background nor data provided');

  const dataSet = new Set(dataFrameIndices);
  const frames = [];
  for (let i = 0; i < total; i++) {
    frames.push({ index: i, hasBackground: i < bgCount, hasData: dataSet.has(i) });
  }
  return frames;
}

// Portrait = physical image taller than wide → labeler is view-only.
export function isPortrait({ width, height }) {
  return height > width;
}
