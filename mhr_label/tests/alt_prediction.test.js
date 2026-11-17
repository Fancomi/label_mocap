import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPredictionFiles, indexPrediction, predictionFields } from '../src/alt_prediction.js';

test('finds sam3d_<camera>_pred.json files only', () => {
  assert.deepEqual(findPredictionFiles(['json_results/player_0/player_0.json', 'json_results/sam3d_zcam2_pred.json', 'a.mp4']),
    [{ cameraId: 'zcam2', path: 'json_results/sam3d_zcam2_pred.json' }]);
});

test('predictionFields copies body keys of that frame, nothing else', () => {
  const idx = indexPrediction({ annotations: [{ image_id: 5, root_pos: [1, 2, 3], root_rota: [0, 0, 0], mhr_pose: [1], bbox: [1, 1, 1, 1], source: {} }] });
  const keys = ['root_pos', 'root_rota', 'mhr_pose'];
  const f = predictionFields(idx, 5, keys);
  assert.deepEqual(Object.keys(f), keys);
  f.root_pos[0] = 9;
  assert.equal(idx.get(5).root_pos[0], 1, 'returns copies');
  assert.equal(predictionFields(idx, 6, keys), null);
  assert.equal(predictionFields(idx, 5, [...keys, 'mhr_shape']), null);
});
