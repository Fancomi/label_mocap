// tools/verify_gvhmr_align.mjs
// 验证云端 GVHMR 结果在 2D 上是否与已标注 GT 对齐(以验证为目的,GT 仅用于比对,
// 绝不作为云端输入)。三方对比:
//   GT keypoints(已标注真值,2D)
//   CLOUD keypoints(云端自己回传的 2D)
//   OURS = forwardSmpl(云端 SMPL 参数) 用 云端 cam_K 投影出的 2D
// 若 OURS ≈ CLOUD,则我们的前向/投影管线正确,任何残差来自姿态估计本身;
// 若 OURS ≠ CLOUD,则我们的管线有 bug(坐标系/内参用法)。
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadModelFromFiles } from '../smpl_core/smpl_model.js';
import { forwardSmpl } from '../smpl_core/lbs.js';
import { projectPoint } from '../label/src/scene/projection.js';

const DATASET = '/Users/penghaotian/Downloads/20260609/datas';
const META = new URL('../smpl_web_viewer/public/models/smpl_neutral.meta.json', import.meta.url);
const ENDPOINT = 'http://10.52.104.78:8666/gvhmr/infer';

async function loadModel() {
  return loadModelFromFiles(META, async (url) => new Uint8Array(await readFile(url)));
}

async function callCloud(imgPath, bbox) {
  const buf = await readFile(imgPath);
  const payload = { image_b64: buf.toString('base64'), file_name: imgPath.split('/').pop() };
  if (bbox) payload.bbox = bbox;
  const resp = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function camKObj(camK) {
  if (Array.isArray(camK)) return { fx: camK[0], fy: camK[4], cx: camK[2], cy: camK[5] };
  return { fx: camK.fx, fy: camK.fy, cx: camK.cx, cy: camK.cy };
}

// 用我们的管线:forwardSmpl → 24 关节投影到 2D。
function oursReproject(model, ann, K) {
  const out = forwardSmpl(model, {
    root_pos: ann.root_pos, root_rota: ann.root_rota,
    body_pose: ann.body_pose, betas: ann.betas,
  });
  const j = out.joints;
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const z = j[i * 3 + 2];
    if (z >= 0) { pts.push(null); continue; }
    pts.push(projectPoint([j[i * 3], j[i * 3 + 1], z], K));
  }
  return pts;
}

function stats(label, a, b, n) {
  let sdx = 0, sdy = 0, cnt = 0, maxd = 0;
  for (let i = 0; i < n; i++) {
    if (!a[i] || !b[i]) continue;
    const dx = a[i][0] - b[i][0], dy = a[i][1] - b[i][1];
    sdx += dx; sdy += dy; cnt++;
    maxd = Math.max(maxd, Math.hypot(dx, dy));
  }
  console.log(`  ${label}: meanDx=${(sdx / cnt).toFixed(1)} meanDy=${(sdy / cnt).toFixed(1)} maxDist=${maxd.toFixed(1)} (n=${cnt})`);
}

async function main() {
  const model = await loadModel();
  const gt = JSON.parse(await readFile(`${DATASET}/images.json`, 'utf8'));
  const gtByImg = new Map(gt.annotations.map((a) => [a.image_id, a]));

  for (const idx of [0, 10, 25, 40]) {
    const im = gt.images[idx];
    const g = gtByImg.get(im.id);
    const doc = await callCloud(`${DATASET}/images/${im.file_name}`);
    const a = doc.annotations[0];
    const K = camKObj(doc.images[0].cam_K);

    const gKp = []; for (let k = 0; k < 24; k++) gKp.push([g.keypoints[k * 3], g.keypoints[k * 3 + 1]]);
    const cKp = []; for (let k = 0; k < 24; k++) cKp.push([a.keypoints[k * 3], a.keypoints[k * 3 + 1]]);
    const oKp = oursReproject(model, a, K);

    console.log(`\n=== frame ${idx} (${im.file_name}) cam_K fx=${K.fx.toFixed(1)} cx=${K.cx} cy=${K.cy} ===`);
    stats('OURS  vs CLOUD', oKp, cKp, 24);   // 管线正确性:应≈0
    stats('CLOUD vs GT   ', cKp, gKp, 24);   // 姿态估计质量
    stats('OURS  vs GT   ', oKp, gKp, 24);   // 端到端
    console.log('  pelvis OURS:', oKp[0] && oKp[0].map((v) => Math.round(v)),
      'CLOUD:', [Math.round(cKp[0][0]), Math.round(cKp[0][1])],
      'GT:', [Math.round(gKp[0][0]), Math.round(gKp[0][1])]);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
