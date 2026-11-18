import { createReadStream, statSync } from 'node:fs';
import { resolve, join, extname, relative, isAbsolute } from 'node:path';
import { createServer } from 'node:http';

const args = new Map(process.argv.slice(2).map((v, i, a) => v.startsWith('--') ? [v, a[i + 1]] : []));
const root = resolve(args.get('--root') ?? '.');
const port = Number(args.get('--port') ?? 5174);
const host = args.get('--host') ?? '127.0.0.1';
const indexFile = args.get('--index') ?? 'index.html';
const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.bin', 'application/octet-stream'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png']
]);

createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (pathname === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  const rel = pathname === '/' ? `/${indexFile}` : pathname;
  let file = resolve(join(root, rel));
  const rootRelativePath = relative(root, file);
  if (rootRelativePath.startsWith('..') || isAbsolute(rootRelativePath)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    let st = statSync(file);
    // Resolve a directory request (e.g. /label/) to its index file.
    if (st.isDirectory()) {
      file = resolve(join(file, indexFile));
      st = statSync(file);
    }
    if (!st.isFile()) throw new Error('not file');
    // 开发服务器:每次都回源取最新文件。ES 模块被浏览器启发式缓存时,改动后会出现「新模块 import 旧模块」
    // (例如 does not provide an export named …),强制刷新也不一定重新校验被 import 的子模块。
    res.writeHead(200, { 'content-type': types.get(extname(file)) ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, host, () => {
  console.log(`SMPL Web Viewer static server: http://${host}:${port}/`);
});
