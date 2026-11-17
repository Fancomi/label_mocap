import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadModelFromFiles } from '../smpl_model.js';
import { forwardMhrModel, mhrRestShape, MHR_ROOT_JOINT } from '../mhr.js';

const model = await loadModelFromFiles(
  new URL('../../smpl_web_viewer/public/models/mhr_lod1.meta.json', import.meta.url),
  async (u) => new Uint8Array(await readFile(u)));
// 真值:MHR 官方 TorchScript(修正关闭、零表情),由 tools/mhr/make_mhr_fixture.py 生成。
const { cases } = JSON.parse(await readFile(new URL('./fixtures/mhr_forward_cases.json', import.meta.url), 'utf8'));

function maxAbsDiff(a, b) {
  let m = 0;
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

test('MHR web asset has LOD1 topology and 127-joint skeleton', () => {
  assert.equal(model.base_shapeShape[0], 18439);
  assert.equal(model.facesShape[0], 36874);
  assert.equal(model.parentsShape[0], 127);
  assert.equal(model.meta.joint_names[MHR_ROOT_JOINT], 'root');
  assert.equal(model.meta.parameter_names.length, 204);
});

for (const c of cases) {
  test(`forwardMhrModel matches official MHR: ${c.name}`, () => {
    const { vertices, skeleton } = forwardMhrModel(model, c.identity, c.model_params);
    assert.ok(maxAbsDiff(skeleton.t, c.joints_cm) < 1e-3, `joints err ${maxAbsDiff(skeleton.t, c.joints_cm)} cm`);
    const sampled = c.vert_index.flatMap((v) => [vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2]]);
    assert.ok(maxAbsDiff(sampled, c.verts_cm) < 2e-3, `verts err ${maxAbsDiff(sampled, c.verts_cm)} cm`);
  });
}

test('cached rest shape gives identical vertices', () => {
  const c = cases[1];
  const rest = mhrRestShape(model, c.identity);
  const a = forwardMhrModel(model, c.identity, c.model_params).vertices;
  const b = forwardMhrModel(model, null, c.model_params, { rest }).vertices;
  assert.equal(maxAbsDiff(a, b), 0);
});
