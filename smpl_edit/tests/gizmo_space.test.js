import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GizmoSpace, normalizeSpace } from '../gizmo_space.js';
import { jointWorldQuat } from '../gizmo_frame.js';
import { quatToMat3 } from '../../smpl_core/rotations.js';

test('normalizeSpace: 非 local 一律回落 world', () => {
  assert.equal(normalizeSpace('local'), 'local');
  assert.equal(normalizeSpace('world'), 'world');
  assert.equal(normalizeSpace('bogus'), 'world');
  assert.equal(normalizeSpace(undefined), 'world');
});

test('GizmoSpace: 默认 world;set 仅在变化时通知全部订阅者', () => {
  const sp = new GizmoSpace();
  assert.equal(sp.get(), 'world');
  const a = [], b = [];
  sp.onChange((s) => a.push(s));
  const offB = sp.onChange((s) => b.push(s));
  sp.set('local');
  sp.set('local');
  offB();
  sp.set('world');
  assert.deepEqual(a, ['local', 'world']);
  assert.deepEqual(b, ['local']);
});

test('jointWorldQuat: 从扁平 worldRot 取第 j 个关节的四元数', () => {
  const q0 = [0, 0, 0, 1];
  const s = Math.SQRT1_2;
  const q1 = [0, 0, s, s]; // 绕 Z 90°
  const worldRot = [...quatToMat3(q0), ...quatToMat3(q1)];
  const got = jointWorldQuat(worldRot, 1);
  const d = Math.abs(got[0] * q1[0] + got[1] * q1[1] + got[2] * q1[2] + got[3] * q1[3]);
  assert.ok(Math.abs(d - 1) < 1e-6);
});
