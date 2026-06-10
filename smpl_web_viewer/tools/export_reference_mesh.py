import argparse
import json
from pathlib import Path

import numpy as np

try:
    from .export_smpl_model import load_smpl_pkl
except ImportError:
    from export_smpl_model import load_smpl_pkl


META_JSON = "python_ref_mesh.meta.json"
F32_BIN = "python_ref_mesh.f32.bin"


def axis_angle_to_mat3(v):
    vec = np.asarray(v, dtype=np.float64)
    angle = np.linalg.norm(vec)
    if angle < 1e-8:
        return np.eye(3, dtype=np.float64)

    x, y, z = vec / angle
    c = np.cos(angle)
    s = np.sin(angle)
    t = 1.0 - c
    return np.array(
        [
            [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
            [t * y * x + s * z, t * y * y + c, t * y * z - s * x],
            [t * z * x - s * y, t * z * y + s * x, t * z * z + c],
        ],
        dtype=np.float64,
    )


def _pose_rotations(frame, joint_count):
    rotations = [axis_angle_to_mat3(frame["root_rota"])]
    body_pose = frame["body_pose"]
    for joint in range(1, joint_count):
        start = (joint - 1) * 3
        if start + 2 < len(body_pose):
            rotations.append(axis_angle_to_mat3(body_pose[start : start + 3]))
        else:
            rotations.append(np.eye(3, dtype=np.float64))
    return np.asarray(rotations, dtype=np.float64)


def _blend_shape(model, betas):
    betas = np.asarray(betas, dtype=np.float64)
    v_template = np.asarray(model["v_template"], dtype=np.float64)
    shapedirs = np.asarray(model["shapedirs"], dtype=np.float64)
    return v_template + np.einsum("b,vcb->vc", betas[: shapedirs.shape[2]], shapedirs)


def _pose_offsets(model, rotations):
    identity = np.eye(3, dtype=np.float64)
    pose_feature = (rotations[1:] - identity).reshape(-1)
    posedirs = np.asarray(model["posedirs"], dtype=np.float64)
    out = np.zeros(posedirs.shape[1], dtype=np.float64)
    rows = min(pose_feature.shape[0], posedirs.shape[0])
    if rows:
        out += np.einsum("p,pv->v", pose_feature[:rows], posedirs[:rows])
    return out.reshape(-1, 3)


def _transform_mat(rotation, translation):
    out = np.eye(4, dtype=np.float64)
    out[:3, :3] = rotation
    out[:3, 3] = translation
    return out


def _rigid_transform(rotations, joints, parents):
    transforms = []
    for joint, rotation in enumerate(rotations):
        parent = int(parents[joint])
        rel_joint = joints[joint] - (joints[parent] if parent >= 0 else 0.0)
        local = _transform_mat(rotation, rel_joint)
        transforms.append(transforms[parent] @ local if parent >= 0 else local)

    transforms = np.asarray(transforms, dtype=np.float64)
    posed_joints = transforms[:, :3, 3].copy()

    rel_transforms = transforms.copy()
    for joint in range(len(joints)):
        transformed_rest = transforms[joint] @ np.array([*joints[joint], 0.0], dtype=np.float64)
        rel_transforms[joint, :3, 3] -= transformed_rest[:3]

    return posed_joints, rel_transforms


def forward_smpl_numpy(model, frame):
    v_shaped = _blend_shape(model, frame["betas"])
    joints = np.einsum("jv,vc->jc", np.asarray(model["J_regressor"], dtype=np.float64), v_shaped)
    rotations = _pose_rotations(frame, len(joints))
    v_posed = v_shaped + _pose_offsets(model, rotations)
    posed_joints, rel_transforms = _rigid_transform(
        rotations,
        joints,
        np.asarray(model["parents"], dtype=np.int32)[: len(joints)],
    )

    weights = np.asarray(model["weights"], dtype=np.float64)
    vertices_h = np.concatenate([v_posed, np.ones((v_posed.shape[0], 1), dtype=np.float64)], axis=1)
    transforms = np.einsum("vj,jab->vab", weights[:, : len(joints)], rel_transforms)
    vertices = np.einsum("vab,vb->va", transforms, vertices_h)[:, :3]

    root_offset = posed_joints[0].copy()
    root_pos = np.asarray(frame["root_pos"], dtype=np.float64)
    return {
        "vertices": (vertices - root_offset + root_pos).astype(np.float32),
        "joints": (posed_joints - root_offset + root_pos).astype(np.float32),
    }


def export_reference_mesh(model, frames, out_dir):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    vertices = [forward_smpl_numpy(model, frame)["vertices"] for frame in frames]
    if not vertices:
        raise ValueError("frames must not be empty")

    stacked = np.asarray(vertices, dtype="<f4")
    if not np.isfinite(stacked).all():
        raise ValueError("reference mesh contains non-finite vertex values")
    meta = {
        "schema": "smpl-web-debug-reference-mesh-v1",
        "bin": F32_BIN,
        "frameCount": int(stacked.shape[0]),
        "vertexCount": int(stacked.shape[1]),
        "itemSize": 3,
        "frames": [int(frame["frame"]) for frame in frames],
    }

    (out_dir / META_JSON).write_text(json.dumps(meta, indent=2), encoding="utf8")
    (out_dir / F32_BIN).write_bytes(stacked.tobytes(order="C"))
    return meta


def _load_sequence(path):
    data = json.loads(Path(path).read_text(encoding="utf8"))
    if data.get("schema") != "smpl-web-sequence-v1":
        raise ValueError(f"unsupported sequence schema: {data.get('schema')}")
    return data["frames"]


def main():
    ap = argparse.ArgumentParser(description="Export debug reference SMPL mesh vertices.")
    ap.add_argument("--model-pkl", default="smpl_viewer/_data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl")
    ap.add_argument("--sequence", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    try:
        export_reference_mesh(load_smpl_pkl(args.model_pkl), _load_sequence(args.sequence), args.out)
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        ap.error(str(exc))


if __name__ == "__main__":
    main()
