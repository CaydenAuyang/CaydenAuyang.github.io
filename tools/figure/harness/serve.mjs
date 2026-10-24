// A tiny static file server for the harness, rooted at the repo root (no dependencies).
//   node tools/figure/harness/serve.mjs [port]   then open
//   http://127.0.0.1:4317/tools/figure/harness/index.html
// python3 -m http.server from the repo root works the same way.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// mounts: optional { '/prefix/': '/abs/dir' } for files that live outside the repo (test data).
export function serve(root = REPO_ROOT, port = 0, mounts = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const pathname = decodeURIComponent(url.pathname);
    let base = root;
    let rel = pathname.replace(/^\/+/, '');
    for (const [prefix, dir] of Object.entries(mounts)) {
      if (pathname.startsWith(prefix)) {
        base = dir;
        rel = pathname.slice(prefix.length);
      }
    }
    const file = path.resolve(base, rel || 'index.html');
    if (!file.startsWith(base)) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 4317);
  serve(REPO_ROOT, port).then(({ port: p }) => console.log(`serving ${REPO_ROOT} at http://127.0.0.1:${p}/tools/figure/harness/index.html`));
}
