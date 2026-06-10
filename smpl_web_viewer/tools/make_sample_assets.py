import argparse
import json
import shutil
from pathlib import Path

try:
    from convert_sequence import convert_records
except ImportError:
    from tools.convert_sequence import convert_records


def _load_records(path):
    return json.loads(path.read_text(encoding="utf8"))["records"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, type=Path)
    ap.add_argument("--out", default="smpl_web_viewer/public/samples/a_famale_224", type=Path)
    ap.add_argument("--copy-images", action="store_true")
    args = ap.parse_args()

    manifest = {"schema": "smpl-web-sample-manifest-v1", "sequences": []}
    args.out.mkdir(parents=True, exist_ok=True)

    try:
        for actor in ("a1", "a2", "a3", "a4"):
            pose_path = args.source / "a" / actor / "pose_files" / f"{actor}.json"
            image_dir = args.source / "a" / actor / "images"
            seq_dir = args.out / actor
            seq_dir.mkdir(parents=True, exist_ok=True)

            sequence = convert_records(
                f"a_famale_224/{actor}",
                _load_records(pose_path),
                f"./{actor}/images/",
            )
            (seq_dir / "sequence.json").write_text(
                json.dumps(sequence, indent=2),
                encoding="utf8",
            )

            if args.copy_images:
                dst = seq_dir / "images"
                if dst.exists():
                    shutil.rmtree(dst)
                shutil.copytree(image_dir, dst)

            manifest["sequences"].append({"name": actor, "url": f"./{actor}/sequence.json"})
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        ap.error(str(exc))

    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")


if __name__ == "__main__":
    main()
