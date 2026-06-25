// smpl_edit/viewport.js
// 单视口封装:一个相机 + 一套 OrbitControls + scissor 矩形 + 锁定/重置。
// 不持有 renderer/scene(由 ViewportManager 统一渲染)。browser-only。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { focusPlacement, relativeBearing, placeFromBearing } from './framing.js';
import { cameraPlacement, axisVec } from './view_frame.js';

// kind: 'perspective' | 'ortho'。dirAxis/upAxis: 标准朝向(R 重置用),'X'|'Y'|'Z'。
// camera/controls 可注入(主视复用既有 OrbitCam);否则自建。
export class Viewport {
  constructor({ name, kind, canvas, dirAxis, upAxis, camera = null, controls = null }) {
    this.name = name;
    this.kind = kind;
    this._dirAxis = dirAxis;
    this._upAxis = upAxis;
    this._resetBearing = null; // null=用标准朝向;非空=用户锁定的相对方位
    if (camera) {
      this.camera = camera;
    } else if (kind === 'ortho') {
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 4000);
    } else {
      this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 4000);
    }
    if (controls) {
      this.controls = controls;
    } else {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
    }
    this._aspect = 1;
    this._lastRadius = 1;
  }

  // 设标准朝向轴(上轴/前轴变化时调用)。
  setResetAxes(dirAxis, upAxis) { this._dirAxis = dirAxis; this._upAxis = upAxis; }
  setOrientationAxes(d, u) { this.setResetAxes(d, u); } // 兼容旧调用名

  // 清掉用户锁定的相对方位 → R 回标准朝向。换坐标轴时调(旧 up 下记的 bearing 已不自洽)。
  clearResetBearing() { this._resetBearing = null; }

  // 锁定为重置视角:把当前相机相对人体中心的方位记为重置基准。center 缺省用当前 target。
  captureAsReset(center) {
    const c = center ?? this.controls.target.toArray();
    this._resetBearing = relativeBearing(this.camera.position.toArray(), c);
  }

  // R 重置:有记忆基准则按它(以当前 center/radius 还原);否则回标准正交朝向。
  // 始终设 camera.up = 当前上轴 → 坐标轴是重置的前提。
  resetOrientation(center, radius) {
    const c = center ?? this.controls.target.toArray();
    const r = (radius && radius > 0) ? radius : this._lastRadius;
    this._lastRadius = r;
    let pos, up;
    if (this._resetBearing) {
      pos = placeFromBearing(this._resetBearing, c).position;
      up = axisVec(this._upAxis); // 上轴为前提:记忆方位在当前上轴下解释
    } else {
      const place = cameraPlacement(this._upAxis, this._dirAxis, c, r);
      pos = place.position; up = place.up;
    }
    this.camera.up.set(up[0], up[1], up[2]);
    this.camera.position.set(pos[0], pos[1], pos[2]);
    this.controls.target.set(c[0], c[1], c[2]);
    if (this.kind === 'ortho') this._fitOrtho(r);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  // F 聚焦:保持朝向,target→center,距离随 radius。
  focus(center, radius) {
    if (!center) return;
    this._lastRadius = (radius && radius > 0) ? radius : this._lastRadius;
    const view = { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
    const out = focusPlacement(view, center, this._lastRadius);
    this.camera.position.set(out.position[0], out.position[1], out.position[2]);
    this.controls.target.set(out.target[0], out.target[1], out.target[2]);
    if (this.kind === 'ortho') this._fitOrtho(this._lastRadius);
    this.controls.update();
  }

  // 正交相机:按半径与当前像素宽高比设 frustum,使人体充满不变形。
  _fitOrtho(radius) {
    const m = radius * 1.2;
    const a = this._aspect || 1;
    this.camera.left = -m * a; this.camera.right = m * a;
    this.camera.top = m; this.camera.bottom = -m;
    this.camera.updateProjectionMatrix();
  }

  resize(aspect) {
    this._aspect = aspect;
    if (this.kind === 'ortho') this._fitOrtho(this._lastRadius);
    else { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
  }

  // 手动缩放(滚轮直接驱动,绕开 OrbitControls 的 enabled 博弈):
  // 透视沿(相机→target)方向推拉相机;正交改 camera.zoom。factor<1 拉近、>1 推远。
  dollyBy(factor) {
    if (this.kind === 'ortho') {
      this.camera.zoom = Math.max(1e-3, this.camera.zoom / factor); // factor<1 → zoom 变大 → 拉近
      this.camera.updateProjectionMatrix();
    } else {
      const t = this.controls.target;
      this.camera.position.set(
        t.x + (this.camera.position.x - t.x) * factor,
        t.y + (this.camera.position.y - t.y) * factor,
        t.z + (this.camera.position.z - t.z) * factor,
      );
    }
    this.controls.update();
  }

  // 在 renderer 上设 viewport+scissor 到像素矩形 {x,y,w,h}(GL 坐标,左下原点)。
  applyScissor(renderer, px) {
    renderer.setViewport(px.x, px.y, px.w, px.h);
    renderer.setScissor(px.x, px.y, px.w, px.h);
    renderer.setScissorTest(true);
  }

  update() { this.controls.update(); }
}
