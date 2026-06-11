function uint8View(buffer) {
  if (buffer instanceof Uint8Array) {
    return buffer;
  }
  if (buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer);
  }
  if (ArrayBuffer.isView(buffer)) {
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  return new Uint8Array(buffer);
}

export function arrayFromBuffer(buffer, spec) {
  const view = uint8View(buffer);
  const elementBytes = 4;
  const offset = spec.offset;
  const length = spec.length;

  if (spec.dtype === 'float32') {
    validateSlice(view, offset, length, elementBytes);
    const bytes = sliceBytes(view, offset, length * elementBytes);
    return new Float32Array(bytes.buffer, bytes.byteOffset, length);
  }
  if (spec.dtype === 'int32') {
    validateSlice(view, offset, length, elementBytes);
    const bytes = sliceBytes(view, offset, length * elementBytes);
    return new Int32Array(bytes.buffer, bytes.byteOffset, length);
  }
  throw new Error(`unsupported model dtype: ${spec.dtype}`);
}

function sliceBytes(view, offset, byteLength) {
  return new Uint8Array(view.subarray(offset, offset + byteLength));
}

function validateSlice(view, offset, length, elementBytes) {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`model array offset must be a non-negative integer: ${offset}`);
  }
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`model array length must be a non-negative integer: ${length}`);
  }
  const byteLength = length * elementBytes;
  if (offset + byteLength > view.byteLength) {
    throw new Error(
      `model array slice is outside model asset view: offset ${offset}, byteLength ${byteLength}, view byteLength ${view.byteLength}`
    );
  }
}

function textFromBuffer(buffer) {
  if (typeof buffer === 'string') {
    return buffer;
  }
  return new TextDecoder().decode(uint8View(buffer));
}

export async function loadModelFromFiles(metaUrl, readBinary) {
  const meta = JSON.parse(textFromBuffer(await readBinary(metaUrl)));
  const binCache = new Map();
  const model = { meta };

  for (const [name, spec] of Object.entries(meta.arrays)) {
    if (!binCache.has(spec.bin)) {
      binCache.set(spec.bin, await readBinary(new URL(spec.bin, metaUrl)));
    }
    model[name] = arrayFromBuffer(binCache.get(spec.bin), spec);
    model[`${name}Shape`] = spec.shape;
  }

  return model;
}

export async function loadModel(baseUrl = './public/models/smpl_neutral.meta.json') {
  return loadModelFromFiles(new URL(baseUrl, globalThis.location.href), async (url) => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`failed to fetch ${url}: ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  });
}
