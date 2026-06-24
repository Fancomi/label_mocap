// smpl_edit/viewport.js
// 单视口封装:一个相机 + 一套 OrbitControls + scissor 矩形 + 锁定/重置。
// 不持有 renderer/scene(由 ViewportManager 统一渲染)。browser-only。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { focusPlacement } from './framing.js';
import { cameraPlacement } from './view_frame.js';

// kind: 'perspective' | 'ortho'。dirAxis/upAxis: 标准朝向(R 重置用),'X'|'Y'|'Z'。
// camera/controls 可注入(主视复用既有 OrbitCam);否则自建。
export class Viewport {
  constructor({ name, kind, canvas, dirAxis, upAxis, camera = null, controls = null }) {
    this.name = name;
    this.kind = kind;
    this._dirAxis = dirAxis;
    this._upAxis = upAxis;
    this.locked = false;
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
  setOrientationAxes(dirAxis, upAxis) { this._dirAxis = dirAxis; this._upAxis = upAxis; }

  setLocked(v) { this.locked = !!v; this.controls.enabled = !v; }

  // 回标准朝向(沿 dirAxis 退开看向 center),并强制解锁。center/radius 缺省用上次值。
  resetOrientation(center, radius) {
    const c = center ?? this.controls.target.toArray();
    const r = (radius && radius > 0) ? radius : this._lastRadius;
    this._lastRadius = r;
    const place = cameraPlacement(this._upAxis, this._dirAxis, c, r);
    this.camera.up.set(place.up[0], place.up[1], place.up[2]);
    this.camera.position.set(place.position[0], place.position[1], place.position[2]);
    this.controls.target.set(c[0], c[1], c[2]);
    if (this.kind === 'ortho') this._fitOrtho(r);
    this.camera.lookAt(this.controls.target);
    this.setLocked(false); // 重置后无锁可微调
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

  // 在 renderer 上设 viewport+scissor 到像素矩形 {x,y,w,h}(GL 坐标,左下原点)。
  applyScissor(renderer, px) {
    renderer.setViewport(px.x, px.y, px.w, px.h);
    renderer.setScissor(px.x, px.y, px.w, px.h);
    renderer.setScissorTest(true);
  }

  update() { this.controls.update(); }
}
