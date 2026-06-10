function requireFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function requireInteger(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}

function requirePositiveFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive number`);
  }
  return value;
}

function requireLen(value, n, name) {
  if (!Array.isArray(value) || value.length !== n) {
    throw new Error(`${name} must have length ${n}`);
  }
  return value.map((x, i) => requireFiniteNumber(x, `${name}[${i}]`));
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
    fps: data.fps === undefined ? 30 : requirePositiveFiniteNumber(data.fps, 'fps'),
    frames: data.frames.map((f) => ({
      frame: requireInteger(f.frame, 'frame'),
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

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`failed to parse sequence ${url}: ${err.message}`);
  }

  try {
    return normalizeSequence(data);
  } catch (err) {
    throw new Error(`invalid sequence ${url}: ${err.message}`);
  }
}
