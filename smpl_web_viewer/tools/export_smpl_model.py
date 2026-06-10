import argparse
import importlib
import json
import pickle
import sys
import types
from pathlib import Path

import numpy as np


F32_BIN = "smpl_neutral.f32.bin"
I32_BIN = "smpl_neutral.i32.bin"
META_JSON = "smpl_neutral.meta.json"


class _CompatCscMatrix:
    def __setstate__(self, state):
        self.__dict__.update(state)

    def todense(self):
        data = np.asarray(self.data)
        indices = np.asarray(self.indices, dtype=np.intp)
        indptr = np.asarray(self.indptr, dtype=np.intp)
        dense = np.zeros(tuple(self._shape), dtype=data.dtype)

        for col in range(indptr.size - 1):
            start = int(indptr[col])
            end = int(indptr[col + 1])
            dense[indices[start:end], col] = data[start:end]

        return dense


class _CompatChumpyArray:
    def __setstate__(self, state):
        self.__dict__.update(state)

    @property
    def r(self):
        return self.x

    def __array__(self, dtype=None):
        return np.asarray(self.x, dtype=dtype)


def _can_import(module_name):
    try:
        importlib.import_module(module_name)
        return True
    except ModuleNotFoundError as exc:
        if exc.name == module_name or module_name.startswith(f"{exc.name}."):
            return False
        raise


def _ensure_module(module_name):
    module = sys.modules.get(module_name)
    if module is None:
        module = types.ModuleType(module_name)
        sys.modules[module_name] = module
    return module


def _install_pickle_compat_modules():
    if not _can_import("scipy.sparse.csc"):
        scipy = _ensure_module("scipy")
        sparse = _ensure_module("scipy.sparse")
        csc = types.ModuleType("scipy.sparse.csc")
        csc.csc_matrix = _CompatCscMatrix
        sys.modules["scipy.sparse.csc"] = csc
        scipy.sparse = sparse
        sparse.csc = csc

    if not _can_import("chumpy.ch"):
        chumpy = _ensure_module("chumpy")
        ch = types.ModuleType("chumpy.ch")
        ch.Ch = _CompatChumpyArray
        sys.modules["chumpy.ch"] = ch
        chumpy.ch = ch


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
    _install_pickle_compat_modules()
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
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--pkl",
        default="smpl_viewer/_data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl",
    )
    ap.add_argument("--out", default="smpl_web_viewer/public/models")
    args = ap.parse_args()

    try:
        write_asset(Path(args.out), load_smpl_pkl(args.pkl))
    except (
        OSError,
        KeyError,
        pickle.UnpicklingError,
        EOFError,
        AttributeError,
        ValueError,
        ModuleNotFoundError,
    ) as exc:
        ap.error(str(exc))


if __name__ == "__main__":
    main()
