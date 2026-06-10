"""Self-contained SMPL forward wrapper for the viewer.

Vendored from rollout_lidar_mocap_badminton/dep/vis/vis_tools/pysmpl.py — kept
as a small wrapper around _smpl_lib.SMPL.SMPL_layer so the SMPL forward we
need (vertices + 24 joints) lives in this repo, not behind a sys.path hack.

This module exposes only PySMPL.forward(betas, pose, transl) — the rest of
the original (get_phi / get_globalR / get_leaf_rotvec / hybrik) is not used
by the viewer.
"""
import os

import numpy as np
import torch
import torch.nn as nn

from ._smpl_lib.SMPL import SMPL_layer


_THIS_DIR = os.path.dirname(__file__)


class PySMPL(nn.Module):
    def __init__(self):
        super().__init__()
        h36m_jregressor = np.load(os.path.join(_THIS_DIR, "_data/smpl/J_regressor_h36m.npy"))
        feet_jregressor = np.load(os.path.join(_THIS_DIR, "_data/smpl/J_regressor_feet.npy"))
        wham_jregressor = np.load(os.path.join(_THIS_DIR, "_data/smpl/J_regressor_wham.npy"))
        self.smpl_dtype = torch.float32
        self.num_joints = 24
        self.smpl = SMPL_layer(
            os.path.join(_THIS_DIR, "_data/smpl/basicModel_neutral_lbs_10_207_0_v1.0.0.pkl"),
            h36m_jregressor=h36m_jregressor,
            feet_jregressor=feet_jregressor,
            wham_jregressor=wham_jregressor,
            dtype=self.smpl_dtype,
            num_joints=self.num_joints,
        )
        self.faces = self.smpl.faces
        self.eval()

    def forward(self, _betas, _pose, _transl=None):
        betas = _betas.view(-1, 10)
        pose = _pose.view(-1, 24, 3)
        transl = _transl.view(-1, 3) if _transl is not None else None
        global_pose = pose[..., :1, :]
        local_pose = pose[..., 1:, :]
        return self.smpl(local_pose, betas, global_pose, transl)
