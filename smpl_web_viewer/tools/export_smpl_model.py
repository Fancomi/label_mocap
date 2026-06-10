import argparse
import json
import pickle
from pathlib import Path

import numpy as np


F32_BIN = "smpl_neutral.f32.bin"
I32_BIN = "smpl_neutral.i32.bin"
META_JSON = "smpl_neutral.meta.json"


def _dense(array):
    if hasattr(array, "todense"):
        return np.asarray(array.todense())
    return np.asarray(array)


def add_array(meta, f32, i32, name, array):
    arr = np.asarray(array)
    if arr.dtype.kind == "f":
        arr = np.asarray(arr, dtype="<f4", order="C")
        offset = len(f32)
        f32.extend(arr.tobytes(order="C"))
        dtype = "float32"
        bin_name = F32_BIN
    elif arr.dtype.kind in ("i", "u"):
        arr = np.asarray(arr, dtype="<i4", order="C")
        offset = len(i32)
        i32.extend(arr.tobytes(order="C"))
        dtype = "int32"
        bin_name = I32_BIN
    else:
        raise TypeError(f"unsupported dtype for {name}: {arr.dtype}")

    meta["arrays"][name] = {
        "bin": bin_name,
        "offset": offset,
        "length": int(arr.size),
        "shape": list(arr.shape),
        "dtype": dtype,
    }


def write_asset(out_dir, arrays):
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = {"schema": "smpl-web-model-v1", "arrays": {}}
    f32 = bytearray()
    i32 = bytearray()

    for name, arr in arrays.items():
        add_array(meta, f32, i32, name, arr)

    (out_dir / META_JSON).write_text(json.dumps(meta, indent=2), encoding="utf8")
    (out_dir / F32_BIN).write_bytes(f32)
    (out_dir / I32_BIN).write_bytes(i32)


def load_smpl_pkl(path):
    with Path(path).open("rb") as f:
        data = pickle.load(f, encoding="latin1")

    posedirs_raw = _dense(data["posedirs"])
    posedirs = np.reshape(posedirs_raw, (-1, posedirs_raw.shape[-1])).T

    parents = np.asarray(_dense(data["kintree_table"])[0], dtype=np.int32).copy()
    parents[0] = -1

    return {
        "v_template": _dense(data["v_template"]),
        "shapedirs": _dense(data["shapedirs"]),
        "posedirs": posedirs,
        "J_regressor": _dense(data["J_regressor"]),
        "weights": _dense(data["weights"]),
        "faces": _dense(data["f"]).astype(np.int32),
        "parents": parents[:24],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--pkl",
        default="smpl_viewer/_data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl",
    )
    parser.add_argument("--out", default="smpl_web_viewer/public/models")
    args = parser.parse_args()

    write_asset(Path(args.out), load_smpl_pkl(args.pkl))


if __name__ == "__main__":
    main()
