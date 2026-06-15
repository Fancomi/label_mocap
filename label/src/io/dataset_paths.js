// label/src/io/dataset_paths.js
// Pure classification of a picked PARENT directory's relative file paths.
// Output json is a sibling "<dataItemName>.json" in the parent, unless an
// existing compliant json is found (then save in place to it).
export const DATA_JSON_PATH = 'json_results/player_0/player_0.json';

const isJpeg = (p) => /\.(jpe?g)$/i.test(p);
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v'];
export function basename(p) { return String(p).split('/').pop(); }
function stripExt(name) { return name.replace(/\.[^.]+$/, ''); }
function topSegment(p) { const i = p.indexOf('/'); return i < 0 ? '' : p.slice(0, i); }

const videoRank = (p) => {
  const lower = p.toLowerCase();
  const i = VIDEO_EXT.findIndex((e) => lower.endsWith(e));
  return i < 0 ? Infinity : i;
};

// paths: relative file paths inside the picked parent P.
// opts.rootName: P's own directory name (FileSystemDirectoryHandle.name).
// opts.videoName: basename of a video the user picked explicitly (video flow).
export function classifyEntries(paths, opts = {}) {
  const jpgs = paths.filter(isJpeg);
  const imagePaths = [...jpgs].sort((a, b) => basename(a).localeCompare(basename(b), undefined, { numeric: true }));

  // best video already inside P
  let videoPath = null; let bestRank = Infinity;
  for (const p of paths) { const r = videoRank(p); if (r < bestRank) { bestRank = r; videoPath = p; } }

  // image container: the common top-level subfolder of the images, or '' if loose at root.
  let imageDir = null;
  if (jpgs.length) {
    const segs = new Set(jpgs.map(topSegment));
    imageDir = (segs.size === 1) ? [...segs][0] : ''; // single subfolder name, or '' (loose/mixed)
  }

  // dataItemName: video basename (override or in-dir) > image subfolder name > rootName.
  let dataItemName = null;
  if (opts.videoName) dataItemName = stripExt(basename(opts.videoName));
  else if (videoPath) dataItemName = stripExt(basename(videoPath));
  else if (imageDir) dataItemName = imageDir;             // non-empty subfolder name
  else if (jpgs.length && opts.rootName) dataItemName = opts.rootName; // loose images → parent name
  else if (opts.rootName) dataItemName = opts.rootName;

  // existing json (read): diving path, then any player_0.json, then sibling <dataItemName>.json
  const siblingJson = dataItemName ? `${dataItemName}.json` : null;
  let jsonPath = null;
  if (paths.includes(DATA_JSON_PATH)) jsonPath = DATA_JSON_PATH;
  else {
    const player = paths.find((p) => p.endsWith('player_0.json'));
    if (player) jsonPath = player;
    else if (siblingJson && paths.includes(siblingJson)) jsonPath = siblingJson;
  }

  const writeJsonPath = jsonPath ?? siblingJson ?? DATA_JSON_PATH;

  return { jsonPath, writeJsonPath, dataItemName, imageDir, imagePaths, videoPath };
}
