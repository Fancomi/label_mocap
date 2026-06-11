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
  const rel = pathname === '/' ? `/${indexFile}` : pathname;
  const file = resolve(join(root, rel));
  const rootRelativePath = relative(root, file);
  if (rootRelativePath.startsWith('..') || isAbsolute(rootRelativePath)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not file');
    res.writeHead(200, { 'content-type': types.get(extname(file)) ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, host, () => {
  console.log(`SMPL Web Viewer static server: http://${host}:${port}/`);
});
