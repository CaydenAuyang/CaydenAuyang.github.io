// serve.mjs: a small static server for a built site, close to how GitHub Pages serves it.
//
// "npm run check" uses it (astro preview allows only one preview per project, and the checks need
// their own). It serves /path from path/index.html or path.html, answers anything else with
// 404.html and status 404, gzips text the way Pages does (so transfer sizes and Lighthouse are
// realistic), and answers byte ranges (Safari won't play a video without them).
//   node scripts/serve.mjs [folder, default dist] [port, default 4321]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.bin': 'application/octet-stream',
  '.pdf': 'application/pdf',
};
// Pages compresses text formats (and the binary point files compress well, but Pages leaves them).
const GZIP = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.xml', '.webmanifest']);

function resolve(root, urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(root, clean);
  if (!file.startsWith(root)) return null;
  for (const candidate of [file, path.join(file, 'index.html'), `${file}.html`]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

/** Starts the server; resolves to { server, port, url }. Port 0 picks a free one. */
export function serve(folder = 'dist', port = 4321) {
  const root = path.resolve(folder);
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    let file = resolve(root, pathname);
    let status = 200;
    if (!file) {
      file = path.join(root, '404.html');
      status = 404;
      if (!fs.existsSync(file)) {
        res.writeHead(404, { 'content-type': TYPES['.txt'] });
        return res.end('Not found');
      }
    }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'max-age=600' };
    if (GZIP.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      const body = zlib.gzipSync(fs.readFileSync(file));
      res.writeHead(status, { ...headers, 'content-encoding': 'gzip', 'content-length': body.length, vary: 'Accept-Encoding' });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    const size = fs.statSync(file).size;
    const range = status === 200 && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? +range[1] : size - +range[2];
      const end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
      if (start > end || start < 0) {
        res.writeHead(416, { 'content-range': `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(status, { ...headers, 'accept-ranges': 'bytes', 'content-length': size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      done({ server, port: actual, url: `http://127.0.0.1:${actual}` });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [folder = 'dist', port = '4321'] = process.argv.slice(2);
  const { url } = await serve(folder, +port);
  console.log(`Serving ${path.resolve(folder)} at ${url}`);
}
