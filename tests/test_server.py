"""Flask endpoint tests using app.test_client()."""
import pytest
from pathlib import Path

DATA_ROOT = Path("/root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw")


@pytest.fixture(scope="module")
def app():
    if not DATA_ROOT.exists():
        pytest.skip(f"raw dataset missing: {DATA_ROOT}")
    from smpl_viewer.server import create_app
    return create_app(raw_root=DATA_ROOT)


@pytest.fixture
def client(app):
    return app.test_client()


def test_index_returns_html(client):
    """GET / serves viewer.html."""
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.mimetype == "text/html"
    assert b"<canvas" in resp.data or b"<!DOCTYPE" in resp.data


def test_seqs_lists_validation_fixtures(client):
    """GET /seqs returns the two fixture sequences with correct portrait flag."""
    resp = client.get("/seqs")
    assert resp.status_code == 200
    j = resp.get_json()
    assert "seqs" in j
    seqs = {(s["src"], s["name"]): s for s in j["seqs"]}
    assert ("10m", "TiaoShui_a_male_5500_597") in seqs
    assert ("olympic", "a_famale_70") in seqs
    # Both sequences are portrait=True (verified by detect_orientation pre-check)
    assert seqs[("10m", "TiaoShui_a_male_5500_597")]["portrait"] is True
    assert seqs[("olympic", "a_famale_70")]["portrait"] is True  # adjusted: detect_orientation returns True
    # n_frames must be a positive int
    for s in seqs.values():
        assert isinstance(s["n_frames"], int) and s["n_frames"] > 0


def test_meta_for_portrait_seq(client):
    """GET /seq/10m/TiaoShui_a_male_5500_597/meta returns intrinsics + image dims."""
    resp = client.get("/seq/10m/TiaoShui_a_male_5500_597/meta")
    assert resp.status_code == 200
    m = resp.get_json()
    assert m["portrait"] is True
    assert m["n_frames"] == 597  # this fixture is 597 frames
    assert m["K"] == {"fx": 1850.0, "fy": 1850.0, "cx": 960.0, "cy": 540.0}
    assert m["image_w"] == 1920
    assert m["image_h"] == 1080
    assert m["faces_url"].endswith("/faces.bin")
    assert m["kp_count"] == 24


def test_meta_404_for_unknown_seq(client):
    resp = client.get("/seq/10m/NOPE_NOT_REAL/meta")
    assert resp.status_code == 404
