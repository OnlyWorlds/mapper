// A static server for a built page, in the walk's own process (so stopping the walk stops it):
// files from dist, and index.html for any path that is not a file.
//   import { serve } from './serve.mjs'; const s = await serve('dist', 4187); ... await s.close();
//   node walk/serve.mjs [dist] [port]   (serves until stopped)
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' };

export function serve(dist = 'dist', port = 4187, host = '127.0.0.1') {
  const root = resolve(dist);
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(root, normalize(path).replace(/^([/\\])+/, ''));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(port, host, () => ok({ url: `http://${host}:${port}`, close: () => new Promise((c) => server.close(c)) })));
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('serve.mjs')) {
  const s = await serve(process.argv[2] ?? 'dist', Number(process.argv[3] ?? 4187));
  console.log(`serving ${s.url}`);
}
