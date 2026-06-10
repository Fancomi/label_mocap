#!/usr/bin/env bash
# 一键启动 SMPL Viewer.
# 用法:
#   bash run.sh                # 默认 8901, 0.0.0.0
#   bash run.sh 8765           # 自定义端口
#   bash run.sh 8901 127.0.0.1 # 自定义端口 + host
set -euo pipefail

PORT="${1:-8901}"
HOST="${2:-0.0.0.0}"

VENV="/root/paddlejob/workspace/env_run/penghaotian/envs/lidar"
RAW_ROOT="/root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "${VENV}/bin/activate"

exec python3 "${HERE}/server.py" \
  --raw-root "${RAW_ROOT}" \
  --port "${PORT}" \
  --host "${HOST}"
