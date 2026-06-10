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

function textFromBuffer(buffer) {
  return new TextDecoder().decode(uint8View(buffer));
}

function validateMeta(meta) {
  if (meta?.schema !== 'smpl-web-debug-reference-mesh-v1') {
    throw new Error(`unsupported reference mesh schema: ${meta?.schema}`);
  }
  for (const key of ['bin', 'frameCount', 'vertexCount', 'itemSize']) {
    if (meta[key] === undefined) {
      throw new Error(`reference mesh meta missing ${key}`);
    }
  }
  if (meta.itemSize !== 3) {
    throw new Error(`reference mesh itemSize must be 3: ${meta.itemSize}`);
  }
}

export async function loadReferenceMesh(metaUrl, readBinary) {
  const meta = JSON.parse(textFromBuffer(await readBinary(metaUrl)));
  validateMeta(meta);

  const bin = uint8View(await readBinary(new URL(meta.bin, metaUrl)));
  const values = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  const frameStride = meta.vertexCount * meta.itemSize;
  if (values.length < meta.frameCount * frameStride) {
    throw new Error('reference mesh bin is shorter than meta declares');
  }

  return {
    meta,
    frames: meta.frames ?? [],
    vertexCount: meta.vertexCount,
    frameVertices(frameIndex) {
      if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= meta.frameCount) {
        throw new Error(`frame ${frameIndex} is outside reference mesh`);
      }
      const start = frameIndex * frameStride;
      return values.subarray(start, start + frameStride);
    },
  };
}

export async function loadReferenceMeshIfAvailable(baseUrl) {
  const metaUrl = new URL(baseUrl, globalThis.location.href);
  const readBinary = async (url) => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`failed to fetch ${url}: ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  };
  return loadReferenceMesh(metaUrl, readBinary);
}
