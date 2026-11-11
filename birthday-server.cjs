'use strict';

// A deliberately small, read-only server for this website. No dependencies.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8765;
const ROOT = fs.realpathSync(path.dirname(__filename));
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'], ['.ico', 'image/x-icon'], ['.gif', 'image/gif'],
  ['.woff2', 'font/woff2'], ['.woff', 'font/woff'], ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'], ['.ogg', 'audio/ogg']
]);
const HEADERS = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store'
};

function validPort(value) {
  const text = String(value);
  if (!/^\d{1,5}$/.test(text) || Number(text) < 1 || Number(text) > 65535) {
    throw new Error('Port must be an integer from 1 to 65535.');
  }
  return Number(text);
}

function parsePort(args = process.argv.slice(2)) {
  if (!args.length) return DEFAULT_PORT;
  if (args.length === 2 && args[0] === '--port') return validPort(args[1]);
  if (args.length === 1 && args[0].startsWith('--port=')) return validPort(args[0].slice(7));
  throw new Error('Usage: node birthday-server.cjs [--port 8765]');
}

function isInsideRoot(filename) {
  const relative = path.relative(ROOT, filename);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function safeParts(parts) {
  return parts.every(part => part && !part.startsWith('.') && !/[. ]$/.test(part)
    && !/[<>:"|?*\\\x00-\x1f\x7f%]/.test(part)
    && !/(?:^|[._ -])(?:backups?|bak|orig|old)(?:[._ -]|$)/i.test(part)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

function requestedPath(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || url.includes('#')) return null;
  const raw = url.split('?', 1)[0];
  // Encoded separators and repeatedly encoded paths are never needed by this site.
  if (/%(?:2f|5c)/i.test(raw)) return null;
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (decoded === '/') return path.join(ROOT, 'index.html');
  const parts = decoded.slice(1).split('/');
  if (!safeParts(parts)) return null;
  const resolved = path.resolve(ROOT, ...parts);
  return isInsideRoot(resolved) ? resolved : null;
}

function send(req, res, status, text, type = 'text/plain; charset=utf-8', extra = {}) {
  const content = Buffer.from(text, 'utf8');
  res.writeHead(status, { ...HEADERS, 'Content-Type': type, 'Content-Length': content.length, ...extra });
  res.end(req.method === 'HEAD' ? undefined : content);
}

function createServer({ port = DEFAULT_PORT } = {}) {
  port = validPort(port);
  const allowedHosts = new Set([`${HOST}:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([`http://${HOST}:${port}`, `http://localhost:${port}`]);
  const shutdownToken = crypto.randomBytes(32).toString('hex');
  const shutdownSecret = Buffer.from(shutdownToken, 'ascii');
  let shutdownTimer = null;
  const server = http.createServer(async (req, res) => {
    let file;
    try {
      const hostCount = req.rawHeaders.filter((_, index, headers) => index % 2 === 0 && headers[index].toLowerCase() === 'host').length;
      if (hostCount !== 1 || !allowedHosts.has(req.headers.host)) {
        send(req, res, 403, 'Forbidden host.\n'); return;
      }
      if (req.url === '/__birthday_shutdown') {
        if (req.method !== 'POST') {
          send(req, res, 405, 'Use the local launcher to stop this website.\n', undefined, { Allow:'POST' }); return;
        }
        const origin = req.headers.origin;
        const token = req.headers['x-birthday-token'];
        if ((origin !== undefined && !allowedOrigins.has(origin))
          || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)
          || !crypto.timingSafeEqual(Buffer.from(token, 'ascii'), shutdownSecret)) {
          send(req, res, 403, 'Forbidden.\n'); return;
        }
        send(req, res, 200, JSON.stringify({ stopped:true }), 'application/json; charset=utf-8');
        if (!shutdownTimer) {
          shutdownTimer = setTimeout(() => {
            server.close(() => {});
            server.closeAllConnections();
          }, 100);
          shutdownTimer.unref();
        }
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(req, res, 405, 'Read-only website.\n', undefined, { Allow:'GET, HEAD' }); return;
      }
      if (req.url === '/__birthday_health') {
        send(req, res, 200, JSON.stringify({ app:'codex-birthday-local', root:ROOT, port, pid:process.pid, version:1, shutdownToken }), 'application/json; charset=utf-8');
        return;
      }
      const candidate = requestedPath(req.url);
      if (!candidate || !MIME.has(path.extname(candidate).toLowerCase())) {
        send(req, res, 404, 'Not found.\n'); return;
      }
      // Resolve junctions/symlinks before opening; never follow one out of the site.
      const canonical = await fs.promises.realpath(candidate);
      const relativeParts = path.relative(ROOT, canonical).split(path.sep);
      if (!isInsideRoot(canonical) || !safeParts(relativeParts) || !MIME.has(path.extname(canonical).toLowerCase())) {
        send(req, res, 404, 'Not found.\n'); return;
      }
      file = await fs.promises.open(canonical, 'r');
      const stat = await file.stat();
      if (!stat.isFile()) {
        await file.close(); file = null;
        send(req, res, 404, 'Not found.\n'); return;
      }
      if (res.destroyed) { await file.close(); file = null; return; }
      const type = MIME.get(path.extname(canonical).toLowerCase());
      // Pictures and audio rarely change; let the browser keep them between pages.
      const cache = /^(image|audio|font)\//.test(type) ? { 'Cache-Control':'private, max-age=86400' } : {};
      res.writeHead(200, { ...HEADERS, 'Content-Type':type, 'Content-Length':stat.size, ...cache });
      if (req.method === 'HEAD') {
        await file.close(); file = null; res.end(); return;
      }
      const stream = file.createReadStream({ autoClose:true });
      file = null; // The stream owns the descriptor from this point onward.
      stream.once('error', () => res.destroy());
      res.once('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (file) await file.close().catch(() => {});
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      const missing = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(error.code);
      send(req, res, missing ? 404 : 500, missing ? 'Not found.\n' : 'Could not read this file.\n');
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 3000;
  server.maxHeadersCount = 40;
  return server;
}

async function start({ port = DEFAULT_PORT } = {}) {
  port = validPort(port);
  const server = createServer({ port });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => { server.removeListener('error', reject); resolve(); });
  });
  return server;
}

module.exports = { createServer, start, parsePort };

if (require.main === module) {
  let port;
  try { port = parsePort(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  if (port) start({ port }).then(server => {
    console.log(`Birthday website: http://${HOST}:${port}/cosmos.html`);
    const close = () => { server.close(); server.closeAllConnections(); };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  }).catch(error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'Could not start the local birthday website.');
    process.exitCode = 1;
  });
}
