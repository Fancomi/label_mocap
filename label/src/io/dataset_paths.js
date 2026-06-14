// label/src/io/dataset_paths.js
// Pure classification of a directory's relative file paths. Read path == write path.
export const DATA_JSON_PATH = 'json_results/player_0/player_0.json';

const isJpeg = (p) => /\.(jpe?g)$/i.test(p);
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v'];
const videoRank = (p) => {
  const lower = p.toLowerCase();
  const i = VIDEO_EXT.findIndex((e) => lower.endsWith(e));
  return i < 0 ? Infinity : i;
};

export function classifyEntries(paths) {
  const jsonPath = paths.includes(DATA_JSON_PATH) ? DATA_JSON_PATH
    : (paths.find((p) => p.endsWith('player_0.json')) ?? null);

  const imagePaths = paths.filter(isJpeg).sort((a, b) => a.localeCompare(b));

  let videoPath = null;
  let bestRank = Infinity;
  for (const p of paths) {
    const r = videoRank(p);
    if (r < bestRank) { bestRank = r; videoPath = p; }
  }

  return {
    jsonPath,
    writeJsonPath: jsonPath ?? DATA_JSON_PATH,
    imagePaths,
    videoPath,
  };
}
