"""生成 JS MHR 前向的单元测试样例(离线工具)。

真值来自 MHR 官方 TorchScript:关闭姿态修正、表情为零 —— 与交付数据的生产设置一致。
参数是固定种子的合成数据,不含任何真实拍摄数据。
用法:
  python tools/mhr/make_mhr_fixture.py --model <assets>/mhr_model.pt \
      --out smpl_core/tests/fixtures/mhr_forward_cases.json
"""
import argparse
import json
import warnings
from pathlib import Path

import numpy as np

VERT_STRIDE = 97   # 只存部分顶点,控制样例文件大小


def cases(rng):
    zero = np.zeros(204)
    posed = np.zeros(204)
    posed[3:136] = rng.normal(0, 0.3, 133)
    posed[136:] = rng.normal(0, 0.1, 68)
    moved = posed.copy()
    moved[0:3] = rng.normal(0, 5, 3)
    moved[3:6] = [2.5, -1.2, 0.7]
    return [('rest', np.zeros(45), zero),
            ('posed_scaled_shaped', rng.normal(0, 1, 45), posed),
            ('root_moved', rng.normal(0, 1, 45), moved)]


def main():
    import torch
    warnings.filterwarnings('ignore')
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--out', required=True, type=Path)
    a = ap.parse_args()
    m = torch.jit.load(a.model, map_location='cpu')
    f = lambda x: torch.tensor(np.asarray(x)[None], dtype=torch.float32)
    out = []
    for name, identity, mp in cases(np.random.default_rng(20261116)):
        identity, mp = identity.astype(np.float32), mp.astype(np.float32)
        v, s = m(f(identity), f(mp), torch.zeros(1, 72), False)
        idx = np.arange(0, v.shape[1], VERT_STRIDE)
        r = lambda x: np.round(np.asarray(x, dtype=np.float64), 5).reshape(-1).tolist()
        out.append({'name': name, 'identity': r(identity), 'model_params': r(mp),
                    'joints_cm': r(s[0, :, :3].numpy()), 'vert_index': idx.tolist(),
                    'verts_cm': r(v[0].numpy()[idx])})
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps({'source': 'MHR v1.0.1 mhr_model.pt, correctives off, zero expression',
                                 'cases': out}), encoding='utf8')
    print(f'wrote {a.out} ({a.out.stat().st_size / 1e3:.0f} KB)')


if __name__ == '__main__':
    main()
