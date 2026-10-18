// Serves only the reviewed production build. Never expose the workspace or Vite server.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, extname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const root = await realpath(resolve('dist/web'));
const port = Number(process.env.TRYON_PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid TRYON_PORT');
const compress = promisify(gzip);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm', '.json': 'application/json; charset=utf-8', '.task': 'application/octet-stream',
  '.tflite': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const inside = file => { const r = relative(root, file); return r && r !== '..' && !r.startsWith(`..\\`) && !r.startsWith('../') && !isAbsolute(r); };
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'none'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path.includes('\\') || path.includes('\0') || path.split('/').some(p => p.startsWith('.'))) throw new Error('Invalid path');
    const candidate = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!inside(candidate)) throw new Error('Outside build');
    const file = await realpath(candidate);
    if (!inside(file) || !(await stat(file)).isFile()) throw new Error('Not a build file');
    const data = await readFile(file), etag = `"${createHash('sha256').update(data).digest('hex')}"`;
    res.setHeader('Content-Type', types[extname(file)] || 'text/plain; charset=utf-8');
    res.setHeader('ETag', etag);res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Cache-Control', extname(file) === '.html' || file.endsWith('-worker.js') ? 'no-cache' : 'public, max-age=3600');
    if (req.headers['if-none-match'] === etag) { res.writeHead(304);res.end();return; }
    const zipped = data.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const body = zipped ? await compress(data) : data;
    if (zipped) res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', body.length);res.writeHead(200);res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404);res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Static try-on build: http://localhost:${port}; only dist/web is accessible.`));
