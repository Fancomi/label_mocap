"""Tests for the current static smpl_viewer server entry.

The old Flask JSON/bin data API was removed. Keep this test dependency-free so
the static server contract can be verified with stdlib unittest.
"""

import os
import socket
import subprocess
import sys
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen


REPO_ROOT = Path(__file__).resolve().parent.parent


class StaticServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = _free_port()
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        cls.server = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "smpl_viewer.server",
                "--host",
                "127.0.0.1",
                "--port",
                str(cls.port),
                "--raw-root",
                "/path/that/is/ignored",
            ],
            cwd=REPO_ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        _wait_for_http(cls.port)

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        try:
            cls.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait(timeout=5)

    def test_root_serves_repository_index(self):
        response = _get(self.port, "/")

        self.assertEqual(response.status, 200)
        self.assertIn("text/html", response.headers.get("content-type", ""))
        self.assertIn(b"smpl_viewer/viewer.html", response.body)

    def test_viewer_asset_served_as_static_javascript(self):
        response = _get(self.port, "/smpl_viewer/viewer.js")

        self.assertEqual(response.status, 200)
        self.assertIn("javascript", response.headers.get("content-type", ""))
        self.assertIn(b"loadLocalA1SequenceFromFileList", response.body)

    def test_removed_data_api_is_not_exposed(self):
        with self.assertRaises(HTTPError) as cm:
            _get(self.port, "/seqs")

        self.assertEqual(cm.exception.code, 404)


class Response:
    def __init__(self, status, headers, body):
        self.status = status
        self.headers = headers
        self.body = body


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait_for_http(port):
    deadline = time.time() + 5
    while time.time() < deadline:
        if StaticServerTest.server.poll() is not None:
            stdout, stderr = StaticServerTest.server.communicate()
            raise RuntimeError(f"server exited early\nstdout={stdout}\nstderr={stderr}")
        try:
            _get(port, "/")
            return
        except OSError:
            time.sleep(0.05)
    raise TimeoutError("static server did not start")


def _get(port, path):
    with urlopen(f"http://127.0.0.1:{port}{path}", timeout=2) as response:
        return Response(response.status, response.headers, response.read())


if __name__ == "__main__":
    unittest.main()
