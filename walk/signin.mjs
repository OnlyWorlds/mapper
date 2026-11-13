// Sign in with OnlyWorlds and the home, played. Playwright serves https://maps.onlyworlds.com from a
// build under the host's own rules (walk/host.mjs: the callback page, _headers, 404 for an unknown
// path) and plays keel: the authorize and consent pages, the token exchange, the account's worlds,
// world reads on the token, the token's revoke, and a token that ends (401). keel's `maps` entry
// keeps consent through revokes (consent_outlives_tokens), so a second sign-in goes straight
// through. Nothing reaches the real server. What it cannot see: the host's own rules beyond
// host.mjs, and real keel (the live walk, once the client is live).
//   npm run build && node walk/signin.mjs [chromium|firefox]      (both viewports)
// The played walk (walk/played.mjs) runs it as its section `signin`. MAPPER_DIST serves another build.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { hostFor } from './host.mjs';
import { keyOf, MOPPETOPIA as M, M_MAP } from './worlds.mjs';

const PROD = 'https://maps.onlyworlds.com';
const CALLBACK = `${PROD}/signin/callback`;
const OTHER = 'https://elsewhere.example';
const ENDED = 'Your sign-in ended on OnlyWorlds, so the mapper is signed out. Sign in again to go on.';
const LEFT = 'You left the page, so the mapper signed you out.';
const SIGNED_OUT = 'Signed out, and the sign-in is removed from your OnlyWorlds account.';
const ALREADY = 'That sign-in is no longer waiting here';
const NO_STORAGE = 'This browser keeps no storage for the mapper';

const wid = (w, n) => `${w}-${w.slice(0, 4)}-7${w.slice(0, 3)}-8${w.slice(0, 3)}-${String(n).padStart(12, '0')}`;
const SALT = '11111111-1111-7111-8111-111111111111'; // owned, private: two maps, an element on none
const JOIN = '22222222-2222-7222-8222-222222222222'; // joined as a contributor, private
const BETA = '33333333-3333-7333-8333-333333333333'; // owned, no maps
const OLD = '44444444-4444-7444-8444-444444444444'; // on the list, but its maps answer 404 now
const S1 = wid('11111111', 1); // Harbour plan, a top map
const S2 = wid('11111111', 2); // Old town, under the Harbour plan
const NOPIN = wid('11111111', 30); // an element no Pin places
const J1 = wid('22222222', 1);
const WORLDS = [
  { id: JOIN, name: 'Alpha Shared', role: 'collaborator', member_role: 'contributor', public_read: false, keys: [] },
  { id: SALT, name: 'Saltmere Coast', role: 'owner', public_read: false, keys: [] },
  { id: OLD, name: 'Old Guild', role: 'collaborator', member_role: 'guest', public_read: false, keys: [] },
  { id: M, name: 'Moppetopia', role: 'owner', public_read: true, keys: [] },
  { id: BETA, name: 'beta', role: 'owner', public_read: false, keys: [] },
];
const MANY = Array.from({ length: 40 }, (_, i) => ({ id: `55555555-5555-7555-8555-${String(i + 1).padStart(12, '0')}`, name: `World ${String(i + 1).padStart(2, '0')}`, role: i % 3 ? 'owner' : 'collaborator', member_role: i % 3 ? undefined : 'contributor', public_read: false, keys: [] }));
const SALT_ROWS = {
  map: [{ id: S2, type: 'map', name: 'Old town', width: 600, height: 400, parent_map: S1, hierarchy: 1 }, { id: S1, type: 'map', name: 'Harbour plan', width: 1000, height: 800, hierarchy: 0 }],
  pin: [
    { id: wid('11111111', 10), type: 'pin', name: 'pin', map: S1, element_type: 'location', element_id: wid('11111111', 20), x: 100, y: 100 },
    { id: wid('11111111', 11), type: 'pin', name: 'pin', map: S1, element_type: 'location', element_id: wid('11111111', 21), x: 300, y: 200 },
  ],
  location: [{ id: wid('11111111', 20), type: 'location', name: 'Saltmere', partner: wid('11111111', 21) }, { id: wid('11111111', 21), type: 'location', name: 'Gull Rock' }, { id: NOPIN, type: 'location', name: 'The Drowned Bell' }],
};
const PLAYED = {
  [SALT]: SALT_ROWS,
  [JOIN]: { map: [{ id: J1, type: 'map', name: 'Shared chart', width: 500, height: 500 }], pin: [], location: [] },
  [BETA]: { map: [], pin: [], location: [] },
};
for (const w of MANY) PLAYED[w.id] = { map: [{ id: w.id.replace(/-5555-7555/, '-6666-7666'), type: 'map', name: `${w.name} chart`, width: 400, height: 300 }], pin: [], location: [] };
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const waitFor = async (pred, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return pred();
};

/**
 * The sign-in sections for one viewport. `check(label, ok, detail)` counts; `shot(name)` names a
 * screenshot file. Each scenario runs in a fresh context of its own.
 */
export async function signinWalk({ browser, which, vp, opts, check, dist = 'dist', fx, only = null }) {
  const host = hostFor(dist);
  const phone = vp === 'phone';
  mkdirSync('.scratch/shots', { recursive: true });
  let shotN = 0;

  async function session(worlds = WORLDS, { noStorage = false } = {}) {
    const ctx = await browser.newContext(opts);
    if (noStorage) {
      await ctx.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
      });
    }
    // Each request the page sends that is not a GET, with keepalive, kept across an unload.
    await ctx.addInitScript(() => {
      const real = window.fetch;
      window.fetch = (input, init) => {
        const m = init?.method ?? 'GET';
        if (m !== 'GET') {
          try {
            localStorage.setItem('__walk_fetch', `${localStorage.getItem('__walk_fetch') ?? ''}${m} ${String(input)} keepalive=${init?.keepalive} | `);
          } catch {
            /* a context with no storage */
          }
        }
        return real(input, init);
      };
    });
    const page = await ctx.newPage();
    const errors = [];
    const consoleText = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      consoleText.push(m.text());
      if (m.type() === 'error' && !/^Failed to load resource|CORS request did not succeed/.test(m.text())) errors.push(m.text());
      if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) errors.push(m.text());
    });
    const keel = {
      tokens: new Map(), minted: 0, consent: false, consentShown: 0, authorized: 0, calls: [], challenge: '', code: '', worlds,
      holdToken: false, releaseToken: null, tokenAsked: 0, delayMs: 0, open: 0, most: 0, offList: [],
    };
    const live = () => [...keel.tokens.values()].filter((t) => !t.revoked);
    await ctx.route('https://www.onlyworlds.com/**', async (r) => {
      const req = r.request();
      const u = new URL(req.url());
      const m = req.method();
      const hd = req.headers();
      const bearer = (hd.authorization ?? '').replace(/^Bearer /, '') || null;
      const call = { m, path: u.pathname, q: u.search, world: u.searchParams.get('world'), bearer, at: Date.now() };
      keel.calls.push(call);
      const cors = { 'access-control-allow-origin': PROD, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'Retry-After, RateLimit-Remaining, RateLimit-Reset' };
      const send = async (a) => {
        keel.open++;
        keel.most = Math.max(keel.most, keel.open);
        try {
          if (keel.delayMs && m === 'GET') await new Promise((res) => setTimeout(res, keel.delayMs));
          await r.fulfill(a);
        } catch {
          /* the page aborted it: a late answer to nobody */
        } finally {
          keel.open--;
        }
      };
      const json = (status, body) => send({ status, contentType: 'application/json', headers: cors, body: body === null ? '' : JSON.stringify(body) });
      if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: cors, body: '' });
      if (u.pathname === '/signin/authorize') {
        keel.authorized++;
        keel.challenge = u.searchParams.get('code_challenge');
        keel.code = `c0de-${keel.authorized}`;
        const state = u.searchParams.get('state');
        const back = `${CALLBACK}?code=${keel.code}&state=${state}`;
        const cancel = `${CALLBACK}?error=access_denied&state=${state}`;
        const ok = u.searchParams.get('client_id') === 'maps' && u.searchParams.get('redirect_uri') === CALLBACK && u.searchParams.get('code_challenge_method') === 'S256';
        if (!ok) return r.fulfill({ status: 400, contentType: 'text/html', body: '<p>unknown client</p>' });
        // keel answers at once when consent exists (a 302 in keel; a replace here), else its consent page.
        if (keel.consent) return r.fulfill({ status: 200, contentType: 'text/html', headers: { 'cache-control': 'no-store' }, body: `<script>location.replace(${JSON.stringify(back)})</script>` });
        keel.consentShown++;
        return r.fulfill({ status: 200, contentType: 'text/html', headers: { 'cache-control': 'no-store' }, body: `<!doctype html><title>Consent</title><h1>The mapper wants to read your worlds</h1><a id="go" href=${JSON.stringify(back)}>Continue</a> <a id="no" href=${JSON.stringify(cancel)}>Cancel</a>` });
      }
      if (u.pathname === '/api/v2/auth/token') {
        keel.tokenAsked++;
        if (keel.holdToken) {
          keel.holdToken = false;
          await new Promise((res) => (keel.releaseToken = res));
        }
        const b = JSON.parse(req.postData());
        const ok = b.grant_type === 'authorization_code' && b.code === keel.code && b.client_id === 'maps' && b.redirect_uri === CALLBACK && b64url(createHash('sha256').update(b.code_verifier).digest()) === keel.challenge;
        if (!ok) return json(400, { error: { code: 'invalid_grant', message: 'KEEL TEXT' } });
        keel.code = '';
        keel.consent = true;
        const n = ++keel.minted;
        const token = `ow_a_${String(n).repeat(40)}`;
        keel.tokens.set(token, { id: `tok-${n}`, revoked: false });
        return json(200, { token, token_id: `tok-${n}`, token_type: 'bearer', expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), account: { id: 'acc-1', username: 'wren' } });
      }
      const p = u.pathname.replace('/api/v2', '');
      const t = bearer ? keel.tokens.get(bearer) : null;
      if (bearer && (!t || t.revoked)) return json(401, { error: { code: t ? 'key_revoked' : 'invalid_credentials', message: 'Revoked.' } });
      if (m === 'DELETE' && p.startsWith('/account/tokens/')) {
        const tid = decodeURIComponent(p.split('/')[3]);
        if (!t || t.id !== tid) return json(404, { error: { code: 'not_found' } });
        t.revoked = true;
        void live; // keel keeps the maps client's consent through revokes
        return json(204, null);
      }
      if (p === '/account/worlds' || p === '/account/worlds/') return t ? json(200, { data: keel.worlds }) : json(401, { error: { code: 'authentication_failed' } });
      if (m !== 'GET') return json(405, { error: { code: 'method_not_allowed' } });
      const world = call.world;
      // A world off the account's list must never be read with the token.
      if (bearer && world && !keel.worlds.some((w) => w.id === world)) keel.offList.push(world);
      if (world === OLD) return json(404, { error: { code: 'not_found', message: 'World not found.' } });
      const rows = PLAYED[world];
      if (rows) {
        if (!bearer) return json(404, { error: { code: 'not_found', message: 'World not found.' } });
        const type = p.split('/')[1];
        const one = p.split('/')[2];
        if (type === 'world') {
          const meta = keel.worlds.find((w) => w.id === world);
          return json(200, { id: world, name: meta?.name ?? 'Untitled', counts: { total: 0, types: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length])) } });
        }
        let list = rows[type] ?? [];
        if (one) {
          const row = list.find((x) => x.id === one);
          return row ? json(200, row) : json(404, { error: { code: 'not_found' } });
        }
        const ids = u.searchParams.get('ids');
        if (ids) list = list.filter((x) => ids.split(',').includes(x.id));
        const mapF = u.searchParams.get('map');
        if (mapF) list = list.filter((x) => x.map === mapF);
        const el = u.searchParams.get('element');
        if (el) list = list.filter((x) => x.element_id === el);
        return json(200, { data: list, has_more: false, next_cursor: null });
      }
      const hit = fx.api[keyOf(req.url())];
      if (hit) return send({ status: hit.status, contentType: hit.type, headers: cors, body: hit.body });
      return json(404, { error: { code: 'not_found', message: 'not played' } });
    });
    await ctx.route('https://media.onlyworlds.com/**', (r) => {
      const md = fx.media[r.request().url()];
      return md ? r.fulfill({ status: 200, contentType: md.type, headers: { 'access-control-allow-origin': '*' }, body: readFileSync(`.scratch/fixtures/media/${md.file}`) }) : r.fulfill({ status: 404, body: '' });
    });
    await ctx.route(`${PROD}/**`, (r) => {
      const u = new URL(r.request().url());
      const a = host.answer(u.pathname + u.search);
      return r.fulfill({ status: a.status, headers: a.headers, body: a.body });
    });
    await ctx.route(`${OTHER}/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Elsewhere</title><p>elsewhere</p>' }));
    const shot = (name) => page.screenshot({ path: `.scratch/shots/signin-${which}-${vp}-${String(++shotN).padStart(2, '0')}-${name}.png`, fullPage: true });
    return { ctx, page, keel, errors, consoleText, shot };
  }

  /** Mark the document, so a wait can tell a new page from the one the press left. */
  const mark = (page) => page.evaluate(() => (window.__old = true)).catch(() => {});
  const settled = (page) => page.waitForFunction(() => !window.__old && !!window.__mapper && location.hostname === 'maps.onlyworlds.com' && !location.pathname.startsWith('/signin') && !document.body.innerText.includes('Signing in…'), null, { timeout: 15_000 });

  /** Press Sign in (the first one on the page), take keel's consent page when it comes, and wait for the mapper again. */
  async function signIn(page, { consent = 'continue' } = {}) {
    await mark(page);
    await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).first().click();
    await page.waitForFunction(() => !window.__old && (!!document.querySelector('#go') || (!!window.__mapper && !document.body.innerText.includes('Signing in…'))), null, { timeout: 15_000 });
    if (await page.locator('#go').count()) {
      await mark(page);
      await page.click(consent === 'cancel' ? '#no' : '#go');
    }
    await settled(page);
  }

  const mineNames = (page) => page.locator('.mine .world-title-name').allTextContents();
  const demoNames = (page) => page.locator('.demos .world-title-name').allTextContents();
  const signedIn = (page) => page.evaluate(() => window.__mapper.signedIn);
  const tokenOf = (keel, n = 0) => [...keel.tokens.keys()][n];
  /** Everything a walk can read of the page, for the token: storage, the address, the walk window. */
  const exposed = (page) =>
    page.evaluate(() => {
      const m = window.__mapper;
      const view = {};
      for (const k of Object.keys(Object.getOwnPropertyDescriptors(m))) {
        try {
          view[k] = typeof m[k] === 'function' ? null : m[k];
        } catch {
          view[k] = 'threw';
        }
      }
      return { local: { ...localStorage }, session: { ...sessionStorage }, href: location.href, title: document.title, mapper: JSON.stringify(view), html: document.documentElement.outerHTML };
    });
  const leftRevoke = async (label, page, keel, token, how) => {
    const tid = keel.tokens.get(token)?.id;
    const sent = await page.evaluate(() => localStorage.getItem('__walk_fetch') ?? '');
    await page.evaluate(() => localStorage.removeItem('__walk_fetch'));
    check(`${label}: on ${how} the page sends its token's revoke, keepalive`, sent.includes(`DELETE https://www.onlyworlds.com/api/v2/account/tokens/${tid} keepalive=true`), sent.trim() || 'nothing');
    const landed = await waitFor(() => keel.tokens.get(token)?.revoked === true, 4000);
    // Chromium's routing never sees a keepalive request that outlives its page; Firefox's does.
    if (which === 'firefox') check(`${label}: keel takes the revoke on ${how}`, landed);
  };
  const section = async (name, fn) => {
    if (only && !only.includes(name) && !only.includes('signin')) return;
    try {
      await fn();
    } catch (e) {
      // The first lines name what was waited for (Playwright's second line is the locator).
      check(`${vp} signin section ${name} ran to its end`, false, String(e?.message ?? e).split('\n').slice(0, 3).join(' ').slice(0, 400));
    }
  };

  // A. A stranger's home: the demo worlds from the page itself (no read at all), the ways in, and
  // a card that opens its map by a push, Back to the home.
  await section('A', async () => {
    const { ctx, page, keel, errors, shot } = await session();
    await page.goto(`${PROD}/`);
    await page.waitForSelector('.demos .world-row');
    const L = `${vp} stranger's home`;
    check(`${L}: the three demo worlds in rows`, (await demoNames(page)).join('|') === 'Moppetopia|Sikelia|Blood Meridian: the scalp country, 1849-50', (await demoNames(page)).join('|'));
    const cards = await page.$$eval('.demos .world-row', (rows) => rows.map((r) => [...r.querySelectorAll('.cards .map-card')].map((c) => c.querySelector('.card-name').textContent + '/' + (c.querySelector('.card-kind')?.textContent ?? ''))));
    check(`${L}: Moppetopia's row is its three maps, top maps first, then All 3 maps`, cards[0].join('|') === 'Moppetopia Space Map/a picture|Moppetopia: layout/a layout · 3D|MoppetopiaMap/a picture|All 3 maps/every map, by name', cards[0].join('|'));
    check(`${L}: Sikelia's row is its top maps first, six cards, then All 214 maps`, cards[1].length === 7 && cards[1][0] === 'Sikelia/a picture' && cards[1][1].startsWith('Sikelia: layout/') && cards[1][6] === 'All 214 maps/every map, by name', cards[1].join('|'));
    check(`${L}: every card has its kind's mark`, (await page.locator('.demos .map-card:not(.all) svg.mark').count()) === (await page.locator('.demos .map-card:not(.all)').count()));
    check(`${L}: nothing is read from OnlyWorlds`, keel.calls.length === 0, keel.calls.map((c) => c.path).join(', '));
    check(`${L}: no pictures on the home`, (await page.locator('.home img').count()) === 0);
    check(`${L}: Sign in with OnlyWorlds is offered on the registered origin, with the id and the key`, (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 1 && (await page.locator('#world-id').count()) === 1 && (await page.locator('#world-key').count()) === 1);
    const widths = await page.evaluate(() => {
      const ul = document.querySelectorAll('.demos .cards')[1];
      const li = ul.querySelector('li');
      return { page: document.scrollingElement.scrollWidth, vw: innerWidth, ul: ul.clientWidth, scroll: ul.scrollWidth, li: li.getBoundingClientRect().width, overflowX: getComputedStyle(ul).overflowX };
    });
    check(`${L}: the page never scrolls sideways`, widths.page <= widths.vw, JSON.stringify(widths));
    check(`${L}: Sikelia's row scrolls sideways inside itself`, widths.scroll > widths.ul && widths.overflowX === 'auto', JSON.stringify(widths));
    if (phone) {
      const shown = widths.ul / widths.li;
      check(`${L}: two and a half cards show on a phone`, shown > 2.3 && shown < 2.75, `${shown.toFixed(2)} cards in view (${JSON.stringify(widths)})`);
    }
    await shot('stranger-home');
    const h0 = await page.evaluate(() => history.length);
    await page.click('.demos .world-row >> nth=0 >> .map-card:has(.card-name:text-is("MoppetopiaMap"))');
    await page.waitForFunction(() => window.__mapper.scene?.complete, null, { timeout: 30_000 });
    check(`${L}: a card opens its map by a push`, (await page.evaluate(() => location.search)) === `?world=${M}&map=${M_MAP}` && (await page.evaluate(() => history.length)) === h0 + 1, await page.evaluate(() => location.search));
    check(`${L}: the demo world is read without a sign-in`, keel.calls.length > 0 && keel.calls.every((c) => c.bearer === null));
    await page.goBack();
    await page.waitForSelector('.demos .world-row');
    check(`${L}: Back returns to the home`, (await page.evaluate(() => location.pathname + location.search)) === '/' && (await demoNames(page)).length === 3);
    check(`${L}: no page error`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  });

  // B. The round trip with keel's consent page: the exchange first and alone, the address replaced,
  // the token in memory only; the home of the person's worlds, each read on the token.
  await section('B', async () => {
    const { ctx, page, keel, errors, consoleText, shot } = await session();
    const L = `${vp} signed in`;
    await page.goto(`${PROD}/`);
    await page.waitForSelector('.demos .world-row');
    keel.holdToken = true;
    await mark(page);
    await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).click();
    await page.waitForSelector('#go', { timeout: 15_000 });
    check(`${L}: the first sign-in shows keel's consent page`, keel.consentShown === 1);
    await page.click('#go');
    await waitFor(() => keel.tokenAsked === 1, 10_000);
    await page.waitForTimeout(400);
    const during = await page.evaluate(() => ({ text: document.body.innerText, href: location.href, buttons: document.querySelectorAll('main button, main a, main input').length }));
    const before = keel.calls.filter((c) => c.path !== '/signin/authorize' && c.path !== '/api/v2/auth/token' && c.m !== 'OPTIONS');
    check(`${L}: on the callback the exchange runs first and alone, "Signing in…" with nothing to press`, before.length === 0 && during.text.includes('Signing in…') && during.buttons === 0, JSON.stringify({ before: before.map((c) => c.path), during }));
    check(`${L}: the callback's address is replaced at once, its code gone`, during.href === `${PROD}/`, during.href);
    keel.releaseToken();
    await settled(page);
    await page.waitForSelector('.mine .world-row');
    const token = tokenOf(keel);
    check(`${L}: the home says who is signed in, offers Sign out, and no second Sign in`, (await page.textContent('.who')).includes('Signed in as wren.') && (await page.getByRole('button', { name: 'Sign out' }).count()) === 1 && (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 0);
    check(`${L}: the page says it only reads and how long the sign-in lives`, (await page.textContent('.mine .hint')).includes('only reads and never makes keys'));
    check(`${L}: the person's worlds, owned then joined, each A to Z`, (await mineNames(page)).join('|') === 'beta|Moppetopia|Saltmere Coast|Alpha Shared|Old Guild', (await mineNames(page)).join('|'));
    const roles = await page.locator('.mine .world-role').allTextContents();
    check(`${L}: each row says what the world is to them`, roles.join('|') === 'yours|yours|yours|a member (contributor)|a member (guest)', roles.join('|'));
    await page.waitForFunction(() => document.querySelectorAll('.mine .world-row .cards:not([hidden]), .mine .world-row.folded, .mine .world-status.failure').length >= 5, null, { timeout: 15_000 });
    const rows = await page.$$eval('.mine .world-row', (els) => els.map((e) => ({ name: e.querySelector('.world-title-name').textContent, folded: e.classList.contains('folded'), status: e.querySelector('.world-status:not([hidden])')?.textContent ?? '', cards: [...e.querySelectorAll('.card-name')].map((c) => c.textContent) })));
    const row = (n) => rows.find((r) => r.name === n);
    check(`${L}: a world with no maps folds to one line`, row('beta').folded && row('beta').status === 'No maps this reader can see.', JSON.stringify(row('beta')));
    check(`${L}: a world on the list it can no longer read says so in its row, with Try again`, row('Old Guild').status.startsWith('OnlyWorlds no longer lets this account read this world.') && (await page.locator('.mine .world-row[data-world="' + OLD + '"] .retry').count()) === 1, JSON.stringify(row('Old Guild')));
    check(`${L}: a top map first, then All 2 maps`, row('Saltmere Coast').cards.join('|') === 'Harbour plan|Old town|All 2 maps', row('Saltmere Coast').cards.join('|'));
    check(`${L}: a demo world the person owns is shown once, in their own rows`, (await demoNames(page)).join('|') === 'Sikelia|Blood Meridian: the scalp country, 1849-50' && row('Moppetopia').cards.length === 4, (await demoNames(page)).join('|'));
    const reads = keel.calls.filter((c) => c.m === 'GET' && c.path.startsWith('/api/v2/'));
    check(`${L}: every read carries the token as the bearer`, reads.length > 0 && reads.every((c) => c.bearer === token), reads.filter((c) => c.bearer !== token).map((c) => c.path + c.q).join(', '));
    check(`${L}: the account's worlds are read once, each row's maps once, never a /me`, reads.filter((c) => c.path === '/api/v2/account/worlds').length === 1 && reads.filter((c) => c.path === '/api/v2/map/').length === 5 && !reads.some((c) => c.path.includes('/me')), reads.map((c) => c.path).join(', '));
    check(`${L}: the home's reads run one at a time`, keel.most <= 1, `${keel.most} at once`);
    const ex = await exposed(page);
    check(`${L}: the token is in no storage, not the address, not the walk window, not the page`, !JSON.stringify(ex).includes(token) && Object.keys(ex.session).length === 0, Object.keys(ex.local).join(','));
    check(`${L}: the record and its stamp are gone after the return`, Object.keys(ex.local).filter((k) => k.startsWith('ow_signin') || k.startsWith('mapper.signin')).length === 0, Object.keys(ex.local).join(','));
    check(`${L}: the token is in no console line`, !consoleText.some((t) => t.includes(token)));
    await shot('signed-in-home');

    // M5: the demo world on the account's list is read with the token from its own row and from a
    // link, and the Maps list the home read is handed to the world's page.
    const n0 = keel.calls.length;
    await page.click(`.mine .world-row[data-world="${SALT}"] .map-card:has(.card-name:text-is("Harbour plan"))`);
    await page.waitForFunction(() => window.__mapper.scene?.complete, null, { timeout: 15_000 });
    const salt = keel.calls.slice(n0).filter((c) => c.world === SALT);
    check(`${L}: an own world's card opens its map on the token, its Maps list not read again`, salt.every((c) => c.bearer === token) && !salt.some((c) => c.path === '/api/v2/map/') && (await page.textContent('.map-name')) === 'Harbour plan', salt.map((c) => c.path).join(', '));
    await page.goBack();
    await page.waitForSelector('.mine .world-row');
    const n1 = keel.calls.length;
    await page.fill('#world-id', M);
    await page.click('.open-form button[type=submit]');
    await page.waitForSelector('.map-row');
    const mop = keel.calls.slice(n1).filter((c) => c.world === M);
    check(`${L}: the demo world on the list, opened by its id, is read on the token as its owner`, mop.length > 0 && mop.every((c) => c.bearer === token) && (await page.textContent('main')).includes('Read with your sign-in, as the world’s owner.'), mop.map((c) => `${c.path} ${c.bearer ? 'token' : 'keyless'}`).join(', '));
    await page.goBack();
    await page.waitForSelector('.mine .world-row');
    await page.click(`.mine .world-row[data-world="${JOIN}"] .map-card.all`);
    await page.waitForSelector('.map-row');
    check(`${L}: a joined world reads as a member, from the list's role`, (await page.textContent('main')).includes('Read with your sign-in, as a member (contributor).') && !keel.calls.some((c) => c.path.includes('/me')));
    // An element no Pin places keeps its line, with the world's maps under it, one press into any.
    await page.evaluate((u) => {
      history.pushState(null, '', u);
      dispatchEvent(new PopStateEvent('popstate'));
    }, `/?world=${SALT}&type=location&element=${NOPIN}`);
    await page.waitForSelector('.element-maps .map-row');
    const el = await page.evaluate(() => ({ text: document.querySelector('main').innerText, rows: [...document.querySelectorAll('.element-maps .row-name')].map((e) => e.textContent) }));
    check(`${vp} an element on no map keeps its line and lists the world's maps`, el.text.includes('The Drowned Bell') && el.text.includes('No Pin places this element on any map this reader can see.') && el.rows.join('|') === 'Harbour plan|Old town', JSON.stringify(el));
    await page.click('.element-maps .map-row:has(.row-name:text-is("Old town"))');
    await page.waitForFunction(() => window.__mapper.scene?.complete, null, { timeout: 15_000 });
    check(`${vp} one press opens any of them`, (await page.textContent('.map-name')) === 'Old town' && (await page.evaluate(() => location.search)) === `?world=${SALT}&map=${S2}`);
    check(`${L}: no world off the account's list was read with the token`, keel.offList.length === 0, keel.offList.join(', '));
    await page.evaluate(() => {
      history.pushState(null, '', '/');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForSelector('.mine .world-row');
    if (phone) {
      const w = await page.evaluate(() => ({ page: document.scrollingElement.scrollWidth, vw: innerWidth }));
      check(`${L}: the page never scrolls sideways on a phone`, w.page <= w.vw, JSON.stringify(w));
    }

    // Sign out: the token removed by its id with itself as the bearer, the answer the read-back.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForSelector('.said:has-text("Signed out")', { timeout: 15_000 });
    const del = keel.calls.filter((c) => c.m === 'DELETE');
    check(`${L}: Sign out deletes the token by its id, the token the bearer, one call`, del.length === 1 && del[0].path === '/api/v2/account/tokens/tok-1' && del[0].bearer === token && !keel.calls.some((c) => c.path === '/api/v2/account/tokens/' && c.m === 'GET'));
    check(`${L}: and says it is removed, with the shared-computer line`, (await page.textContent('.said')).startsWith(SIGNED_OUT) && (await page.textContent('.said')).includes('sign out of onlyworlds.com too'));
    check(`${L}: the home is a stranger's again`, (await page.locator('.mine').count()) === 0 && (await demoNames(page)).length === 3 && (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 1);
    check(`${L}: no page error`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  });

  // C. Back after a sign-in through the consent page, a consented sign-in (no new history entry),
  // a reload, a page from the back/forward cache, and a token that lands while the page leaves.
  await section('C', async () => {
    const { ctx, page, keel, errors } = await session();
    const L = `${vp} leaving`;
    await page.goto(`${PROD}/`);
    await signIn(page);
    await page.waitForSelector('.mine .world-row');
    const t1 = tokenOf(keel, 0);
    await mark(page);
    await page.goBack();
    await page.waitForFunction(() => !window.__old && (location.hostname === 'www.onlyworlds.com' || (!!window.__mapper && !document.body.innerText.includes('Signing in…'))), null, { timeout: 15_000 });
    if (page.url().startsWith('https://www.onlyworlds.com/')) {
      check(`${L}: Back met keel's page, nothing traded`, keel.minted === 1);
    } else {
      const said = (await page.textContent('.said').catch(() => '')) ?? '';
      check(`${L}: Back into a used sign-in says so plainly, never "another tab"`, said.startsWith(ALREADY) && !said.includes('another tab') && keel.minted === 1, said);
      check(`${L}: and offers Sign in again, signed out`, (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 1 && !(await signedIn(page)));
    }
    await leftRevoke(L, page, keel, t1, 'Back');

    // A sign-in with consent kept: keel answers at once, and the round trip adds no history entry.
    await page.goto(`${PROD}/`);
    await page.waitForSelector('.demos .world-row');
    const h0 = await page.evaluate(() => history.length);
    await signIn(page);
    await page.waitForSelector('.mine .world-row');
    const h1 = await page.evaluate(() => history.length);
    check(`${L}: a consented sign-in leaves for keel by replace: no new history entry`, keel.consentShown === 1 && h1 === h0 && (await signedIn(page)), `${h0} -> ${h1}, consent shown ${keel.consentShown}`);

    // A reload asks again, and the token is revoked as the page goes.
    const t2 = tokenOf(keel, keel.minted - 1);
    await page.reload({ waitUntil: 'commit' });
    await page.waitForSelector('.demos .world-row');
    check(`${L}: a reload is signed out`, !(await signedIn(page)) && (await page.locator('.mine').count()) === 0 && (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 1);
    await leftRevoke(L, page, keel, t2, 'a reload');

    // Leaving for another site and coming Back.
    await signIn(page);
    await page.waitForSelector('.mine .world-row');
    const t3 = tokenOf(keel, keel.minted - 1);
    await page.goto(`${OTHER}/`);
    await page.goBack();
    await page.waitForSelector('.demos .world-row', { timeout: 15_000 });
    check(`${L}: Back from another site is signed out`, !(await signedIn(page)));
    await leftRevoke(L, page, keel, t3, 'leaving for another site');

    // The back/forward cache's own branch (Playwright's pages never take it): played by a synthetic
    // pagehide and pageshow with persisted, a claim about the handler, not about an engine's cache.
    await signIn(page);
    await page.waitForSelector('.mine .world-row');
    const t4 = tokenOf(keel, keel.minted - 1);
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.waitForSelector(`.said:has-text("${LEFT}")`, { timeout: 15_000 });
    check(`${L}: a page back from the cache signs out and says why`, !(await signedIn(page)) && (await page.locator('.mine').count()) === 0);
    check(`${L}: the token it held is revoked`, await waitFor(() => keel.tokens.get(t4)?.revoked === true));

    // A token whose exchange ends after the page began to leave is revoked on arrival.
    await page.evaluate(() => localStorage.removeItem('__walk_fetch'));
    keel.holdToken = true;
    const asked = keel.tokenAsked;
    await mark(page);
    await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).click();
    await waitFor(() => keel.tokenAsked > asked, 10_000);
    await page.waitForFunction(() => !window.__old && document.body.innerText.includes('Signing in…'), null, { timeout: 10_000 });
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    keel.releaseToken();
    const t5 = await (async () => {
      await waitFor(() => keel.minted >= 5, 5000);
      return tokenOf(keel, keel.minted - 1);
    })();
    check(`${L}: a token that lands while the page leaves is revoked on arrival`, await waitFor(() => keel.tokens.get(t5)?.revoked === true), `minted ${keel.minted}`);
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })));
    await page.waitForSelector(`.said:has-text("${LEFT}")`, { timeout: 15_000 });
    check(`${L}: and the page is signed out, saying why`, !(await signedIn(page)));
    check(`${L}: no page error`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  });

  // D. The sign-in ends mid-session (revoked in Account settings): one line, never a failure per row;
  // the home redraws as a stranger's in place; a map page on the token goes to the home.
  await section('D', async () => {
    const { ctx, page, keel, errors, shot } = await session(MANY);
    const L = `${vp} a member of many worlds`;
    await page.goto(`${PROD}/`);
    await signIn(page);
    await page.waitForSelector('.mine .world-row');
    await page.waitForFunction(() => document.querySelectorAll('.mine .cards:not([hidden])').length > 0, null, { timeout: 15_000 });
    await page.waitForTimeout(600);
    const seen = await page.evaluate(() => [...document.querySelectorAll('.mine .world-row')].filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; }).length);
    const mapReads = () => keel.calls.filter((c) => c.path === '/api/v2/map/').length;
    check(`${L}: only the rows in view and one more are read before a scroll`, mapReads() >= 1 && mapReads() <= seen + 1 && mapReads() < 40, `${mapReads()} Maps reads, ${seen} rows in view`);
    check(`${L}: the home says how many worlds are listed`, (await page.textContent('.mine')).includes('40 worlds, yours first, then the ones you joined.'));
    await shot('many-worlds');
    // Scroll down a little at a time: each row comes into view and is read, one call at a time.
    for (let i = 0; i < 40 && mapReads() < 40; i++) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(120);
    }
    await waitFor(() => mapReads() === 40, 8000);
    check(`${L}: every row is read once it comes into view, one read at a time`, mapReads() === 40 && keel.most <= 1, `${mapReads()} reads, ${keel.most} at once`);
    // The token ends: the next read on it answers 401.
    await page.evaluate(() => window.scrollTo(0, 0));
    keel.tokens.get(tokenOf(keel)).revoked = true;
    const n0 = keel.calls.length;
    await page.fill('#world-id', MANY[3].id);
    await page.click('.open-form button[type=submit]');
    await page.waitForSelector(`.said:has-text("${ENDED}")`, { timeout: 15_000 });
    const after = keel.calls.slice(n0).filter((c) => c.bearer);
    check(`${L}: a 401 on the token ends the sign-in with one line`, (await page.locator(`.said:has-text("${ENDED}")`).count()) === 1 && (await page.locator('.failure, .world-status.failure').count()) === 0, await page.textContent('main'));
    check(`${L}: the map page on the token goes to the home, a stranger's`, (await page.evaluate(() => location.search)) === '' && !(await signedIn(page)) && (await page.locator('.mine').count()) === 0 && (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 1);
    check(`${L}: nothing more is read on the token after its 401`, after.length === 1, after.map((c) => c.path).join(', '));
    check(`${L}: no page error`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  });

  // E. A 401 while the home reads its rows; Sign out with reads in flight.
  await section('E', async () => {
    const { ctx, page, keel, errors } = await session(MANY);
    const L = `${vp} the home's reads`;
    await page.goto(`${PROD}/`);
    keel.delayMs = 300;
    await signIn(page);
    await page.waitForSelector('.mine .world-row');
    await waitFor(() => keel.calls.some((c) => c.path === '/api/v2/map/'), 5000);
    keel.tokens.get(tokenOf(keel)).revoked = true;
    await page.waitForSelector(`.said:has-text("${ENDED}")`, { timeout: 15_000 });
    check(`${L}: a 401 mid-home ends the sign-in once, in place, never a failure per row`, (await page.locator(`.said:has-text("${ENDED}")`).count()) === 1 && (await page.locator('.world-status.failure, .failure').count()) === 0 && (await page.locator('.mine').count()) === 0 && (await demoNames(page)).length === 3 && (await page.evaluate(() => location.pathname + location.search)) === '/');
    const n401 = keel.calls.filter((c) => c.bearer).length;
    await page.waitForTimeout(800);
    check(`${L}: and no read on the token follows`, keel.calls.filter((c) => c.bearer).length === n401);

    // Sign out while rows are being read: the reads stop first, the revoke is sent, nothing paints after.
    await signIn(page);
    await page.waitForSelector('.mine .world-row');
    await waitFor(() => keel.open > 0, 5000);
    const t = tokenOf(keel, keel.minted - 1);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForSelector('.said:has-text("Signed out")', { timeout: 15_000 });
    const del = keel.calls.findIndex((c) => c.m === 'DELETE' && c.bearer === t);
    const later = keel.calls.slice(del + 1).filter((c) => c.bearer === t && c.m === 'GET');
    await page.waitForTimeout(800);
    check(`${L}: Sign out with reads in flight stops them, revokes, and nothing paints after`, del >= 0 && later.length === 0 && (await page.locator('.mine').count()) === 0 && (await page.textContent('.said')).startsWith(SIGNED_OUT), `${later.length} reads after the revoke`);
    keel.delayMs = 0;
    check(`${L}: no page error`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  });

  // F. The edges: Cancel, a world not public offers Sign in back to it, the stale record swept, no storage.
  await section('F', async () => {
    const { ctx, page, keel, errors, shot } = await session();
    const L = `${vp} edges`;
    await page.goto(`${PROD}/`);
    await signIn(page, { consent: 'cancel' });
    await page.waitForSelector('.said', { timeout: 15_000 });
    check(`${L}: Cancel says nothing changed, trades nothing, leaves nothing stored`, (await page.textContent('.said')) === 'Sign-in cancelled: nothing changed.' && !keel.calls.some((c) => c.path === '/api/v2/auth/token') && Object.keys((await exposed(page)).local).filter((k) => !k.startsWith('__walk')).length === 0);

    await page.goto(`${PROD}/?world=${SALT}&map=${S1}`);
    await page.waitForSelector('.key-form');
    check(`${L}: a world that is not public offers Sign in back to it`, (await page.textContent('main')).includes('If this world is yours or you joined it, sign in to open it as yourself.') && (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 1);
    await shot('not-public');
    await signIn(page);
    await page.waitForFunction(() => window.__mapper.scene?.complete, null, { timeout: 15_000 });
    check(`${L}: the sign-in returns to that world's map, read on the token`, (await page.evaluate(() => location.pathname + location.search)) === `/?world=${SALT}&map=${S1}` && (await page.textContent('.map-name')) === 'Harbour plan');

    await page.goto(`${PROD}/`);
    await page.evaluate(() => localStorage.setItem('ow_signin:maps', '{"state":"s","verifier":"v","redirectUri":"x"}'));
    await page.reload({ waitUntil: 'commit' });
    await page.waitForSelector('.demos .world-row');
    check(`${L}: a record with no stamp is swept at load`, (await page.evaluate(() => localStorage.getItem('ow_signin:maps'))) === null);
    await page.evaluate(() => {
      localStorage.setItem('ow_signin:maps', '{"state":"s","verifier":"v","redirectUri":"x"}');
      localStorage.setItem('mapper.signin.at', String(Date.now() - 2 * 3600e3));
    });
    await page.reload({ waitUntil: 'commit' });
    await page.waitForSelector('.demos .world-row');
    check(`${L}: a record older than an hour is swept at load`, (await page.evaluate(() => localStorage.getItem('ow_signin:maps') ?? localStorage.getItem('mapper.signin.at'))) === null);
    check(`${L}: no page error`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();

    const ns = await session(WORLDS, { noStorage: true });
    await ns.page.goto(`${PROD}/`);
    await ns.page.waitForSelector('.demos .world-row');
    await ns.page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).click();
    await ns.page.waitForSelector(`.ways .said:has-text("${NO_STORAGE}")`, { timeout: 10_000 });
    check(`${L}: a browser with no storage is told so, and nothing leaves for keel`, ns.keel.authorized === 0 && ns.page.url() === `${PROD}/`);
    await ns.ctx.close();
  });
}

// Run alone: both viewports in one engine.
if (process.argv[1]?.endsWith('signin.mjs')) {
  const { chromium, firefox } = await import('@playwright/test');
  const which = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
  const FX = '.scratch/fixtures/api.json';
  if (!existsSync(FX)) {
    console.error('No fixtures: run `node walk/record.mjs` after a build first.');
    process.exit(2);
  }
  const fx = JSON.parse(readFileSync(FX, 'utf8'));
  const browser = await (which === 'firefox' ? firefox : chromium).launch();
  const watchdog = setTimeout(() => {
    console.error('signin: watchdog, 600 s');
    process.exit(2);
  }, 600_000);
  let checks = 0;
  const fails = [];
  const check = (label, ok, detail = '') => {
    checks++;
    if (!ok) fails.push(`${which} ${label}${detail ? `: ${detail}` : ''}`);
  };
  const only = process.env.SECTIONS ? process.env.SECTIONS.split(',') : null;
  for (const [vp, opts] of [
    ['desk', { viewport: { width: 1440, height: 900 } }],
    ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3, ...(which === 'chromium' ? { isMobile: true } : {}) }],
  ]) {
    await signinWalk({ browser, which, vp, opts, check, dist: process.env.MAPPER_DIST ?? 'dist', fx, only });
  }
  clearTimeout(watchdog);
  await browser.close();
  console.log(`signin ${which}: ${checks - fails.length} of ${checks} checks passed`);
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(fails.length ? 1 : 0);
}
