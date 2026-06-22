// pcd_label/src/scene/colormap.js
// turbo colormap LUT（16条目，线性插值），输入 t∈[0,1]，输出 [r,g,b]∈[0,1]。
// 源数据来自 Google turbo_colormap_data（Apache-2.0）。
const T = [
  0.18995,0.07176,0.23217, 0.25107,0.25237,0.63374, 0.27628,0.42778,0.89609,
  0.24402,0.60461,0.95712, 0.16452,0.73286,0.90265, 0.07957,0.82905,0.77087,
  0.13953,0.88932,0.62285, 0.30918,0.93255,0.46260, 0.51729,0.94994,0.31223,
  0.70288,0.94545,0.18927, 0.82946,0.90073,0.09922, 0.91534,0.82590,0.04621,
  0.96851,0.72350,0.02099, 0.98952,0.59395,0.00896, 0.97688,0.45022,0.00553,
  0.47960,0.01583,0.01055,
];
export function turbo(t) {
  const x = Math.min(1, Math.max(0, t)) * 15;
  const i = Math.min(14, Math.floor(x));
  const f = x - i;
  const o = i * 3;
  return [T[o]+f*(T[o+3]-T[o]), T[o+1]+f*(T[o+4]-T[o+1]), T[o+2]+f*(T[o+5]-T[o+2])];
}

export function normalizeRange(v, lo, hi) {
  if (hi <= lo) return 0;
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}
