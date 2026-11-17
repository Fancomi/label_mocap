"""把 MHR 官方 TorchScript(LOD1)导出成浏览器运行时资产(离线工具,不进运行时)。

格式与 SMPL 资产相同:<name>.meta.json + <name>.f32.bin + <name>.i32.bin,
由 smpl_core/smpl_model.js#loadModelFromFiles 直接加载。

只导出数据管线实际用到的部分:不含姿态修正(交付数据是关闭修正生成的)、不含表情。
用法:
  python tools/mhr/export_mhr_web_model.py --model <assets>/mhr_model.pt \
      --license <assets>/LICENSE.txt --out smpl_web_viewer/public/models
"""
import argparse
import json
import shutil
from pathlib import Path

import numpy as np

from mhr_reference import load

NAME = 'mhr_lod1'
N_MODEL_PARAMS = 204


def add_array(meta, f32, i32, name, array):
    arr = np.asarray(array)
    if arr.dtype.kind == 'f':
        arr, buf, dtype = np.asarray(arr, dtype='<f4', order='C'), f32, 'float32'
    elif arr.dtype.kind in ('i', 'u'):
        arr, buf, dtype = np.asarray(arr, dtype='<i4', order='C'), i32, 'int32'
    else:
        raise TypeError(f'unsupported dtype for {name}: {arr.dtype}')
    meta['arrays'][name] = {
        'bin': f'{NAME}.{"f32" if dtype == "float32" else "i32"}.bin',
        'offset': len(buf), 'length': int(arr.size), 'shape': list(arr.shape), 'dtype': dtype,
    }
    buf.extend(arr.tobytes(order='C'))


def build_arrays(M):
    pt = M['parameter_transform'][:, :N_MODEL_PARAMS]   # 后 45 列是 identity 占位,前向恒乘 0
    rows, cols = np.nonzero(pt)
    return {
        'base_shape': M['base_shape'],
        'identity_vectors': M['identity_vectors'],      # (45, V, 3)
        'faces': M['faces'],
        'parents': M['parents'],
        'joint_offsets': M['offsets'],
        'joint_prerotations': M['prerotations'],
        'inverse_bind_pose': M['inverse_bind_pose'],
        'pt_row': rows, 'pt_col': cols, 'pt_val': pt[rows, cols],
        'skin_joint': M['skin_joint'], 'skin_vert': M['skin_vert'], 'skin_weight': M['skin_weight'],
        # rig 自带的参数范围(min/max,弧度);编辑器把它当关节限位用,见 smpl_core/mhr_pose.js#mhrParamRange。
        'limit_param': M['limit_param'], 'limit_min': M['limit_min'], 'limit_max': M['limit_max'],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True, help='MHR 官方 assets/mhr_model.pt')
    ap.add_argument('--license', required=True, help='MHR 官方 assets/LICENSE.txt')
    ap.add_argument('--out', required=True, type=Path)
    a = ap.parse_args()
    M = load(a.model)
    meta = {
        'schema': 'mhr-web-model-v1',
        'source': 'facebookresearch/MHR v1.0.1 assets/mhr_model.pt (LOD1)',
        'license': f'Apache-2.0, see {NAME}.LICENSE.txt',
        'units': 'cm, Y up (MHR model frame)',
        'pose_correctives': False, 'face_expressions': False,
        'joint_names': M['joint_names'],
        'parameter_names': M['parameter_names'][:N_MODEL_PARAMS],
        'arrays': {},
    }
    f32, i32 = bytearray(), bytearray()
    for name, arr in build_arrays(M).items():
        add_array(meta, f32, i32, name, arr)
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / f'{NAME}.meta.json').write_text(json.dumps(meta, indent=1), encoding='utf8')
    (a.out / f'{NAME}.f32.bin').write_bytes(f32)
    (a.out / f'{NAME}.i32.bin').write_bytes(i32)
    shutil.copyfile(a.license, a.out / f'{NAME}.LICENSE.txt')
    print(f'wrote {a.out}/{NAME}.* f32 {len(f32) / 1e6:.1f}MB i32 {len(i32) / 1e6:.1f}MB')


if __name__ == '__main__':
    main()
