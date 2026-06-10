import sys
from pathlib import Path
import pytest

DATA_ROOT = Path("/root/paddlejob/workspace/env_run/penghaotian/sport_project/dataset/diving/raw")
REPO_ROOT = Path(__file__).resolve().parent.parent

# Make this repo importable (for smpl_viewer)
sys.path.insert(0, str(REPO_ROOT))

PORTRAIT_SEQ = DATA_ROOT / "10m" / "TiaoShui_a_male_5500_597"
LANDSCAPE_SEQ = DATA_ROOT / "olympic" / "a_famale_70"


@pytest.fixture(scope="session")
def portrait_seq():
    if not PORTRAIT_SEQ.exists():
        pytest.skip(f"portrait fixture seq missing: {PORTRAIT_SEQ}")
    return PORTRAIT_SEQ


@pytest.fixture(scope="session")
def landscape_seq():
    if not LANDSCAPE_SEQ.exists():
        pytest.skip(f"landscape fixture seq missing: {LANDSCAPE_SEQ}")
    return LANDSCAPE_SEQ


@pytest.fixture(scope="session")
def smpl_and_faces():
    """Shared SMPL model + faces array. Module loads ~80MB; cache for the whole session."""
    import pickle
    import numpy as np
    from smpl_viewer.pysmpl import PySMPL
    smpl = PySMPL()
    pkl = REPO_ROOT / "smpl_viewer/_data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl"
    with open(pkl, "rb") as f:
        faces = np.array(pickle.load(f, encoding="latin1")["f"], dtype=np.int32)
    return smpl, faces
