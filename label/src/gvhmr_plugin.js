// label/src/gvhmr_plugin.js
// 云端 GVHMR 推理的「一键插拔插件」。本体 app.js 只需调用 installGvhmr(ctx) 一行,
// 不出现任何 gvhmr / cloud 专有名字;装上/拆下都不影响本体编辑链路(对标 ik_plugin.js)。
//
// 插件自包含:自建独立 tab(标签 + 面板)、自建进度浮层 DOM、自注入所需 CSS、
// 自持 endpoint/AbortController(闭包局部,不污染本体作用域)。通过 ctx 扩展点接入:
//  - registerTab({mode,label,buildPanel}):注册一个互斥编辑 tab;
//  - registerGuard(g):把推理忙态并入本体拖拽/拾取守卫(推理时锁画布/标签);
//  - registerBusyGuard(fn):fn 返回 true 时本体禁用 Ctrl+Z 等编辑(推理期间冻结);
//  - registerSyncHook(fn):本体 syncUI 末尾调用,刷新按钮可用性/状态文案。
import { DEFAULT_ENDPOINT, inferGvhmr, cloudResultToFields } from './io/gvhmr_client.js';
import { fileToBase64, videoFrameToBase64 } from './io/image_bytes.js';

const STYLE_ID = 'gvhmr-plugin-style';
const CSS = `
#gvhmr-overlay { position:fixed; inset:0; z-index:100; background:rgba(0,0,0,.55);
  display:flex; align-items:center; justify-content:center; }
#gvhmr-overlay[hidden] { display:none; }
.gvhmr-box { background:#1b1f27; border:1px solid #3a4150; border-radius:8px;
  padding:22px 28px; display:flex; flex-direction:column; gap:14px; align-items:center; min-width:220px; }
#gvhmr-msg { color:#9ecbff; }
.gvhmr-spin { width:26px; height:26px; border:3px solid #3a4150; border-top-color:#3399ff;
  border-radius:50%; animation:gvhmr-spin .9s linear infinite; }
@keyframes gvhmr-spin { to { transform: rotate(360deg); } }`;

// 安装云端推理插件。返回 uninstall(调用即彻底拆除,不留痕迹)。
export function installGvhmr(ctx) {
  let abort = null;                 // 非 null = 有推理在飞
  const inferring = () => abort !== null;

  // ── 自注入 CSS(幂等) ──────────────────────────────────────────────────
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID; st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ── 进度浮层(插件自建,挂到 body) ───────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'gvhmr-overlay'; overlay.hidden = true;
  overlay.innerHTML =
    '<div class="gvhmr-box"><div id="gvhmr-msg">云端推理中…</div>' +
    '<div class="gvhmr-spin"></div><button id="gvhmr-cancel">取消</button></div>';
  document.body.appendChild(overlay);
  const msgEl = overlay.querySelector('#gvhmr-msg');
  const cancelBtn = overlay.querySelector('#gvhmr-cancel');
  const onCancel = () => { if (abort) abort.abort(); };
  cancelBtn.addEventListener('click', onCancel);
  function showOverlay(on, msg) { if (msg) msgEl.textContent = msg; overlay.hidden = !on; }

  // ── tab 面板(插件自建 DOM) ─────────────────────────────────────────────
  let epInput, plainBtn, bboxBtn, bboxInfo, panelEl;
  function buildPanel(panel) {
    panelEl = panel;
    panel.innerHTML =
      '<p class="hint">对当前帧调用云端 GVHMR:纯图由服务端自动检测人体;带框用当前帧的框。' +
      '结果直接覆盖本帧人体(无则新建),可 Ctrl+Z 撤销。</p>' +
      '<label style="font-size:11px;color:#9ab">云端地址</label>' +
      '<input type="text" id="gvhmr-endpoint" style="width:100%;box-sizing:border-box">' +
      '<div id="gvhmr-bbox-info" class="status">—</div>' +
      '<div class="row"><button id="btn-gvhmr-plain">☁ 纯图推理</button>' +
      '<button id="btn-gvhmr-bbox">☁ 带框推理</button></div>';
    epInput = panel.querySelector('#gvhmr-endpoint');
    plainBtn = panel.querySelector('#btn-gvhmr-plain');
    bboxBtn = panel.querySelector('#btn-gvhmr-bbox');
    bboxInfo = panel.querySelector('#gvhmr-bbox-info');

    const saved = (() => { try { return localStorage.getItem('gvhmr-endpoint'); } catch (_) { return null; } })();
    epInput.value = saved || DEFAULT_ENDPOINT;
    epInput.addEventListener('change', () => { try { localStorage.setItem('gvhmr-endpoint', epInput.value); } catch (_) {} });
    plainBtn.addEventListener('click', () => runGvhmr(false));
    bboxBtn.addEventListener('click', () => runGvhmr(true));
  }
  const tab = ctx.registerTab({ mode: 'cloud', label: '☁ 云端', buildPanel });

  // 当前帧图像 → base64(唯一来源:本体 images / videoSource,不另存副本)。
  async function currentFrameBase64() {
    const videoEl = ctx.getVideoEl();
    if (videoEl) return videoFrameToBase64(videoEl);
    const file = ctx.getCurrentImageFile();
    if (!file) throw new Error('当前帧没有可用图像');
    return fileToBase64(file);
  }

  // 记录云端实际使用的 cam_K 到当前帧 images[].cam_K(数据侧留痕,供保存的 json 用)。
  // 关键:**不**回写相机内参 —— 查看器内参是唯一权威且全视频固定(见 runGvhmr:我们
  // 主动把 cam.K 发给云端,云端据此出结果并回显同一 K)。若在此 setIntrinsics 会改变
  // fov→整个视野缩放(用户反馈的「点推理后视野尺寸变了」正是此前的 bug)。刻意不纳入 undo。
  function recordCamK(camK) {
    if (camK == null) return;
    const store = ctx.getStore();
    const info = store.document().imageInfo(store.currentImageId());
    if (info) info.cam_K = camK;
  }

  // withBbox=false → 链路1(纯图);true → 链路2(带当前帧 bbox)。
  async function runGvhmr(withBbox) {
    if (inferring()) return;                       // 已有推理在飞,忽略重复点击
    const store = ctx.getStore(); const ui = ctx.getUI();
    if (!store || ui?.readOnly) return;
    if (withBbox && !store.hasBbox()) { ctx.setStatus('当前帧无框,无法带框推理'); return; }
    const frameAtStart = store.currentFrame();     // 落地前校验仍在原帧
    const bbox = withBbox ? store.current()?.bbox : undefined;
    ctx.setPlaying(false);
    abort = new AbortController();
    ctx.requestSync();                             // 锁定 UI(忙态守卫生效)
    showOverlay(true, '云端推理中…');
    try {
      const imageB64 = await currentFrameBase64();
      // 把查看器当前内参一并发给云端:令云端在同一焦距下出结果,人体与背景图
      // 共用一套 K,不会大小错位(否则云端自估内参 fx≈2203 与查看器 fx=1850 不一致,
      // 人体投影会偏小一圈)。cam.K 是运行时镜像,反映用户面板里的实时内参。
      const k = ctx.getCam().K;
      const { ann, camK } = await inferGvhmr({
        endpoint: epInput?.value || DEFAULT_ENDPOINT,
        imageB64, fileName: ctx.getCurrentFileName(), bbox,
        camK: { fx: k.fx, fy: k.fy, cx: k.cx, cy: k.cy }, signal: abort.signal,
      });
      if (store.currentFrame() !== frameAtStart) { ctx.setStatus('已切帧,放弃本次结果'); return; }
      store.applyCloudResult(cloudResultToFields(ann));   // 一个 undo 单元:无人则新建,有人则覆盖
      recordCamK(camK);                                   // 仅记录到数据,不动相机视野
      await ctx.showFrame(frameAtStart);
      ctx.setStatus('云端推理完成');
    } catch (e) {
      ctx.setStatus(String(e.message || e));
    } finally {
      showOverlay(false);
      abort = null;
      ctx.requestSync();
    }
  }

  // 守卫:推理期间视为「拖拽中 + 占用中」,本体据此锁画布/标签切换。
  ctx.registerGuard({ isDragging: inferring, isEngaged: inferring });
  // 忙态守卫:推理期间本体禁用 Ctrl+Z 等编辑入口。
  ctx.registerBusyGuard(inferring);

  // syncUI 钩子:刷新「带框推理」可用性 + 当前框信息文案。返回 false(不接管姿势交互)。
  function syncHook() {
    const store = ctx.getStore(); const ui = ctx.getUI();
    if (bboxBtn) bboxBtn.disabled = inferring() || !(store && store.hasBbox() && !ui?.readOnly);
    if (plainBtn) plainBtn.disabled = inferring() || !store || !!ui?.readOnly;
    if (bboxInfo && store) {
      const b = store.hasBbox() ? store.current().bbox : null;
      bboxInfo.textContent = b
        ? `当前框: [${b.map((v) => Math.round(v)).join(', ')}]`
        : '当前帧无框 — 可在「框」标签新建';
    }
    return false;
  }
  ctx.registerSyncHook(syncHook);

  // 卸载:移除监听、移除浮层/CSS、移除 tab。彻底拆除不留痕迹。
  return function uninstallGvhmr() {
    cancelBtn.removeEventListener('click', onCancel);
    overlay.remove();
    document.getElementById(STYLE_ID)?.remove();
    tab?.remove?.();
  };
}
