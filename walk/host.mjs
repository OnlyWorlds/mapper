// The host, as the maps Worker answers a build directory (wrangler.jsonc: assets with
// not_found_handling "404-page" and html_handling "auto-trailing-slash"), for the walks:
//   - a file is served as itself; `/a` serves `a.html`, `/a/` serves `a/index.html`, `/` index.html;
//   - `/a.html` and `/index.html` answer 307 to `/a` and `/`; `/a/` with only `a.html` answers 307 to
//     `/a`, and `/a` with only `a/index.html` answers 307 to `/a/` (the query kept);
//   - paths are case-exact (`/404.HTML` is no file) and a path written with escapes it does not
//     need answers 307 to its plain form first (`/%34%30%34?x=1` to `/404?x=1`): both read on the
//     live host on 2026-11-13;
//   - a `_redirects` line with status 200 serves its target for its path; `_headers` blocks apply by
//     the request's path, `! Name` detaching an inherited header, and a header set by two blocks has
//     its values joined with a comma (Cloudflare's rule), never the later one alone;
//   - an answer whose `_headers` set no Cache-Control carries Cloudflare's own default,
//     `public, max-age=0, must-revalidate` (what the live host sends);
//   - anything else is 404 with 404.html, never the app (no single-page fallback). The config files
//     themselves are never served.
// What it cannot see: the host's own rules beyond these, which the live walk reads on the host.
//   import { hostFor } from './host.mjs'; const host = hostFor('dist'); host.answer('/signin/callback?code=x')
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp', '.txt': 'text/plain' };
export const DEFAULT_CACHE = 'public, max-age=0, must-revalidate';

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
  /** A file at this path, its every segment matched with its exact case (the host's are case-exact). */
  const isFile = (rel) => {
    const parts = rel.split('/').filter(Boolean);
    if (!parts.length || parts.some((p) => p === '.' || p === '..')) return null;
    let dir = root;
    for (const [i, part] of parts.entries()) {
      let names;
      try {
        names = readdirSync(dir);
      } catch {
        return null;
      }
      if (!names.includes(part)) return null;
      dir = join(dir, part);
      if (i < parts.length - 1 && !statSync(dir).isDirectory()) return null;
    }
    return statSync(dir).isFile() ? dir : null;
  };
  /** The headers for a request's path: blocks in order, `!` detaching, a header set twice joined with a comma. */
  const headersFor = (path) => {
    const out = new Map(); // lower-cased name -> [name as written, value]
    for (const b of blocks) {
      const re = new RegExp('^' + b.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      if (!re.test(path)) continue;
      for (const d of b.drop) out.delete(d);
      for (const [k, v] of b.set) {
        const had = out.get(k.toLowerCase());
        out.set(k.toLowerCase(), had ? [had[0], `${had[1]}, ${v}`] : [k, v]);
      }
    }
    const headers = Object.fromEntries([...out.values()]);
    if (!out.has('cache-control')) headers['Cache-Control'] = DEFAULT_CACHE;
    return headers;
  };
  const file = (status, f, path) => ({ status, headers: { ...headersFor(path), 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream' }, body: readFileSync(f) });
  const moved = (to, search, path) => ({ status: 307, headers: { ...headersFor(path), Location: to + search }, body: Buffer.alloc(0) });
  const notFound = (path) => {
    const f = isFile('404.html');
    return f ? file(404, f, path) : { status: 404, headers: headersFor(path), body: Buffer.alloc(0) };
  };

  /** The host's answer to a path with its query (`/signin/callback?code=x`), as sent. */
  function answer(pathAndQuery) {
    const raw = pathAndQuery.split('?')[0].split('#')[0] || '/';
    const search = pathAndQuery.includes('?') ? `?${pathAndQuery.split('?').slice(1).join('?').split('#')[0]}` : '';
    let path;
    try {
      path = decodeURIComponent(raw);
    } catch {
      return notFound(raw);
    }
    // Escapes the path does not need: the plain form first, by a redirect.
    if (encodeURI(path) !== raw) return moved(encodeURI(path), search, path);
    if (path === '/_headers' || path === '/_redirects') return notFound(path);
    for (const [from, to, status] of rewrites) {
      if (status === '200' && from === path) {
        const t = to === '/' ? isFile('index.html') : isFile(to) ?? isFile(`${to}.html`) ?? isFile(`${to}/index.html`);
        if (t) return file(200, t, path);
      }
    }
    if (path.endsWith('/index.html')) return moved(path.slice(0, -'index.html'.length), search, path);
    if (path.endsWith('.html') && isFile(path)) return moved(path.slice(0, -'.html'.length), search, path);
    if (path.endsWith('/')) {
      const idx = isFile(`${path}index.html`);
      if (idx) return file(200, idx, path);
      if (path !== '/' && isFile(`${path.slice(0, -1)}.html`)) return moved(path.slice(0, -1), search, path);
      return notFound(path);
    }
    const exact = isFile(path);
    if (exact) return file(200, exact, path);
    const html = isFile(`${path}.html`);
    if (html) return file(200, html, path);
    if (isFile(`${path}/index.html`)) return moved(`${path}/`, search, path);
    return notFound(path);
  }

  return { answer, headersFor };
}
