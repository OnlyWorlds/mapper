// A static server for a built page, in the walk's own process (so stopping the walk stops it),
// answering as the host does (walk/host.mjs): files, the host's .html handling, _headers and
// _redirects, and 404 with 404.html for any path that is no file, never the app.
//   import { serve } from './serve.mjs'; const s = await serve('dist', 4187); ... await s.close();
//   node walk/serve.mjs [dist] [port]   (serves until stopped)
import { createServer } from 'node:http';
import { hostFor } from './host.mjs';

export function serve(dist = 'dist', port = 4187, host = '127.0.0.1', { drop = [] } = {}) {
  const site = hostFor(dist);
  const server = createServer((req, res) => {
    const a = site.answer(req.url);
    for (const d of drop) delete a.headers[d];
    // The host's headers as they are, Cache-Control included (no-store only where _headers says it, so
    // a walk can see the callback's rule go missing); a control build is served on its own port.
    res.writeHead(a.status, a.headers);
    res.end(req.method === 'HEAD' ? undefined : a.body);
  });
  return new Promise((ok) => server.listen(port, host, () => ok({ url: `http://${host}:${port}`, close: () => new Promise((c) => server.close(c)) })));
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('serve.mjs')) {
  const s = await serve(process.argv[2] ?? 'dist', Number(process.argv[3] ?? 4187));
  console.log(`serving ${s.url}`);
}
