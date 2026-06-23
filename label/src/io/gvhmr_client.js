// label/src/io/gvhmr_client.js
// 云端 GVHMR 推理客户端。纯逻辑(payload/解析/映射)与 fetch I/O 分离:
// 纯逻辑可 node --test 覆盖;inferGvhmr 走真实网络,浏览器验证。

export const DEFAULT_ENDPOINT = 'http://10.52.104.78:8666/gvhmr/infer';

// 链路1: 仅 image_b64(+file_name);链路2: 追加 bbox=[x,y,w,h]。
export function buildPayload({ imageB64, fileName, bbox }) {
  const p = { image_b64: imageB64 };
  if (fileName) p.file_name = fileName;
  if (Array.isArray(bbox) && bbox.length === 4) p.bbox = bbox.slice();
  return p;
}

// 校验并抽取 {ann, camK}。维度不符 / 缺 annotations 抛带说明的错误。
export function parseInferResponse(doc) {
  const anns = doc && doc.annotations;
  if (!Array.isArray(anns) || anns.length === 0) {
    throw new Error('云端返回无 annotations (no annotations)');
  }
  const ann = anns[0];
  if (!Array.isArray(ann.body_pose) || ann.body_pose.length !== 63) {
    throw new Error(`body_pose 维度异常: ${ann.body_pose && ann.body_pose.length}`);
  }
  if (!Array.isArray(ann.betas) || ann.betas.length !== 10) {
    throw new Error(`betas 维度异常: ${ann.betas && ann.betas.length}`);
  }
  const camK = doc.images && doc.images[0] ? doc.images[0].cam_K : null;
  return { ann, camK };
}

// 映射成 AnnotationStore.applyCloudResult 的字段对象(只取五个可编辑字段)。
export function cloudResultToFields(ann) {
  return {
    bbox: ann.bbox, root_pos: ann.root_pos, root_rota: ann.root_rota,
    body_pose: ann.body_pose, betas: ann.betas,
  };
}

// 网络 I/O(浏览器验证):POST JSON,AbortController 控超时/取消,错误归类为中文。
export async function inferGvhmr({ endpoint, imageB64, fileName, bbox, signal, timeoutMs = 60000 }) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  try {
    const resp = await fetch(endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload({ imageB64, fileName, bbox })),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      if (resp.status === 503) throw new Error('云端服务繁忙(503),请稍后重试');
      if (resp.status === 400) throw new Error('请求无效(400):图像或 bbox 不合法');
      throw new Error(`云端返回 HTTP ${resp.status}`);
    }
    return parseInferResponse(await resp.json());
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(timedOut ? '云端推理超时,请重试' : '已取消');
    if (e instanceof TypeError) throw new Error('无法连接云端,请检查地址与网络');
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
