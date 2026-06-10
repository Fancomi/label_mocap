function toFiniteNumber(value, name) {
  if (typeof value === 'boolean') {
    throw new Error(`${name} must be a finite number`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a finite number`);
  }
  return n;
}

function requireLen(value, n, name) {
  if (!Array.isArray(value) || value.length !== n) {
    throw new Error(`${name} must have length ${n}`);
  }
  return value.map((x, i) => toFiniteNumber(x, `${name}[${i}]`));
}

export function normalizeSequence(data) {
  if (!data || data.schema !== 'smpl-web-sequence-v1') {
    throw new Error(`unsupported schema: ${data?.schema}`);
  }
  if (!Array.isArray(data.frames)) {
    throw new Error('frames must be an array');
  }

  return {
    ...data,
    fps: toFiniteNumber(data.fps ?? 30, 'fps'),
    frames: data.frames.map((f) => ({
      frame: toFiniteNumber(f.frame, 'frame'),
      root_pos: requireLen(f.root_pos, 3, 'root_pos'),
      root_rota: requireLen(f.root_rota, 3, 'root_rota'),
      body_pose: requireLen(f.body_pose, 63, 'body_pose'),
      betas: requireLen(f.betas, 10, 'betas'),
    })),
  };
}

export async function loadSequence(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`failed to load sequence ${url}: ${res.status}`);
  }
  return normalizeSequence(await res.json());
}
