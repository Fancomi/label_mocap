"""用人体关键点给交付包里没有标定的相机估一份「诊断候选」标定(离线工具,不进运行时)。

做法:在交付包已有标定的两台相机(默认 orb1 + zcam2)上检测运动员 2D 关键点并三角化得到 3D,
再在目标相机(如 zcam1)上检测同一时刻的 2D 关键点,PnP(RANSAC + 帧级剔除)求外参。
输出与交付包 calibration/cameras.json 同格式,供 convert_sam3d_bundle.py --calibration 使用。

焦距:只靠一个人的关键点几乎不可观测(深度与焦距可互换)。若目标相机与某台已标定相机同机位
(光心相距远小于场景深度,如 zcam1 与 orb1),用 --colocated <该相机> 从两图背景的单应量焦距:
H = K1·R·K0⁻¹,取使 K1⁻¹·H·K0 最接近旋转阵的 f1。否则用 --fx 给定。

局限(结果里会写明,不要当作验收标定):
- 畸变假定为零;时钟假定与 --clock-from 相机相同(同型号同起点 PTS 的机位);
- 三角化依赖交付包里的候选标定,误差会传递过来。

需要:ultralytics(YOLO pose 权重,--weights)、opencv、numpy。
用法:
  python tools/mhr/estimate_camera_from_body.py --bundle <sam3d-body-173745> --videos <RING/20261102> \\
      --camera zcam1 --rotation 90 --fx 1100 --weights yolo11m-pose.pt --out zcam1_calibration.json
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

COCO2MHR70 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 62, 41, 9, 10, 11, 12, 13, 14]   # COCO17 → MHR70 关键点
ROT = {90: (cv2.ROTATE_90_CLOCKWISE, np.array([[0.0, -1, 0], [1, 0, 0], [0, 0, 1]])),
       -90: (cv2.ROTATE_90_COUNTERCLOCKWISE, np.array([[0.0, 1, 0], [-1, 0, 0], [0, 0, 1]]))}


def detect(model, video, step, rotations):
    """逐 step 帧检测所有人 → {decode_index: [(kp(17,2) 原生像素, conf(17))]}。
    rotations:检测时把画面转成哪些方向(倒立的运动员要在转 180° 的画面上才检得出)。"""
    out = {}
    cap = cv2.VideoCapture(str(video))
    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        if i % step == 0:
            h, w = f.shape[:2]
            for rot in rotations:
                r = model(cv2.rotate(f, ROT[rot][0]), verbose=False, conf=0.25)[0]
                if r.keypoints is None:
                    continue
                kp, cf = r.keypoints.xy.cpu().numpy(), r.keypoints.conf.cpu().numpy()
                kp = np.stack([kp[..., 1], h - 1 - kp[..., 0]], -1) if rot == 90 else np.stack([w - 1 - kp[..., 1], kp[..., 0]], -1)
                out.setdefault(i, []).extend(zip(kp, cf))
        i += 1
    return out


class KnownCam:
    def __init__(self, cid, cam, results):
        self.K = np.array(cam['K_native'])
        self.R = np.array(cam['R_native_from_common'])
        self.t = np.array(cam['t_native_from_common_m'])
        self.P = self.K @ np.c_[self.R, self.t]
        rnu = np.array(cam['upright']['R_native_camera_from_upright_camera'])
        with np.load(results, allow_pickle=False) as z:   # 该相机 MHR 预测的关键点(公共系),只用来认出运动员
            self.pred = {int(d): (k[COCO2MHR70] @ rnu.T - self.t) @ self.R
                         for d, k in zip(z['source_decode_index'], z['keypoints_camera_m'].astype(np.float64))}
        ref = cam['clock_map']
        self.clock = (ref['media_origin_s'], ref['rate'], ref['reference_origin_s'])

    def project(self, X):
        x = (self.P @ np.c_[X, np.ones(len(X))].T).T
        return x[:, :2] / x[:, 2:3]

    def frame_at(self, t_ref, fps):
        mo, rate, ro = self.clock
        return int(round(((t_ref - ro) * rate + mo) * fps))

    def athlete(self, dets, frame):
        """与该相机自己的 MHR 预测投影最近的检测。"""
        X = self.pred.get(frame)
        best = None
        for kp, cf in dets.get(frame, []) if X is not None else []:
            m = cf > 0.5
            if m.sum() < 8:
                continue
            e = np.median(np.linalg.norm(kp[m] - self.project(X)[m], axis=1))
            if e < 120 and (best is None or e < best[0]):
                best = (e, kp, cf)
        return best


def focal_from_colocated(video_known, fps_known, K_known, video_target, fps_target, size, times=(2, 10, 20, 30)):
    """同机位两相机:背景 SIFT 匹配 → 单应 → 扫 f1 使 K1⁻¹·H·K0 最接近旋转阵。返回 (f1 中位, 各次)。"""
    W, H = size
    grab = lambda v, i: (lambda c: (c.set(cv2.CAP_PROP_POS_FRAMES, i), cv2.cvtColor(c.read()[1], cv2.COLOR_BGR2GRAY))[1])(cv2.VideoCapture(str(v)))
    sift = cv2.SIFT_create(6000)
    out = []
    for t in times:
        a, b = grab(video_known, int(t * fps_known)), grab(video_target, int(t * fps_target))
        ka, da = sift.detectAndCompute(a, None)
        kb, db = sift.detectAndCompute(b, None)
        m = [x for x, y in cv2.BFMatcher().knnMatch(da, db, k=2) if x.distance < 0.75 * y.distance]
        Hm, _ = cv2.findHomography(np.float32([ka[x.queryIdx].pt for x in m]), np.float32([kb[x.trainIdx].pt for x in m]), cv2.RANSAC, 3.0)
        def ortho_err(f):
            R = np.linalg.inv(np.array([[f, 0, W / 2], [0, f, H / 2], [0, 0, 1]])) @ Hm @ K_known
            R /= np.cbrt(np.linalg.det(R))
            return np.linalg.norm(R.T @ R - np.eye(3))
        out.append(float(min(np.arange(400, 3000, 1.0), key=ortho_err)))
    return float(np.median(out)), out


def fit_pnp(O, I, F, K):
    def once(o, i):
        ok, rv, tv, inl = cv2.solvePnPRansac(o, i, K, None, reprojectionError=12, iterationsCount=20000,
                                             confidence=0.9999, flags=cv2.SOLVEPNP_EPNP)
        return cv2.solvePnPRefineLM(o[inl[:, 0]], i[inl[:, 0]], K, None, rv, tv)
    rv, tv = once(O, I)
    m = np.ones(len(O), bool)
    for _ in range(3):   # 帧级剔除:该帧中位误差 > 15px 视为选错人 / 左右反
        e = np.linalg.norm(cv2.projectPoints(O, rv, tv, K, None)[0][:, 0] - I, axis=1)
        good = [f for f in np.unique(F) if np.median(e[F == f]) < 15]
        m = np.isin(F, good) & (e < 25)
        rv, tv = once(O[m], I[m])
    e = np.linalg.norm(cv2.projectPoints(O[m], rv, tv, K, None)[0][:, 0] - I[m], axis=1)
    return rv, tv, {'frames_used': int(len(np.unique(F[m]))), 'frames_total': int(len(np.unique(F))),
                    'points': int(m.sum()), 'median_px': float(np.median(e)), 'p90_px': float(np.percentile(e, 90))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bundle', required=True, type=Path)
    ap.add_argument('--videos', required=True, type=Path)
    ap.add_argument('--camera', required=True, help='要估计的相机 id(视频 <source_id>_<camera>.mp4)')
    ap.add_argument('--rotation', type=int, required=True, choices=(90, -90), help='该相机画面转正的顺时针角度')
    ap.add_argument('--fx', type=float, help='焦距(像素);不给则需 --colocated 从画面测量')
    ap.add_argument('--colocated', help='与目标相机同机位的已标定相机 id(用背景单应测焦距)')
    ap.add_argument('--fps', type=float, default=60)
    ap.add_argument('--clock-from', default='zcam2', help='时钟沿用哪台相机的 clock_map(同型号同起点 PTS 的机位)')
    ap.add_argument('--known', default='orb1,zcam2', help='用于三角化的两台已标定相机')
    ap.add_argument('--weights', required=True, help='ultralytics pose 权重,如 yolo11m-pose.pt')
    ap.add_argument('--step', type=int, default=4)
    ap.add_argument('--out', required=True, type=Path)
    a = ap.parse_args()
    from ultralytics import YOLO
    model = YOLO(a.weights)
    cj = json.loads((a.bundle / 'calibration' / 'cameras.json').read_text(encoding='utf-8'))
    sid = cj['source_id']
    names = a.known.split(',')
    known = [KnownCam(c, cj['cameras'][c], a.bundle / 'results' / f'{c}.npz') for c in names]
    pts = {}
    for line in (a.bundle / 'frames.jsonl').read_text(encoding='utf-8').splitlines():
        f = json.loads(line)
        if f['camera_id'] in names and len(pts.setdefault(f['camera_id'], [])) < 2:
            pts[f['camera_id']].append(f['native_pts'])
    fps = {c: p[0]['time_base'][1] / p[0]['time_base'][0] / (p[1]['pts'] - p[0]['pts']) for c, p in pts.items()}
    vid = lambda c: a.videos / f'{sid}_{c}.mp4'
    print('检测关键点…')
    dets = {c: detect(model, vid(c), max(1, a.step // (2 if fps[c] < 50 else 1)), (90, -90)) for c in names}
    target = detect(model, vid(a.camera), a.step, (90, -90))
    W, H = cv2.VideoCapture(str(vid(a.camera))).read()[1].shape[1::-1]
    clock = cj['cameras'][a.clock_from]['clock_map']
    O, I, F = [], [], []
    for d, ds in sorted(target.items()):
        t_ref = (d / a.fps - clock['media_origin_s']) / clock['rate'] + clock['reference_origin_s']
        picks = [k.athlete(dets[c], k.frame_at(t_ref, fps[c])) for c, k in zip(names, known)]
        if not all(picks):
            continue
        m = (picks[0][2] > 0.5) & (picks[1][2] > 0.5)
        if m.sum() < 6:
            continue
        Xh = cv2.triangulatePoints(known[0].P, known[1].P, picks[0][1][m].T.astype(np.float64), picks[1][1][m].T.astype(np.float64))
        X = (Xh[:3] / Xh[3]).T
        e = np.maximum(*(np.linalg.norm(k.project(X) - p[1][m], axis=1) for k, p in zip(known, picks)))
        full = np.full((17, 3), np.nan)
        full[np.where(m)[0][e < 12]] = X[e < 12]
        # 目标相机里的运动员:先取最靠画面中央(原生 v 居中 = 转正后水平居中)者,选错的帧由 fit_pnp 帧级剔除
        best = None
        for kp, cf in ds:
            mm = (cf > 0.5) & ~np.isnan(full[:, 0])
            if mm.sum() < 6:
                continue
            s = abs(kp[mm, 1].mean() - H / 2)
            if best is None or s < best[0]:
                best = (s, kp, mm)
        if best:
            O.append(full[best[2]]); I.append(best[1][best[2]]); F.append(np.full(best[2].sum(), d))
    O, I, F = np.concatenate(O), np.concatenate(I).astype(np.float64), np.concatenate(F)
    fx_note = f'给定 {a.fx}'
    if a.fx is None:
        if not a.colocated:
            raise SystemExit('需要 --fx 或 --colocated')
        a.fx, runs = focal_from_colocated(vid(a.colocated), fps[a.colocated] if a.colocated in fps else 30,
                                          np.array(cj['cameras'][a.colocated]['K_native']), vid(a.camera), a.fps, (W, H))
        fx_note = f'与 {a.colocated} 同机位,背景单应测得 {a.fx:.0f}(各次 {[round(x) for x in runs]})'
        print('焦距', fx_note)
    K = np.array([[a.fx, 0, W / 2], [0, a.fx, H / 2], [0, 0, 1.0]])
    rv, tv, stats = fit_pnp(O, I, F, K)
    R = cv2.Rodrigues(rv)[0]
    rnu = ROT[a.rotation][1].T
    out = {'_说明': f'由 tools/mhr/estimate_camera_from_body.py 用人体关键点估计的诊断候选,未验收。'
                    f'焦距:{fx_note};畸变假定为零,时钟沿用 {a.clock_from}。',
           'cameras': {a.camera: {
               'native_image_size': [W, H], 'K_native': K.tolist(), 'd5_native': [0.0] * 5,
               'R_native_from_common': R.tolist(), 't_native_from_common_m': tv.ravel().tolist(),
               'upright': {'fixed_clockwise_rotation_deg': a.rotation, 'R_native_camera_from_upright_camera': rnu.tolist()},
               'clock_map': {**clock, 'status': f'assumed_same_as_{a.clock_from}'},
               'camera_calibration_accepted': False,
               'estimation': {'method': 'body_keypoint_pnp', 'triangulated_from': names, 'fx': a.fx, 'fx_source': fx_note, **stats,
                              'camera_centre_common_m': (-R.T @ tv.ravel()).round(4).tolist()}}}}
    a.out.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{a.out}: {stats}')


if __name__ == '__main__':
    main()
