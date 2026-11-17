// 离线批量补算派生量(2D 关键点 / 遮挡 / 多相机逐视角框),与页面「帧定稿」时的单帧计算同一份代码
// (label/src/edit/frame_derive.js),结果逐位一致。页面不做整段批量,需要时用本工具。
// 用法:node tools/mhr/derive_dataset.mjs <player_N.json> [--out <path>](缺省原地覆盖)
import { readFile, writeFile } from 'node:fs/promises';
import { loadModelFromFiles } from '../../smpl_core/smpl_model.js';
import { BODY_ASSETS, createBody, bodyModelNameOf } from '../../smpl_core/body_model.js';
import { deriveFrame } from '../../label/src/edit/frame_derive.js';
import { viewConfigOf } from '../../label/src/io/view_config.js';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
if (!input) { console.error('用法: node tools/mhr/derive_dataset.mjs <player_N.json> [--out <path>]'); process.exit(2); }
const output = outIdx >= 0 ? args[outIdx + 1] : input;

const doc = JSON.parse(await readFile(input, 'utf8'));
if (!doc.cameras) { console.error('只支持带 cameras[] 的多相机文档;单视角 SMPL 的内参在页面里,不在文档里'); process.exit(2); }
const name = bodyModelNameOf(doc);
const models = new URL('../../smpl_web_viewer/public/models/', import.meta.url);
const body = createBody(name, await loadModelFromFiles(new URL(BODY_ASSETS[name], models), async (u) => new Uint8Array(await readFile(u))));
const views = doc.cameras.map((c) => ({ cameraId: c.id, cfg: viewConfigOf(doc, c.id) }));
const pos = new Map((doc.images ?? []).map((im, i) => [im.id, i]));
const t0 = performance.now();
let n = 0;
for (const a of doc.annotations ?? []) {
  if (!(body.presenceKey in a) || !pos.has(a.image_id)) continue;
  const f = {};
  for (const k of body.fieldKeys) f[k] = a[k];
  Object.assign(a, deriveFrame(body, body.forward(f), views, pos.get(a.image_id)));
  n++;
}
await writeFile(output, JSON.stringify(doc), 'utf8');
console.log(`${output}: ${n} 帧派生完成,${((performance.now() - t0) / 1000).toFixed(1)}s`);
