// smpl_render/data_rotation.js
// 数据旋转纯代数(零 three) + 给 CameraModes 挂载旋转能力的 mixin。
// label 禁止数据旋转(_dataRotN 恒 0)；viewer 用 withDataRotation 获得该能力。

// 对 (K, W, H) 施加 N×顺时针(相机外向)旋转。图像像素 y-down，1×CW 把 (u,v)→(h−v,u)。
// 每步主点/焦距/尺寸交换：cx→h−cy, cy→cx, fx↔fy, w↔h。返回旋转后的 {fx,fy,cx,cy,w,h}。
export function rotateKn(K, W, H, n) {
  let fx = K.fx, fy = K.fy, cx = K.cx, cy = K.cy;
  let w = W, h = H;
  const steps = ((n % 4) + 4) % 4;
  for (let i = 0; i < steps; i++) {
    const ncx = h - cy, ncy = cx;
    [fx, fy] = [fy, fx];
    cx = ncx; cy = ncy;
    [w, h] = [h, w];
  }
  return { fx, fy, cx, cy, w, h };
}

// 把数据旋转能力挂到一个 CameraModes 实例上(mixin)。
// label 不调用 → _dataRotN 恒 0 → resetIntrinsics 退化为还原未旋转工厂 K。
export function withDataRotation(cam) {
  cam.setDataRotation = function (n) {
    const target = ((n % 4) + 4) % 4;
    const delta = ((target - this._dataRotN) % 4 + 4) % 4;
    if (delta !== 0) {
      // 对当前 live K 施加 delta 步(保留用户中途编辑)，再更新尺寸。
      const r = rotateKn(this.K, this.imageW, this.imageH, delta);
      this.K = { fx: r.fx, fy: r.fy, cx: r.cx, cy: r.cy };
      this.imageW = r.w; this.imageH = r.h;
    }
    this._dataRotN = target;
    this.setIntrinsics(this.K);   // 复用尾巴：刷新 fov/aspect/viewOffset/proj
  };
  cam.getDataRotation = function () { return this._dataRotN; };
  return cam;
}
