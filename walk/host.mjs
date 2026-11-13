// The host, as the maps Worker answers a build directory (wrangler.jsonc: assets with
// not_found_handling "404-page" and html_handling "auto-trailing-slash"), for the walks:
//   - a file is served as itself; `/a` serves `a.html`, `/a/` serves `a/index.html`, `/` index.html;
//   - `/a.html` and `/index.html` answer 307 to `/a` and `/`; `/a/` with only `a.html` answers 307 to
//     `/a`, and `/a` with only `a/index.html` answers 307 to `/a/` (the query kept);
//   - a `_redirects` line with status 200 serves its target for its path; `_headers` blocks apply by
//     the request's path, `! Name` detaching an inherited header;
//   - anything else is 404 with 404.html, never the app (no single-page fallback). The config files
//     themselves are never served.
// What it cannot see: the host's own rules beyond these, which the live walk reads on the host.
//   import { hostFor } from './host.mjs'; const host = hostFor('dist'); host.answer('/signin/callback?code=x')
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp', '.txt': 'text/plain' };

function headerBlocks(dist) {
  const blocks = [];
  const file = join(dist, '_headers');
  if (!existsSync(file)) return blocks;
  let cur = null;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      cur = { path: raw.trim(), set: [], drop: [] };
      blocks.push(cur);
      continue;
    }
    const l = raw.trim();
    if (l.startsWith('!')) cur.drop.push(l.slice(1).trim().toLowerCase());
    else {
      const i = l.indexOf(':');
      cur.set.push([l.slice(0, i).trim(), l.slice(i + 1).trim()]);
    }
  }
  return blocks;
}

function redirectLines(dist) {
  const file = join(dist, '_redirects');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/\s+/));
}

export function hostFor(dist = 'dist') {
  const root = resolve(dist);
  const blocks = headerBlocks(root);
  const rewrites = redirectLines(root);
  const isFile = (rel) => {
    const f = join(root, normalize(rel).replace(/^([/\\])+/, ''));
    return f.startsWith(root) && existsSync(f) && statSync(f).isFile() ? f : null;
  };
  const headersFor = (path) => {
    const out = {};
    for (const b of blocks) {
      const re = new RegExp('^' + b.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      if (!re.test(path)) continue;
      for (const d of b.drop) for (const k of Object.keys(out)) if (k.toLowerCase() === d) delete out[k];
      for (const [k, v] of b.set) out[k] = v;
    }
    return out;
  };
  const file = (status, f, path) => ({ status, headers: { ...headersFor(path), 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream' }, body: readFileSync(f) });
  const moved = (to, search, path) => ({ status: 307, headers: { ...headersFor(path), Location: to + search }, body: Buffer.alloc(0) });
  const notFound = (path) => {
    const f = isFile('404.html');
    return f ? file(404, f, path) : { status: 404, headers: headersFor(path), body: Buffer.alloc(0) };
  };

  /** The host's answer to a path with its query (`/signin/callback?code=x`). */
  function answer(pathAndQuery) {
    const u = new URL(pathAndQuery, 'http://host');
    const path = decodeURIComponent(u.pathname);
    const search = u.search;
    if (path === '/_headers' || path === '/_redirects') return notFound(path);
    for (const [from, to, status] of rewrites) {
      if (status === '200' && from === path) {
        const t = to === '/' ? isFile('index.html') : isFile(to) ?? isFile(`${to}.html`) ?? isFile(join(to, 'index.html'));
        if (t) return file(200, t, path);
      }
    }
    if (path.endsWith('/index.html')) return moved(path.slice(0, -'index.html'.length), search, path);
    if (path.endsWith('.html') && isFile(path)) return moved(path.slice(0, -'.html'.length), search, path);
    if (path.endsWith('/')) {
      const idx = isFile(join(path, 'index.html'));
      if (idx) return file(200, idx, path);
      if (path !== '/' && isFile(`${path.slice(0, -1)}.html`)) return moved(path.slice(0, -1), search, path);
      return notFound(path);
    }
    const exact = isFile(path);
    if (exact) return file(200, exact, path);
    const html = isFile(`${path}.html`);
    if (html) return file(200, html, path);
    if (isFile(join(path, 'index.html'))) return moved(`${path}/`, search, path);
    return notFound(path);
  }

  return { answer, headersFor };
}
