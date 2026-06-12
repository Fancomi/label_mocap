"""Static server compatibility entry for SMPL Viewer.

The viewer now loads local data in the browser and runs SMPL forward in Web
workers. This module serves files only; it does not read datasets, run Python
SMPL, torch, cv2, or pickle.
"""

import argparse
import http.server
import socketserver
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO_ROOT), **kwargs)

    def do_GET(self):
        return super().do_GET()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8902)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--raw-root", default=None, help="ignored; data is selected in the browser")
    args = ap.parse_args()

    with socketserver.ThreadingTCPServer((args.host, args.port), Handler) as httpd:
        print(f"SMPL Viewer static server: http://{args.host}:{args.port}/")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
