#!/usr/bin/env bash
# 一键启动 SMPL Viewer 静态版.
# 用法:
#   bash smpl_viewer/run.sh    # 默认 8902, 127.0.0.1
#   bash run.sh 8765           # 自定义端口
#   bash run.sh 8902 0.0.0.0   # 自定义端口 + host
set -euo pipefail

PORT="${1:-8902}"
HOST="${2:-127.0.0.1}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"

cd "${REPO_ROOT}"
exec node smpl_web_viewer/tools/static_server.mjs \
  --root "${REPO_ROOT}" \
  --port "${PORT}" \
  --host "${HOST}"
