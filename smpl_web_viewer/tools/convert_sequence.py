import argparse
import json
from pathlib import Path


def image_name(pattern, frame):
    return pattern % frame


def _require_len(record, key, n):
    value = record.get(key)
    if not isinstance(value, list) or len(value) != n:
        frame = record.get("frame", "<unknown>")
        raise ValueError(f"record frame {frame}: {key} must be a list of length {n}")
    return [float(x) for x in value]


def convert_records(name, records, image_base_url, fps=30, width=1920, height=1080):
    frames = []
    for record in records:
        frames.append(
            {
                "frame": int(record["frame"]),
                "root_pos": _require_len(record, "root_pos", 3),
                "root_rota": _require_len(record, "root_rota", 3),
                "body_pose": _require_len(record, "body_pose", 63),
                "betas": _require_len(record, "betas", 10),
            }
        )

    return {
        "schema": "smpl-web-sequence-v1",
        "name": name,
        "fps": int(fps),
        "image": {
            "type": "image_sequence",
            "baseUrl": image_base_url,
            "pattern": "%04d.jpg",
            "width": int(width),
            "height": int(height),
        },
        "camera": {"fx": 1850, "fy": 1850, "cx": 960, "cy": 540},
        "frames": frames,
    }


def _load_records(path):
    data = json.loads(path.read_text(encoding="utf8"))
    if isinstance(data, dict):
        return data["records"]
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--name", required=True)
    ap.add_argument("--image-base-url", required=True)
    ap.add_argument("--output", required=True, type=Path)
    args = ap.parse_args()

    try:
        out = convert_records(args.name, _load_records(args.input), args.image_base_url)
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        ap.error(str(exc))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, indent=2), encoding="utf8")


if __name__ == "__main__":
    main()
