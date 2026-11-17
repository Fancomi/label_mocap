"""sam-3d-body 交付包 → 多视角 MHR 标注数据集(离线工具,不进运行时)。

数据集由 /mhr_label/ 页面「打开数据集」直接加载。要标哪几个视角由 --cameras 决定,
写进 player_0.json 的 cameras[](顺序 = 分屏顺序,第一个 = 帧时间轴)。默认拒绝混用设备族
(orb 配 orb、zcam 配 zcam);每个视角用哪个视频、
怎么转正(view_rotation_deg)、帧怎么对应(images[].views)都在数据里,标注员页面上不用选。

每个视角需要标定(内外参 + 转正 + 时钟)。交付包 calibration/cameras.json 里没有的相机
(如 zcam1),用 --calibration 补一份同格式的 JSON(模板见 tools/mhr/extra_calibration.example.json)。
有 sam-3d-body 结果(results/<cam>.npz)的视角另写一份独立预测,供页面逐帧「采用」;
主标注每帧用 --cameras 中第一个有结果的视角初始化。

世界系 = 交付包公共系(orb1 原生光学系)的 GL 版(x 右、y 上、z 后,米),与视角选择无关。

用法:
  python tools/mhr/convert_sam3d_bundle.py --bundle <sam3d-body-173745> --videos <RING/20261102> \
      --dataset <输出目录> --cameras zcam1,zcam2 [--calibration zcam1_calibration.json]

输出:
  <dataset>/<source_id>_<cam>.mp4                    原视频硬链接(同盘不占空间,失败则复制)
  <dataset>/json_results/player_0/player_0.json      标注
  <dataset>/json_results/sam3d_<cam>_pred.json       各视角独立预测
"""
import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np

F = np.diag([1.0, -1.0, -1.0])
ROOT_REST_M = np.array([0.0, 0.924, 0.0])   # MHR 静止姿态 root(骨盆)关节位置;已对官方模型实测
CALIB_KEYS = ('native_image_size', 'K_native', 'R_native_from_common', 't_native_from_common_m', 'upright', 'clock_map')
DATA_JSON = Path('json_results') / 'player_0' / 'player_0.json'   # = mhr_label/src/dataset.js ANNOTATION_PATH


def euler_xyz_mat(e):
    x, y, z = e
    cx, sx, cy, sy, cz, sz = np.cos(x), np.sin(x), np.cos(y), np.sin(y), np.cos(z), np.sin(z)
    rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return rz @ ry @ rx


def mat_to_axis_angle(R):
    angle = np.arccos(np.clip((np.trace(R) - 1) / 2, -1.0, 1.0))
    if angle < 1e-9:
        return np.zeros(3)
    if np.pi - angle < 1e-6:   # 近 180°:取对称部分的主轴
        w, v = np.linalg.eigh((R + R.T) / 2)
        return v[:, np.argmax(w)] * angle
    axis = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]]) / (2 * np.sin(angle))
    return axis * angle


def upright_to_world(cam):
    """X_world = M·X_upright + m(列向量)。"""
    r_nc = np.asarray(cam['R_native_from_common'])
    t_nc = np.asarray(cam['t_native_from_common_m'])
    r_nu = np.asarray(cam['upright']['R_native_camera_from_upright_camera'])
    return F @ r_nc.T @ r_nu, -F @ r_nc.T @ t_nc


def fields_from_row(cam, mp, shape, cam_t):
    """数据包一行(该相机转正系) → 世界系 MHR 字段。"""
    M, m = upright_to_world(cam)
    A = M @ F   # MHR 模型系(Y 上) → 转正相机系(Y 下)的翻转,再进世界
    return {
        'root_pos': (A @ ROOT_REST_M + M @ cam_t + m).tolist(),
        'root_rota': mat_to_axis_angle(A @ euler_xyz_mat(mp[3:6])).tolist(),
        'mhr_pose': mp[6:136].tolist(),
        'mhr_scale': mp[136:204].tolist(),
        'mhr_shape': shape.tolist(),
    }


def camera_entry(cid, cam, video, fps):
    k = np.asarray(cam['K_native'])
    w, h = cam['native_image_size']
    return {
        'id': cid, 'width': w, 'height': h,
        'cam_K': {'fx': k[0, 0], 'fy': k[1, 1], 'cx': k[0, 2], 'cy': k[1, 2]},
        'R': np.asarray(cam['R_native_from_common']).reshape(-1).tolist(),
        't': list(cam['t_native_from_common_m']),
        'view_rotation_deg': cam['upright']['fixed_clockwise_rotation_deg'],
        'video': video, 'fps': fps,
        'calibration_accepted': bool(cam.get('camera_calibration_accepted', False)),
    }


def _round(x, nd=6):
    if isinstance(x, list):
        return [_round(v, nd) for v in x]
    if isinstance(x, dict):
        return {k: _round(v, nd) for k, v in x.items()}
    return round(float(x), nd) if isinstance(x, (float, np.floating)) else x


def probe_video(path):
    """(fps, 帧数),ffprobe。只用于交付包 frames.jsonl 里没有的相机。"""
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                          'stream=r_frame_rate,nb_frames', '-of', 'json', str(path)],
                         check=True, capture_output=True, text=True).stdout
    st = json.loads(out)['streams'][0]
    num, den = st['r_frame_rate'].split('/')
    return int(num) / int(den), int(st['nb_frames'])


def reference_times(cam, frames, cid, video):
    """该相机每个解码序号的参考时间(秒)与帧率。优先用交付包逐帧记录,否则按恒定帧率 + clock_map 推。"""
    rows = sorted((f for f in frames if f['camera_id'] == cid), key=lambda f: f['source_decode_index'])
    if rows:
        pts = [f['native_pts'] for f in rows[:2]]
        fps = pts[0]['time_base'][1] / pts[0]['time_base'][0] / (pts[1]['pts'] - pts[0]['pts'])
        return np.array([f['reference_time_s'] for f in rows]), fps
    fps, n = (cam['fps'], cam['frame_count']) if 'fps' in cam and 'frame_count' in cam else probe_video(video)
    cm = cam['clock_map']
    return (np.arange(n) / fps - cm['media_origin_s']) / cm['rate'] + cm['reference_origin_s'], fps


def pair(t_main, t_other, fps_other):
    """主时间轴每帧 → 另一相机最近的真实曝光;超出半帧(该相机覆盖范围外)为 None。"""
    j = np.clip(np.searchsorted(t_other, t_main), 1, len(t_other) - 1)
    j = np.where(np.abs(t_other[j - 1] - t_main) <= np.abs(t_other[j] - t_main), j - 1, j)
    ok = np.abs(t_other[j] - t_main) <= 0.5 / fps_other + 1e-9
    return [int(x) if k else None for x, k in zip(j, ok)]


def load_results(bundle, cid):
    path = bundle / 'results' / f'{cid}.npz'
    if not path.exists():
        return None
    with np.load(path, allow_pickle=False) as z:
        res = {k: z[k].astype(np.float64) for k in ('mhr_model_params', 'shape', 'pred_cam_t_m', 'keypoints_camera_m')}
        res['row_of'] = {int(d): r for r, d in enumerate(z['source_decode_index'])}
    return res


def rodrigues(w):
    a = np.linalg.norm(w)
    if a < 1e-12:
        return np.eye(3)
    k = w / a
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(a) * K + (1 - np.cos(a)) * K @ K


def project_entry(e, X):
    """世界(GL)点 → 该相机原生像素;相机后方为 nan。e = camera_entry(...)。"""
    x = (X @ F) @ np.asarray(e['R']).reshape(3, 3).T + np.asarray(e['t'])
    k = e['cam_K']
    with np.errstate(divide='ignore', invalid='ignore'):
        uv = np.stack([k['fx'] * x[:, 0] / x[:, 2] + k['cx'], k['fy'] * x[:, 1] / x[:, 2] + k['cy']], -1)
    uv[x[:, 2] <= 0] = np.nan
    return uv


def camera_centre(e):
    R = np.asarray(e['R']).reshape(3, 3)
    return F @ (-R.T @ np.asarray(e['t']))


MAX_FUSE_ROT = np.radians(30)
MAX_FUSE_SHIFT = 1.0   # m


def fuse_rigid(X0, root, targets, entries):
    """把一份人体整体刚体微调(绕骨盆转 + 平移,不改姿态/体型),使它在各视角的投影贴近该视角的 2D 依据。
    X0:人体关键点(世界);targets:{cameraId: (N,2) 像素};Huber 加权高斯-牛顿。返回 (R_d, t_d, 各视角中位残差) 或 None。"""
    def residual(p):
        X = (X0 - root) @ rodrigues(p[:3]).T + root + p[3:]
        return np.concatenate([(project_entry(entries[c], X) - T).ravel() for c, T in targets.items()])
    p = np.zeros(6)
    for _ in range(20):
        r = residual(p)
        ok = np.isfinite(r)
        if ok.sum() < 12:
            return None
        w = np.where(np.abs(r) < 15, 1.0, 15 / np.maximum(np.abs(r), 1e-9))[ok]
        J = np.stack([(residual(p + h) - r)[ok] / 1e-6 for h in np.eye(6) * 1e-6], 1)
        dp = np.linalg.solve((J * w[:, None]).T @ J + 1e-2 * np.eye(6), -(J * w[:, None]).T @ r[ok])
        p += dp
        if np.linalg.norm(dp) < 1e-7:
            break
    if np.linalg.norm(p[:3]) > MAX_FUSE_ROT or np.linalg.norm(p[3:]) > MAX_FUSE_SHIFT:
        return None
    X = (X0 - root) @ rodrigues(p[:3]).T + root + p[3:]
    err = {c: float(np.nanmedian(np.linalg.norm(project_entry(entries[c], X) - T, axis=1))) for c, T in targets.items()}
    return rodrigues(p[:3]), p[3:], err


def estimate_scene(calib, cid, results):
    """3D 视图用的「上方向 + 地面高度」(世界系)。公共系不是重力对齐的,这里从人体估:
    头−骨盆方向的主轴 ≈ 竖直(吊环上身体大多竖直),朝向与该相机转正后的「上」一致;
    地面 ≈ 全序列最低关节的 0.5 分位。只用于显示网格与 3D 取景,不影响标注数据。"""
    M, m = upright_to_world(calib[cid])
    up_cam = M @ np.array([0.0, -1, 0])
    with np.load(results, allow_pickle=False) as z:
        W = z['skel_camera_m'].astype(np.float64) @ M.T + m
    v = W[:, 113] - W[:, 1]                     # c_head − root
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    up = np.linalg.eigh(v.T @ v)[1][:, -1]
    up = up if up @ up_cam >= 0 else -up
    return {'up': _round(up.tolist()), 'ground_height_m': round(float(np.percentile((W @ up).min(1), 0.5)), 4),
            'estimated_from': f'{cid} body skeletons'}


def build_docs(bundle, videos, cameras=None, extra_calibration=None, init=None, fuse=True):
    """返回 (主标注文档, {cameraId: 独立预测文档})。
    init:初始化人体用哪些相机的 sam-3d-body 预测(按优先级)。可以不在 cameras 里 ——
    例如标 zcam1+zcam2 时用与 zcam1 同机位的 orb1 的正面预测。缺省 = cameras 中有结果的。
    fuse:多视角时把初始化人体整体刚体微调到「各视角都贴合」—— 每个视角的 2D 依据取光心离它最近的
    那台相机的预测在该视角的投影(单目预测在自己视角里最准)。只动 root_pos/root_rota,姿态体型不变。"""
    cams_json = json.loads((bundle / 'calibration' / 'cameras.json').read_text(encoding='utf-8'))
    calib = dict(cams_json['cameras'])
    calib.update(extra_calibration or {})
    cameras = cameras or list(cams_json['cameras'])
    for cid in cameras:
        missing = [k for k in CALIB_KEYS if k not in calib.get(cid, {})]
        if missing:
            raise ValueError(f'相机 {cid} 缺少标定 {missing}:交付包没有它,请用 --calibration 提供'
                             f'(模板 tools/mhr/extra_calibration.example.json)')
    frames = [json.loads(line) for line in (bundle / 'frames.jsonl').read_text(encoding='utf-8').splitlines() if line]
    state = {(f['camera_id'], f['source_decode_index']): f['effective_state'] for f in frames}
    sid = cams_json['source_id']
    init = init or [c for c in cameras if (bundle / 'results' / f'{c}.npz').exists()]
    srcs = list(dict.fromkeys(cameras + init))
    video = {cid: f'{sid}_{cid}.mp4' for cid in srcs}
    times = {cid: reference_times(calib[cid], frames, cid, Path(videos) / video[cid]) for cid in srcs}
    t_main, _ = times[cameras[0]]
    match = {cid: (list(range(len(t_main))) if cid == cameras[0] else pair(t_main, *times[cid])) for cid in srcs}
    results = {cid: load_results(bundle, cid) for cid in init}
    entries = [camera_entry(cid, calib[cid], video[cid], times[cid][1]) for cid in cameras]
    main_cam = entries[0]

    entry_of = {e['id']: e for e in entries}
    src_entry = {cid: entry_of.get(cid) or camera_entry(cid, calib[cid], video[cid], times[cid][1]) for cid in init}
    nearest = {v: sorted(init, key=lambda c: np.linalg.norm(camera_centre(src_entry[c]) - camera_centre(entry_of[v]))) for v in cameras}
    fuse_stats = []
    images, main_anns = [], []
    pred_anns = {cid: [] for cid in init if results[cid]}
    for i in range(len(t_main)):
        images.append({'id': i, 'width': main_cam['width'], 'height': main_cam['height'], 'cam_K': main_cam['cam_K'],
                       'views': {cid: match[cid][i] for cid in cameras}})
        chosen = None
        kp_world = {}
        for cid in init:
            res, decode = results[cid], match[cid][i]
            if not res or decode is None or decode not in res['row_of']:
                continue
            r = res['row_of'][decode]
            ann = {'iscrowd': 0, 'area': 0, 'category_id': 1, 'segmentation': [],
                   **_round(fields_from_row(calib[cid], res['mhr_model_params'][r], res['shape'][r], res['pred_cam_t_m'][r])),
                   'source': {'camera': cid, 'decode_index': decode, 'effective_state': state.get((cid, decode), 'external')}}
            pred_anns[cid].append({'id': len(pred_anns[cid]), 'image_id': i, **ann})
            M, m = upright_to_world(calib[cid])
            kp_world[cid] = res['keypoints_camera_m'][r] @ M.T + m
            chosen = chosen or ann
        if chosen and fuse and len(cameras) > 1:
            targets = {}
            for v in cameras:
                if match[v][i] is None:
                    continue
                src = next((c for c in nearest[v] if c in kp_world), None)
                if src:
                    targets[v] = project_entry(entry_of[v], kp_world[src])
            base = chosen['source']['camera']
            fit = fuse_rigid(kp_world[base], np.array(chosen['root_pos']), targets, entry_of) if len(targets) > 1 else None
            if fit:
                Rd, td, err = fit
                R0 = rodrigues(np.array(chosen['root_rota']))
                chosen = {**chosen, 'root_pos': _round((np.array(chosen['root_pos']) + td).tolist()),
                          'root_rota': _round(mat_to_axis_angle(Rd @ R0).tolist()),
                          'source': {**chosen['source'], 'fused_to': {c: round(e, 1) for c, e in err.items()}}}
                fuse_stats.append(list(err.values()))
        if chosen:
            main_anns.append({'id': len(main_anns), 'image_id': i, **chosen})
    info = {
        'body_model': 'mhr', 'body_model_version': 'mhr-1.0.1-lod1',
        'world_frame': 'bundle common frame (orb1 native optical) in GL axes (x right, y up, z back), metres',
        'scene': estimate_scene(calib, init[0], bundle / 'results' / f'{init[0]}.npz'),
        'source': {'bundle': bundle.name, 'source_id': sid, 'subject_id': cams_json.get('subject_id'),
                   'calibration_status': cams_json.get('status'), 'timeline_camera': cameras[0], 'init_from': init},
    }
    base = {'info': info, 'cameras': _round(entries, 12), 'images': images, 'categories': []}
    preds = {cid: {**base, 'info': {**info, 'prediction_of': cid}, 'annotations': a} for cid, a in pred_anns.items()}
    if fuse_stats:
        e = np.array(fuse_stats)
        print(f'融合 {len(e)} 帧,各视角中位残差 ' + ', '.join(f'{c} {np.median(e[:, k]):.1f}px' for k, c in enumerate(cameras)))
    return {**base, 'annotations': main_anns}, preds


def link_or_copy(src, dst):
    if dst.exists():
        if dst.stat().st_size == src.stat().st_size:
            return 'kept'
        raise FileExistsError(f'{dst} 已存在且与 {src} 大小不同,未覆盖')
    try:
        os.link(src, dst)
        return 'hardlink'
    except OSError:
        shutil.copy2(src, dst)
        return 'copy'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bundle', required=True, type=Path)
    ap.add_argument('--videos', required=True, type=Path, help='原始视频所在目录(含 <source_id>_<cam>.mp4)')
    ap.add_argument('--dataset', required=True, type=Path, help='输出数据集目录')
    ap.add_argument('--cameras', required=True, help='要标的视角,逗号分隔(如 zcam1,zcam2);顺序 = 分屏顺序,第一个为帧时间轴')
    ap.add_argument('--allow-mixed-devices', action='store_true', help='允许不同设备族混配(如 orb + zcam);默认拒绝')
    ap.add_argument('--init', help='初始化人体用哪些相机的预测,逗号分隔、按优先级(可不在 --cameras 里,'
                                   '如 zcam1 与 orb1 同机位时 --init orb1,zcam2)。缺省 = --cameras 中有结果的')
    ap.add_argument('--no-fuse', action='store_true', help='不做多视角刚体融合,直接用初始化预测')
    ap.add_argument('--calibration', type=Path, help='补充标定 JSON:{"cameras": {"<id>": {...同交付包格式...}}}')
    a = ap.parse_args()
    extra = json.loads(a.calibration.read_text(encoding='utf-8'))['cameras'] if a.calibration else None
    cams = a.cameras.split(',')
    families = {c.rstrip('0123456789') for c in cams}
    if len(families) > 1 and not a.allow_mixed_devices:
        raise SystemExit(f'--cameras {a.cameras} 混用了不同设备({"/".join(sorted(families))});'
                         f'多视角应同一设备族(orb 配 orb、zcam 配 zcam)。确需混配加 --allow-mixed-devices')
    main_doc, preds = build_docs(a.bundle, a.videos, cams, extra, a.init.split(',') if a.init else None, not a.no_fuse)
    outs = [(DATA_JSON, main_doc)] + [(Path('json_results') / f'sam3d_{cid}_pred.json', d) for cid, d in preds.items()]
    for _, doc in outs[:1]:
        p = a.dataset / DATA_JSON
        if p.exists():
            raise FileExistsError(f'{p} 已存在(可能含人工修正),未覆盖;请先手动移走')
    a.dataset.mkdir(parents=True, exist_ok=True)
    for cam in main_doc['cameras']:
        src = a.videos / cam['video']
        if not src.exists():
            raise FileNotFoundError(src)
        print(f'{cam["video"]}: {link_or_copy(src, a.dataset / cam["video"])}')
    for rel, doc in outs:
        out = a.dataset / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, ensure_ascii=False), encoding='utf8')
        print(f'{rel}: {len(doc["images"])} frames, {len(doc["annotations"])} poses')


if __name__ == '__main__':
    main()
