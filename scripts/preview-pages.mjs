import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const base = '/airbag/';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/' || pathname === '/airbag') { res.writeHead(302, { Location: base }); res.end(); return; }
    if (!['GET', 'HEAD'].includes(req.method) || !pathname.startsWith(base)) { res.writeHead(404); res.end('Not found'); return; }
    const relative = pathname.slice(base.length) || 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root) || relative.split('/').includes('..')) { res.writeHead(404); res.end('Not found'); return; }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache', 'Permissions-Policy': 'camera=(self), microphone=()' });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(process.env.PORT || 4317), '127.0.0.1', () => console.log('Preview: http://localhost:' + (process.env.PORT || 4317) + base));
