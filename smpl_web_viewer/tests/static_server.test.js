import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

const serverScript = fileURLToPath(new URL('../tools/static_server.mjs', import.meta.url));

test('rejects encoded traversal into same-prefix sibling directory', async () => {
  const base = await mkdtemp(join(tmpdir(), 'smpl-static-'));
  const root = join(base, 'root');
  const sibling = join(base, 'root-secret');
  await mkdir(root);
  await mkdir(sibling);
  await writeFile(join(root, 'index.html'), 'root', 'utf8');
  await writeFile(join(sibling, 'secret.txt'), 'secret', 'utf8');

  const server = await startStaticServer(root);
  try {
    const response = await httpGet(server.port, `/%2e%2e%2f${basename(sibling)}/secret.txt`);
    assert.equal(response.statusCode, 403);
    assert.notEqual(response.body, 'secret');
  } finally {
    await server.stop();
    await rm(base, { recursive: true, force: true });
  }
});

test('malformed percent encoding returns client error without stopping server', async () => {
  const base = await mkdtemp(join(tmpdir(), 'smpl-static-'));
  const root = join(base, 'root');
  await mkdir(root);
  await writeFile(join(root, 'index.html'), 'root', 'utf8');

  const server = await startStaticServer(root);
  try {
    const badResponse = await httpGet(server.port, '/%E0%A4%A');
    assert.ok([400, 404].includes(badResponse.statusCode));
    assert.equal(server.child.exitCode, null);

    const okResponse = await httpGet(server.port, '/index.html');
    assert.equal(okResponse.statusCode, 200);
    assert.equal(okResponse.body, 'root');
  } finally {
    await server.stop();
    await rm(base, { recursive: true, force: true });
  }
});

async function startStaticServer(root) {
  const port = await getFreePort();
  const child = spawn(process.execPath, [serverScript, '--root', root, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code, signal]) => {
      throw new Error(`server exited before ready: code=${code} signal=${signal}`);
    }),
    timeout(2000, 'server did not start')
  ]);

  return {
    child,
    port,
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await once(child, 'exit');
      }
    }
  };
}

async function getFreePort() {
  const server = createNetServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = get({ hostname: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body });
      });
    });
    req.on('error', reject);
  });
}

async function timeout(ms, message) {
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
  throw new Error(message);
}
