// The played walk: the built page against a played OnlyWorlds. Every request to the API is answered
// from the recorded fixtures (walk/record.mjs) or from a small played world made here, none reaches
// the real server; pictures come from the recording too. At a desk and on a 390 px touch phone
// (and the element view at 360 by 640 too). Its section `signin` is walk/signin.mjs: Sign in with
// OnlyWorlds and the home of worlds, played on the registered origin.
//   npm run build && node walk/played.mjs [chromium|firefox]
// Screenshots go to .scratch/shots/. Exits 1 on any failed check. MAPPER_DIST serves another build
// (a control built from an older commit), MAPPER_PORT another port, SECTIONS=9,12 only those.
import { chromium, firefox } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { GROUP_COLORS } from '@onlyworlds/sdk';
import { colourStats, decodePng } from './png.mjs';
import { serve } from './serve.mjs';
import { signinWalk } from './signin.mjs';
import { keyOf, MOPPETOPIA as M, SIKELIA as S, M_MAP, M_SPACE, M_LAYOUT, S_BIG, S_LAYOUT, S_ELEMENT, M_ELEMENT, AT } from './worlds.mjs';

const which = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const engine = which === 'firefox' ? firefox : chromium;
const DIST = process.env.MAPPER_DIST ?? 'dist';
const PORT = Number(process.env.MAPPER_PORT ?? 4187);
/** SECTIONS=9,12 walks only those sections (each starts from an address). */
const ONLY = process.env.SECTIONS ? process.env.SECTIONS.split(',') : null;
const FX = '.scratch/fixtures/api.json';
if (!existsSync(FX)) {
  console.error('No fixtures: run `node walk/record.mjs` after a build first.');
  process.exit(2);
}
const fx = JSON.parse(readFileSync(FX, 'utf8'));
mkdirSync('.scratch/shots', { recursive: true });

// The played world for what the public worlds do not hold: a stranger's markup as names, a picture
// on plain http, a world that is not public, an element that is not there.
const NOPE = '22222222-2222-7222-8222-222222222222';
const H = '33333333-3333-7333-8333-333333333333';
const HM = '33333333-3333-7333-8333-000000000001';
const HC = '33333333-3333-7333-8333-000000000002';
const HP = '33333333-3333-7333-8333-000000000003';
const GONE = '44444444-4444-7444-8444-444444444444';
// A world of a stranger's shapes: one Pin and one Marker far past the frame (x 100000 on a 1000
// map), a Map with no written size whose picture comes at once, a Map with a very long name.
const F = '55555555-5555-7555-8555-555555555555';
const fid = (n) => `55555555-5555-7555-8555-${String(n).padStart(12, '0')}`;
const F_FAR = fid(1);
const F_NOSIZE = fid(2);
const F_LONG = fid(3);
// A layout with a depth and no written size: its frame comes from its Pins, and the element view
// knows only its own Pin until the map's read brings the far one (a stand-in frame, then the real one).
const F_DEEP = fid(4);
const F_NEAR = fid(10);
const F_AWAY = fid(11);
const F_ZONE = fid(20);
const LONG_NAME = 'Long '.repeat(600);
const PICTURE = 'https://media.onlyworlds.com/worlds/moppetopia/maps/moppetopia.webp';
const json = (status, body, headers = {}) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'RateLimit-Reset', ...headers }, body: JSON.stringify(body) });
const page1 = (data) => json(200, { data, has_more: false, next_cursor: null });
const fPin = (n, map, el, x, y) => ({ id: fid(n), type: 'pin', name: 'pin', map, element_type: 'location', element_id: el, x, y });
function playedF(u) {
  const p = u.pathname;
  const map = u.searchParams.get('map');
  const element = u.searchParams.get('element');
  const on = (rows) => page1(rows.filter((r) => (!map || r.map === map) && (!element || r.element_id === element)));
  if (p.startsWith('/api/v2/world')) return json(200, { id: F, name: 'Shapes', counts: { total: 12, types: { map: 4, pin: 6, location: 2 } } });
  if (p.startsWith('/api/v2/map')) return page1([
    { id: F_FAR, type: 'map', name: 'Far Pin', width: 1000, height: 1000 },
    { id: F_NOSIZE, type: 'map', name: 'No size', image_url: PICTURE },
    { id: F_LONG, type: 'map', name: LONG_NAME, width: 1000, height: 800 },
    { id: F_DEEP, type: 'map', name: 'Deep, no size', depth: 1000, x_layout: { method: 'played' } },
  ]);
  if (p.startsWith('/api/v2/pin')) return on([fPin(30, F_FAR, F_NEAR, 100, 100), fPin(31, F_FAR, F_AWAY, 100000, 100000), fPin(32, F_NOSIZE, F_NEAR, 300, 300), fPin(33, F_LONG, F_NEAR, 500, 400), { ...fPin(34, F_DEEP, F_NEAR, 100, 100), z: 50 }, { ...fPin(35, F_DEEP, F_AWAY, 5000, 4000), z: 900 }]);
  if (p.startsWith('/api/v2/marker')) return on([
    { id: fid(40), type: 'marker', map: F_FAR, zone: F_ZONE, x: 200, y: 200, order: 0 },
    { id: fid(41), type: 'marker', map: F_FAR, zone: F_ZONE, x: 100000, y: 300, order: 1 },
    { id: fid(42), type: 'marker', map: F_FAR, zone: F_ZONE, x: 300, y: 600, order: 2 },
  ]);
  if (p.startsWith('/api/v2/zone')) return page1([{ id: F_ZONE, type: 'zone', name: 'Far reach', shape: 'polygon' }]);
  if (p.startsWith('/api/v2/location')) return page1([{ id: F_NEAR, type: 'location', name: 'Near', parent_location: F_AWAY }, { id: F_AWAY, type: 'location', name: 'Away' }]);
  return null;
}
function played(url) {
  const u = new URL(url);
  const w = u.searchParams.get('world');
  if (u.pathname.startsWith('/api/v2/world') && w === NOPE) return json(404, { error: { code: 'not_found', message: 'World not found.' } });
  if (u.pathname.includes(`/location/${GONE}`)) return json(404, { error: { code: 'not_found', message: 'Not found.' } });
  if (w === F) return playedF(u);
  if (w !== H) return null;
  const p = u.pathname;
  if (p.startsWith('/api/v2/world')) return json(200, { id: H, name: '<img src=x onerror="window.__pwned=1">', counts: { total: 3, types: { map: 1, pin: 1, character: 1 } } });
  if (p.startsWith('/api/v2/map')) return page1([{ id: HM, type: 'map', name: '<script>window.__pwned=2</script>Harbour', width: 1000, height: 800, image_url: 'http://media.example/x.png' }]);
  if (p.startsWith('/api/v2/pin')) return page1([{ id: HP, type: 'pin', name: 'pin', map: HM, element_type: 'character', element_id: HC, x: 500, y: 400 }]);
  if (p.startsWith('/api/v2/marker')) return page1([]);
  if (p.startsWith('/api/v2/character')) return page1([{ id: HC, type: 'character', name: '<b onmouseover="window.__pwned=3">Bold</b>' }]);
  return null;
}

let checks = 0;
const fails = [];
function check(label, ok, detail = '') {
  checks++;
  // SHOW=1 prints every check with what it measured, passed or not.
  if (process.env.SHOW) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${which} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) fails.push(`${which} ${label}${detail ? `: ${detail}` : ''}`);
}

// Playwright's Firefox touch emulation (a coarse pointer) does not survive the browsing-context-group
// swap that Cross-Origin-Opener-Policy: same-origin makes, so under the host's own headers the
// Firefox phone would be a narrow desk. A real phone's pointer is its own: for Firefox only, the
// walk's server leaves that one header out.
const site = await serve(DIST, PORT, '127.0.0.1', { drop: which === 'firefox' ? ['Cross-Origin-Opener-Policy'] : [] });
const browser = await engine.launch().catch((e) => {
  const none = /Executable doesn't exist/.test(String(e?.message));
  console.error(none ? `No ${which} for Playwright here: run "npx playwright install chromium firefox" first.` : String(e?.message ?? e));
  process.exit(2);
});
const watchdog = setTimeout(() => {
  console.error('played: watchdog, 900 s');
  process.exit(2);
}, 900_000);
const unplayed = [];
const measures = {};

for (const [vp, opts] of [
  ['desk', { viewport: { width: 1440, height: 900 } }],
  ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3, ...(which === 'chromium' ? { isMobile: true } : {}) }],
]) {
  const phone = vp === 'phone';
  const ctx = await browser.newContext(opts);
  // The picture's decodes: createImageBitmap calls by what they decode (a Blob or an image is the
  // full source; a bitmap is a copy made from a copy).
  await ctx.addInitScript(() => {
    const real = window.createImageBitmap;
    window.__decodes = [];
    window.createImageBitmap = function (src, ...rest) {
      const o = rest.find((x) => x && typeof x === 'object' && 'resizeWidth' in x);
      window.__decodes.push({ from: src instanceof Blob || src instanceof HTMLImageElement ? 'source' : 'copy', w: o?.resizeWidth ?? null });
      return real.call(this, src, ...rest);
    };
  });
  // Faults, each used once: a key part and how to answer it.
  const faults = [];
  // Every request in order, and a delay for the answers when a check needs reads to take time.
  const sent = [];
  let slowMs = 0;
  await ctx.route('https://www.onlyworlds.com/**', async (route) => {
    const url = route.request().url();
    const k = keyOf(url);
    sent.push(k);
    const answer = (a) => {
      // Playwright runs route handlers one at a time: a delay answers from an unawaited timer.
      if (slowMs > 0) setTimeout(() => route.fulfill(a).catch(() => {}), slowMs);
      else return route.fulfill(a);
    };
    const f = faults.findIndex((x) => k.includes(x.match));
    if (f >= 0) {
      const [fault] = faults.splice(f, 1);
      if (fault.abort) return route.abort('failed');
      if (fault.delayMs) {
        setTimeout(() => route.fulfill(fault.answer).catch(() => {}), fault.delayMs);
        return;
      }
      return route.fulfill(fault.answer);
    }
    const p = played(url);
    if (p) return answer(p);
    const hit = fx.api[k];
    if (hit) return answer({ status: hit.status, contentType: hit.type, headers: { 'access-control-allow-origin': '*' }, body: hit.body });
    unplayed.push(k);
    return route.fulfill(json(599, { error: { code: 'unplayed', message: 'not in the fixtures' } }));
  });
  await ctx.route('https://media.onlyworlds.com/**', async (route) => {
    const m = fx.media[route.request().url()];
    if (!m) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: m.type, headers: { 'access-control-allow-origin': '*' }, body: readFileSync(`.scratch/fixtures/media/${m.file}`) });
  });
  await ctx.route('http://media.example/**', (route) => route.abort('failed'));
  // A read whose body stalls after its headers (an ordinary phone-network failure): opened first, on
  // a page of its own, and read at the end, after the time limit has passed. Its body sends a little
  // and then waits; only an abort ends it.
  const stall = await ctx.newPage();
  await stall.addInitScript((world) => {
    const real = window.fetch.bind(window);
    let stalled = false;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!stalled && url.includes(`world=${world}`) && url.includes('/api/v2/map/')) {
        stalled = true;
        return Promise.resolve(new Response(new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"data":['));
            init?.signal?.addEventListener('abort', () => c.error(init.signal.reason ?? new DOMException('aborted', 'AbortError')));
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return real(input, init);
    };
  }, M);
  const stallOpened = Date.now();
  await stall.goto(`${site.url}/?world=${M}`);

  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/^Failed to load resource|CORS request did not succeed/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  let shot = 0;
  const snap = async (name) => page.screenshot({ path: `.scratch/shots/played-${which}-${vp}-${String(++shot).padStart(2, '0')}-${name}.png` });
  const complete = async () => {
    try {
      await page.waitForFunction(() => window.__mapper.scene?.complete, null, { timeout: 60_000 });
    } catch (e) {
      const said = await page.textContent('main').catch(() => '');
      throw new Error(`no complete map at ${page.url()}: "${said.slice(0, 300)}"; unplayed ${[...new Set(unplayed)].join(', ')}`);
    }
  };
  // The address as the page holds it (Playwright's page.url() can trail a replaceState).
  const where = () => page.evaluate(() => location.search);
  const mapper = (expr, arg) => page.evaluate(expr, arg);
  const press = async (x, y) => (phone ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  // A section that throws is a failed check, and the walk goes on to the next section (each starts
  // from an address or from the page the one before it left).
  const section = async (name, fn) => {
    if (ONLY && !ONLY.includes(name)) return;
    try {
      await fn();
    } catch (e) {
      check(`${vp} section ${name} ran to its end`, false, String(e?.message ?? e).split('\n')[0].slice(0, 300));
    }
  };

  // 1. The front page, and an id that is not one: said, nothing read.
  await section('1', async () => {
    await page.goto(`${site.url}/`);
    await page.fill('#world-id', 'not-an-id');
    await page.click('.open-form button[type=submit]');
    check(`${vp} a malformed id is said`, (await page.textContent('.intro .error')).includes('This is not a world id'));
    await snap('front');
  });

  // home. The home on an origin that is not the registered one: the demo worlds from the page itself
  // (nothing read), the ways in without Sign in (its return would land on another origin).
  await section('home', async () => {
    const n0 = sent.length;
    await page.goto(`${site.url}/`);
    await page.waitForSelector('.demos .world-row');
    await page.waitForTimeout(300);
    const names = await page.locator('.demos .world-title-name').allTextContents();
    check(`${vp} the home shows the three demo worlds as rows of map cards`, names.length === 3 && (await page.locator('.demos .map-card').count()) >= 10, names.join('|'));
    check(`${vp} the stranger's home reads nothing from OnlyWorlds`, sent.length === n0, sent.slice(n0).join(', '));
    check(`${vp} Sign in is offered only on the registered origin`, (await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count()) === 0 && (await page.locator('#world-id').count()) === 1);
    await snap('home');
  });

  // callback. The host's rule for the callback, read on the walk's server, which answers as the
  // host does: the mapper's page at /signin/callback, never cached, no Referer; any other unknown
  // path the 404 page, never the app.
  await section('callback', async () => {
    if (phone) return;
    const r = await fetch(`${site.url}/signin/callback?code=x&state=y`, { redirect: 'manual' });
    const body = await r.text();
    check('the callback path answers 200 with the mapper\'s own page', r.status === 200 && /<script type="module"[^>]*src="\/assets\//.test(body) && body.includes('id="app"'), `${r.status} ${body.slice(0, 80)}`);
    check('the callback is never cached and sends no Referer', r.headers.get('cache-control') === 'no-store' && r.headers.get('referrer-policy') === 'no-referrer', `${r.headers.get('cache-control')} / ${r.headers.get('referrer-policy')}`);
    const slash = await fetch(`${site.url}/signin/callback/?code=x&state=y`, { redirect: 'manual' });
    check('the callback with a slash is the host\'s redirect to it, the query kept', slash.status === 307 && slash.headers.get('location') === '/signin/callback?code=x&state=y', `${slash.status} ${slash.headers.get('location')}`);
    const nope = await fetch(`${site.url}/nothing`);
    check('any other unknown path is the 404 page, never the app', nope.status === 404 && (await nope.text()).includes('There is no page at this address'), String(nope.status));
    // As the host answers (read live): paths are case-exact, and needless escapes redirect first.
    const cased = await fetch(`${site.url}/Signin/callback?code=x&state=y`, { redirect: 'manual' });
    check('the callback path is case-exact: /Signin/callback is the 404 page', cased.status === 404, String(cased.status));
    const escaped = await fetch(`${site.url}/signin/%63allback?code=x&state=y`, { redirect: 'manual' });
    check('an escaped callback path redirects to its plain form, the query kept', escaped.status === 307 && escaped.headers.get('location') === '/signin/callback?code=x&state=y', `${escaped.status} ${escaped.headers.get('location')}`);
  });

  // 2. A world that is not public, or not there: one sentence and the key form.
  await section('2', async () => {
    await page.goto(`${site.url}/?world=${NOPE}`);
    await page.waitForSelector('.key-form');
    check(`${vp} a 404 world says it may be mistyped or private`, (await page.textContent('main')).includes('No public world has this id. It may be mistyped, or private: paste a key to open it.'));
    // The key field is a password field (assistive technology reads it masked) outside any form
    // (no submitted login for a browser to offer to save), with a Show that toggles it.
    const field = await mapper(() => { const i = document.querySelector('#world-key'); return { type: i.type, form: !!i.closest('form'), auto: i.autocomplete }; });
    check(`${vp} the key field is masked to assistive technology and outside any form`, field.type === 'password' && !field.form && field.auto === 'off', JSON.stringify(field));
    await page.click('.key-form .show-key');
    const shown = await mapper(() => document.querySelector('#world-key').type);
    await page.click('.key-form .show-key');
    check(`${vp} Show shows the key and hides it again`, shown === 'text' && (await mapper(() => document.querySelector('#world-key').type)) === 'password');
    await page.fill('#world-key', '1234567890');
    await page.click('.key-form .open-key');
    check(`${vp} a legacy key is refused`, (await page.textContent('.key-form .error')).includes('Keys of ten digits are not taken here'));
    await page.fill('#world-key', 'ow_a_notaworldkey');
    await page.press('#world-key', 'Enter');
    check(`${vp} Enter in the key field reads it`, (await page.textContent('.key-form .error')).includes('account token'), await page.textContent('.key-form .error'));
    await snap('not-public');
  });

  // 3. Moppetopia's maps: words, kinds and counts as soon as the reads land.
  await section('3', async () => {
    await page.goto(`${site.url}/?world=${M}`);
    await page.waitForSelector('.map-row');
    await page.waitForFunction(() => document.querySelectorAll('.map-row .row-meta')[0]?.textContent.includes('Pin'));
    const rows = await page.$$eval('.map-row', (els) => els.map((e) => e.textContent));
    check(`${vp} the Maps list`, rows.length === 3 && rows.some((r) => r.includes('MoppetopiaMapa picture · 5 Pins')) && rows.some((r) => r.includes('a layout · 3D · 170 Pins')), JSON.stringify(rows));
    await snap('maps');
  });

  // 4. A pictured map, pressed: the address gains its map by a push.
  await section('4', async () => {
    const histBefore = await mapper(() => history.length);
    await page.click('.map-row:has(.row-name:text-is("MoppetopiaMap"))');
    await complete();
    check(`${vp} pressing a map pushes &map`, (await where()).includes(`map=${M_MAP}`) && (await mapper(() => history.length)) === histBefore + 1);
    const sc = await mapper(() => window.__mapper.scene);
    check(`${vp} the pictured map's list`, sc.counts.pins === 5 && sc.counts.zones === 3 && sc.kinds.picture === 1, JSON.stringify(sc.counts));
    check(`${vp} lines start off on a pictured map`, (await mapper(() => window.__mapper.linesShown)) === false);
    await page.waitForFunction(() => window.__mapper.labels.length > 0);
    await page.waitForTimeout(400);
    await snap('pictured-map');

    // Hover (a mouse only) and press a Pin: the card names it, its type and its mark.
    const pins = await mapper(() => window.__mapper.pins());
    const target = pins.find((p) => p.element === M_ELEMENT) ?? pins[0];
    const pt = await mapper((id) => window.__mapper.screenOf(id), target.id);
    if (!phone) {
      await page.mouse.move(pt.x, pt.y);
      await page.waitForSelector('.tip:not([hidden])');
      check(`${vp} hover names the Pin's element`, (await page.textContent('.tip')) === 'Puddleton', await page.textContent('.tip'));
    }
    await press(pt.x, pt.y);
    await page.waitForSelector('.card h2');
    check(`${vp} a press selects the Pin`, JSON.stringify(await mapper(() => window.__mapper.selection)) === JSON.stringify([target.id]));
    check(`${vp} the card: name, type, mark`, (await page.textContent('.card h2')).includes('Puddleton') && (await page.textContent('.card .type')) === 'Location' && (await page.locator('.card .ow-waymark__mark').count()) === 1);
    check(`${vp} a press writes no address`, (await mapper(() => history.length)) === histBefore + 1 && !(await where()).includes('at='));
    await snap('card');
    await page.click('.card .close');

    // The lines button.
    await page.click('button:has-text("Show links")');
    check(`${vp} the lines button shows the links`, (await mapper(() => window.__mapper.linesShown)) === true && (await page.textContent('.tools')).includes('Hide links'));
    await page.waitForTimeout(200);
    await snap('links-on');

    // The List view: a row per element the Map places.
    await page.click('button:has-text("List")');
    const listRows = await page.locator('.maplist .row').count();
    check(`${vp} the List view has a row per element`, listRows === sc.counts.elements, `${listRows} rows, ${sc.counts.elements} elements`);
    await page.locator('.maplist .row').first().click();
    check(`${vp} a List row selects its element`, (await mapper(() => window.__mapper.selection.length)) >= 1 && (await page.locator('.card h2').count()) >= 1);
    await snap('list');
    await page.click('button:has-text("List")');
    await page.click('.card .close');

    // A drag is the person's gesture: its end writes at by replace, never a new entry.
    const box = await page.locator('canvas.surface').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.7;
    if (!phone) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 60, cy + 30, { steps: 6 });
      await page.mouse.up();
    } else {
      // Playwright has no touch drag (and Firefox's touch emulation sends a mouse drag no pointer
      // events), so one finger is played as touch PointerEvents on the canvas.
      await mapper(([x, y]) => {
        const c = document.querySelector('canvas.surface');
        const ev = (type, dx, dy, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x + dx, clientY: y + dy, buttons }));
        ev('pointerdown', 0, 0, 1);
        for (let i = 1; i <= 6; i++) ev('pointermove', i * 10, i * 5, 1);
        ev('pointerup', 60, 30, 0);
      }, [cx, cy]);
    }
    check(`${vp} a drag writes at by replace`, (await where()).includes('at=') && (await mapper(() => history.length)) === histBefore + 1, await where());
    if (phone) {
      // Two fingers belong to the camera: a pinch apart zooms in, and its end writes at.
      const s0 = (await mapper(() => window.__mapper.camera)).s;
      await mapper(([x, y]) => {
        const c = document.querySelector('canvas.surface');
        const ev = (type, id, primary, px, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', isPrimary: primary, clientX: px, clientY: y, buttons }));
        ev('pointerdown', 21, true, x - 20, 1);
        ev('pointerdown', 22, false, x + 20, 1);
        for (let i = 1; i <= 5; i++) {
          ev('pointermove', 21, true, x - 20 - i * 12, 1);
          ev('pointermove', 22, false, x + 20 + i * 12, 1);
        }
        ev('pointerup', 21, true, x - 80, 0);
        ev('pointerup', 22, false, x + 80, 0);
      }, [cx, cy]);
      const cam = await mapper(() => window.__mapper.camera);
      const at = new URLSearchParams(await where()).get('at');
      check(`${vp} a pinch zooms and its end writes at`, cam.s > s0 * 2.5 && Number(at.split(',')[2]) === Math.round(390 / cam.s), `${s0} -> ${cam.s}, at ${at}`);
    }

    // contextrestored draws again from the list (a synthetic event: no engine lets a test lose a 2D context).
    await mapper(() => document.querySelector('canvas.surface').dispatchEvent(new Event('contextrestored')));
    check(`${vp} contextrestored draws again`, (await mapper(() => window.__mapper.restored)) === 1);

    // Back: to the list, the entry the press pushed is left.
    await page.click('button.back');
    await page.waitForSelector('.map-row');
    check(`${vp} Back returns to the list`, !(await where()).includes('map='));
  });

  // 5. A layout map: lines always, its depth said, its ground drawn.
  await section('5', async () => {
    await page.click('.map-row:has(.row-name:text-is("Moppetopia: layout"))');
    await complete();
    const lay = await mapper(() => window.__mapper.scene);
    check(`${vp} the layout map draws its lines`, (await mapper(() => window.__mapper.linesShown)) === true && lay.counts.lines === 415 && lay.counts.pins === 170, JSON.stringify(lay.counts));
    await page.waitForFunction(() => window.__mapper.view3d?.state === 'on', null, { timeout: 30_000 });
    const status = await page.textContent('.status');
    check(`${vp} the layout opens in 3D and names its ground and its height`, status.includes('In 3D:') && status.includes('Drawn over its ground, the map Moppetopia Space Map') && status.includes('at height 750 in 3D'), status.slice(0, 400));
    check(`${vp} no buttons for lines on a layout`, (await page.locator('button:has-text("Show links")').count()) === 0);
    await page.waitForTimeout(300);
    await snap('layout');
    if (phone) {
      const many = await mapper(() => window.__mapper.pins().slice(0, 1));
      const lp = await mapper((id) => window.__mapper.screenOf(id), many[0].id);
      await page.touchscreen.tap(lp.x, lp.y);
      await page.waitForSelector('.card:not([hidden])');
      await snap('layout-press');
    }
  });

  // 3d. A layout map with a depth in 3D: WebGL draws it with its ground; a press on a projected
  // Pin selects it and a turn selects nothing; Flat and 3D keep the selection and write view=flat or
  // drop it; a reload stays flat; one context at a time; the chunk blocked, or WebGL refused, draws
  // flat with its line and a way back.
  await section('3d', async () => {
    const open = `${site.url}/?world=${M}&map=${M_LAYOUT}`;
    const v3 = () => mapper(() => window.__mapper.view3d);
    const on = () => page.waitForFunction(() => window.__mapper.view3d?.state === 'on', null, { timeout: 30_000 }).catch(async () => {
      throw new Error(`3D never came on at ${await where()}: ${JSON.stringify(await v3())}; ${(await page.textContent('.status').catch(() => '')).slice(0, 200)}`);
    });
    await page.goto(open);
    await complete();
    await on();
    await page.waitForFunction(() => window.__mapper.view3d?.picture, null, { timeout: 30_000 });
    await page.waitForTimeout(400);
    let v = await v3();
    check(`${vp} 3D: one WebGL canvas, the ground's picture on its plane`, v.canvases === 1 && v.made === 1 && v.picture === true, JSON.stringify(v));
    const shotBuf = await page.locator('canvas.surface-3d').screenshot();
    const px = colourStats(decodePng(shotBuf));
    check(`${vp} 3D: the canvas holds a drawing (colours, ground)`, px.colours > 60 && px.unlike > 0.15, JSON.stringify(px));
    await snap('3d');
    // A Pin standing clear of the bar, the zoom buttons and the card's side.
    const vw = page.viewportSize();
    const pins = await mapper(() => window.__mapper.pins());
    let target = null;
    for (const p of pins) {
      const pt = await mapper((id) => window.__mapper.screenOf(id), p.id);
      if (pt && pt.x > 40 && pt.x < vw.width * (phone ? 0.85 : 0.55) && pt.y > vw.height * 0.35 && pt.y < vw.height * (phone ? 0.5 : 0.85)) {
        const near = await mapper(([x, y]) => document.elementFromPoint(x, y)?.className ?? '', [pt.x, pt.y]);
        if (String(near).includes('surface-3d')) {
          target = { ...p, ...pt };
          break;
        }
      }
    }
    check(`${vp} 3D: a Pin stands clear to press`, !!target);
    if (!target) return;
    await press(target.x, target.y);
    await page.waitForSelector('.card:not([hidden])');
    let sel = await mapper(() => window.__mapper.selection);
    check(`${vp} 3D: a press on a projected Pin selects it`, sel.length >= 1 && (phone ? sel.includes(target.id) : sel[0] === target.id), JSON.stringify(sel));
    const before = (await v3()).cam;
    // A turn: one finger or the left button dragged across the map, from a point the map holds (on a
    // phone the sheet covers the lower part).
    let [x0, y0] = [vw.width * 0.3, vw.height * 0.7];
    for (const fy of [0.7, 0.6, 0.5, 0.45, 0.4, 0.35]) {
      const cls = String(await mapper(([x, y]) => document.elementFromPoint(x, y)?.className ?? '', [vw.width * 0.3, vw.height * fy]));
      if (cls.includes('surface-3d')) {
        y0 = vw.height * fy;
        break;
      }
    }
    if (phone && which === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 12, y: y0 - i * 4 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else if (!phone) {
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + i * 12, y0 - i * 4);
      await page.mouse.up();
    }
    if (!phone || which === 'chromium') {
      await page.waitForTimeout(300);
      const after = (await v3()).cam;
      sel = await mapper(() => window.__mapper.selection);
      check(`${vp} 3D: a drag turns the view and selects nothing new`, JSON.stringify(after) !== JSON.stringify(before) && sel.includes(target.id), `${before} -> ${after}; ${sel}`);
      check(`${vp} 3D: the camera is never written`, !(await where()).includes('at='), await where());
    }
    if (!phone) {
      // The hover's cursor shows on the canvas drawn; Escape on the card hands focus back to it.
      await page.mouse.move(target.x, target.y);
      await page.waitForTimeout(150);
      check(`${vp} 3D: a hovered Pin shows the pointer cursor`, (await page.evaluate(() => document.querySelector('canvas.surface-3d').style.cursor)) === 'pointer');
      await page.focus('.card .close');
      await page.keyboard.press('Escape');
      check(`${vp} 3D: Escape on the card hands the keyboard back to the 3D map`, String(await page.evaluate(() => document.activeElement?.className ?? '')).includes('surface-3d'), await page.evaluate(() => document.activeElement?.tagName));
      await press(target.x, target.y);
      await page.waitForSelector('.card:not([hidden])');
    }
    const kept = await mapper(() => window.__mapper.selection);
    // Flat keeps the selection and the card, writes view=flat, and lets the context go.
    await page.click('button.view-toggle');
    v = await v3();
    check(`${vp} Flat: drawn flat, the 3D canvas gone`, v.state === 'off' && v.canvases === 0, JSON.stringify(v));
    check(`${vp} Flat: view=flat by replace, no at`, (await where()).includes('view=flat') && !(await where()).includes('at='), await where());
    check(`${vp} Flat: the selection and the card carried`, JSON.stringify(await mapper(() => window.__mapper.selection)) === JSON.stringify(kept) && (await page.isVisible('.card')));
    await snap('3d-flat');
    // 3D again: the same selection, a second surface, still one canvas.
    await page.click('button.view-toggle');
    await on();
    v = await v3();
    check(`${vp} 3D again: one canvas, the selection carried, view dropped`, v.canvases === 1 && v.made === 2 && JSON.stringify(await mapper(() => window.__mapper.selection)) === JSON.stringify(kept) && !(await where()).includes('view='), JSON.stringify(v));
    // A reload with view=flat stays flat.
    await page.click('button.view-toggle');
    await page.reload();
    await complete();
    await page.waitForTimeout(300);
    v = await v3();
    check(`${vp} a reload with view=flat stays flat`, v.state === 'off' && v.canvases === 0 && (await page.textContent('button.view-toggle')) === '3D', JSON.stringify(v));
    // A flat camera in the address (a link from the flat build) is dropped when 3D draws.
    await page.goto(`${open}&at=1200,800,600`);
    await on();
    check(`${vp} 3D drops a flat camera's at from the address`, !(await where()).includes('at='), await where());
    // Leaving the map (in 3D since the address above) lets its context go.
    check(`${vp} 3D is on before leaving`, (await v3()).canvases === 1);
    await page.click('button.back');
    await page.waitForTimeout(200);
    check(`${vp} leaving a 3D map leaves no 3D canvas`, (await page.locator('canvas.surface-3d').count()) === 0);

    // The 3D code cannot be fetched: flat, said; Try again reloads the page, and 3D draws once the code
    // can be fetched. The control: an import again inside the same page stays failed (the browser
    // keeps a failed module), which is why Try again reloads.
    const blocked = await ctx.newPage();
    let block = true;
    let chunkUrl = null;
    await blocked.route('**/assets/three3d-*.js', (r) => {
      chunkUrl = r.request().url();
      return block ? r.abort('failed') : r.continue();
    });
    await blocked.goto(open);
    await blocked.waitForFunction(() => window.__mapper.view3d?.state === 'failed', null, { timeout: 30_000 });
    const line = await blocked.textContent('.line3d');
    check(`${vp} chunk blocked: drawn flat, said, Try again reloads`, line.includes('The 3D view did not load; drawn flat. Try again reloads the page.') && (await blocked.locator('canvas.surface-3d').count()) === 0, line);
    await blocked.waitForFunction(() => window.__mapper.scene?.complete, null, { timeout: 60_000 });
    const flatPx = colourStats(decodePng(await blocked.locator('canvas.surface-flat').screenshot()));
    check(`${vp} chunk blocked: the flat map is drawn`, flatPx.colours > 30, JSON.stringify(flatPx));
    await blocked.screenshot({ path: `.scratch/shots/played-${which}-${vp}-${String(++shot).padStart(2, '0')}-3d-blocked.png` });
    block = false;
    const again = await blocked.evaluate((u) => import(u).then(() => 'loaded', () => 'failed'), chunkUrl);
    check(`${vp} chunk blocked, the control: an import again in the same page stays failed`, again === 'failed', again);
    await Promise.all([blocked.waitForEvent('load'), blocked.click('.line3d button')]);
    const back = await blocked.waitForFunction(() => window.__mapper.view3d?.state === 'on', null, { timeout: 60_000 }).then(() => true, () => false);
    check(`${vp} chunk blocked: Try again reloads and 3D draws`, back && !(await blocked.evaluate(() => location.search)).includes('view='), JSON.stringify(await blocked.evaluate(() => window.__mapper.view3d)));
    await blocked.close();

    // WebGL refused (webgl2 and webgl only; the flat canvas still draws): flat with its line.
    const refused = await ctx.newPage();
    await refused.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
        return /^(webgl2|webgl|experimental-webgl)$/i.test(String(kind)) ? null : real.call(this, kind, ...rest);
      };
    });
    await refused.goto(open);
    await refused.waitForFunction(() => window.__mapper.view3d?.state === 'failed', null, { timeout: 30_000 });
    await refused.waitForFunction(() => window.__mapper.scene?.complete, null, { timeout: 60_000 });
    const rl = await refused.textContent('.line3d');
    const rPx = colourStats(decodePng(await refused.locator('canvas.surface-flat').screenshot()));
    check(`${vp} WebGL refused: drawn flat with its line, the flat canvas drawn`, rl.includes('This browser could not start the 3D view; drawn flat.') && (await refused.locator('canvas.surface-3d').count()) === 0 && rPx.colours > 30, `${rl} ${JSON.stringify(rPx)}`);
    await refused.close();
  });

  // 3d-more. The ground never hides, and it is the right way up; a buried Pin answers; the element
  // view's chip into a layout opens it in 3D, marked and centred; on a phone the sheet never covers
  // the selected Pin.
  await section('3d-more', async () => {
    const open = `${site.url}/?world=${M}&map=${M_LAYOUT}`;
    await page.goto(open);
    await complete();
    await page.waitForFunction(() => window.__mapper.view3d?.state === 'on' && window.__mapper.view3d?.picture, null, { timeout: 30_000 });
    await page.waitForTimeout(300);
    const vw = page.viewportSize();
    const clear = async (pt) => pt && pt.x > 30 && pt.x < vw.width * (phone ? 0.9 : 0.6) && pt.y > vw.height * 0.3 && pt.y < vw.height * (phone ? 0.5 : 0.9) && String(await mapper(([x, y]) => document.elementFromPoint(x, y)?.className ?? '', [pt.x, pt.y])).includes('surface-3d');
    // A Pin buried under the ground (z below 750), pressed from above.
    const pins = await mapper(() => window.__mapper.pins());
    let buried = null;
    for (const p of pins.filter((q) => q.z < 750)) {
      const pt = await mapper((id) => window.__mapper.screenOf(id), p.id);
      if (await clear(pt)) {
        buried = { ...p, ...pt };
        break;
      }
    }
    check(`${vp} 3D: a buried Pin stands clear to press`, !!buried, `${pins.filter((q) => q.z < 750).length} buried`);
    if (buried) {
      const shot3d = decodePng(await page.screenshot());
      const dpr = shot3d.w / vw.width;
      const at = (png, x, y) => {
        const i = (Math.round(y * dpr) * png.w + Math.round(x * dpr)) * 4;
        return [png.data[i], png.data[i + 1], png.data[i + 2]];
      };
      // Its dot's pixels in a 5 by 5 block at its centre: a line or a label standing nearer the camera
      // may cross the dot (that is 3D), so the read counts the block's pixels in the Pin's colour.
      const want = GROUP_COLORS[buried.style.slice(4)]?.light;
      const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
      let inColour = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const got = at(shot3d, buried.x + dx, buried.y + dy);
        if (want && got.reduce((a, v, k) => a + Math.abs(v - hex(want)[k]), 0) < 60) inColour++;
      }
      check(`${vp} 3D: a buried Pin is drawn over the ground in its own colour`, inColour >= 5, `${inColour} of 25 pixels in ${want}`);
      if (inColour < 5) await page.screenshot({ path: `.scratch/shots/played-${which}-${vp}-buried-crop.png`, clip: { x: buried.x - 30, y: buried.y - 30, width: 60, height: 60 } });
      await press(buried.x, buried.y);
      await page.waitForSelector('.card:not([hidden])');
      const sel = await mapper(() => window.__mapper.selection);
      check(`${vp} 3D: a buried Pin answers a press`, sel.includes(buried.id), JSON.stringify(sel));
      if (phone) {
        await page.waitForTimeout(250);
        const pt = await mapper((id) => window.__mapper.screenOf(id), buried.id);
        const sheet = await page.locator('.panel').boundingBox();
        check(`${vp} 3D: the sheet never covers the selected Pin`, pt && sheet && pt.y < sheet.y - 10, `${JSON.stringify(pt)} sheet ${JSON.stringify(sheet)}`);
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.click('.card .close').catch(() => {});
    }
    // The right way up: the same nine ground points read from straight above in 3D and in the flat
    // view agree in colour.
    // (Optional-called, so a control build from before the hook still reaches the checks below.)
    const pic = (await mapper(() => window.__mapper.pictures?.() ?? []))[0];
    if (!phone && pic) {
      await page.focus('canvas.surface-3d');
      for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(300);
      const [px, py, pw, ph] = pic.rect;
      // A grid over the whole picture, each point read as the mean of a small block (two copies of
      // different sizes still agree). The 3D read is compared with the flat read at the same points
      // and at the points mirrored top to bottom: the right way up agrees with the first far more
      // than with the second (Pins and lines add the same noise to both). Dark space alone cannot
      // tell (the first instrument, nine points near the edges, passed a ground drawn upside down).
      const pts = [];
      for (let i = 0; i < 12; i++) for (let j = 0; j < 8; j++) pts.push([px + pw * (0.04 + (0.92 * i) / 11), py + ph * (0.06 + (0.88 * j) / 7)]);
      const mirrored = pts.map(([x, y]) => [x, py + ph - (y - py)]);
      const read = async (z, at = pts) => {
        const png = decodePng(await page.screenshot());
        const dpr = png.w / vw.width;
        const out = [];
        for (const [x, y] of at) {
          const s = await mapper(([a, b, c]) => window.__mapper.pointOf(a, b, c), [x, y, z]);
          const sum = [0, 0, 0];
          let n = 0;
          for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            const i = ((Math.round(s.y * dpr) + dy) * png.w + Math.round(s.x * dpr) + dx) * 4;
            for (let k = 0; k < 3; k++) sum[k] += png.data[i + k];
            n++;
          }
          out.push(sum.map((v) => Math.round(v / n)));
        }
        return out;
      };
      const in3d = await read(750);
      await snap('3d-top');
      await page.click('button.view-toggle');
      await page.waitForTimeout(400);
      const flat = await read(0);
      const flatMirror = await read(0, mirrored);
      await snap('3d-top-flat');
      const dist = (a, b) => a.reduce((s, v, j) => s + Math.abs(v - b[j]), 0);
      const same = in3d.reduce((s, c, k) => s + dist(c, flat[k]), 0) / pts.length;
      const mirror = in3d.reduce((s, c, k) => s + dist(c, flatMirror[k]), 0) / pts.length;
      check(`${vp} 3D: the ground is the right way up (closer to flat than to flat mirrored)`, same < mirror * 0.75, `mean distance ${same.toFixed(1)} to flat, ${mirror.toFixed(1)} to flat mirrored`);
      await page.click('button.view-toggle');
    }
    // The element view's chip into the layout: 3D, the element marked and centred (a peek on a phone).
    // Its reads answer slowly, so the 3D view is on before the list completes and every later list
    // reaches a camera already placed (with instant answers a fit that undoes the centring never runs).
    await page.goto(`${site.url}/?world=${M}&type=location&element=${M_ELEMENT}`);
    await complete();
    slowMs = 700;
    await page.click('.element-head .chip:has-text("Moppetopia: layout")').catch(async () => {
      await page.click('.maps-fold');
      await page.click('.element-head .chip:has-text("Moppetopia: layout")');
    });
    await page.waitForFunction(() => window.__mapper.view3d?.state === 'on', null, { timeout: 30_000 });
    const onBeforeComplete = !(await mapper(() => window.__mapper.scene?.complete));
    await complete();
    slowMs = 0;
    check(`${vp} the 3D view was on before the list completed (the centring meets later lists)`, onBeforeComplete);
    await page.waitForFunction(() => window.__mapper.view3d?.state === 'on', null, { timeout: 30_000 });
    // A rest long enough for whatever follows the last read (a resize, a late list) to have moved it.
    await page.waitForTimeout(1000);
    const marked = await mapper(() => window.__mapper.marked);
    const mpt = marked.length ? await mapper((id) => window.__mapper.screenOf(id), marked[0]) : null;
    const panel = await page.locator('.panel').boundingBox().catch(() => null);
    const bottom = phone && panel ? panel.y : vw.height;
    const right = !phone && panel ? panel.x : vw.width;
    check(`${vp} the element view's chip opens the layout in 3D, marked, in the free part of the map`, marked.length > 0 && mpt && mpt.x > 0 && mpt.x < right && mpt.y > 0 && mpt.y < bottom, `${JSON.stringify(mpt)} right ${right} bottom ${bottom}`);
    // Centred, and still centred once the whole list has landed (a later fit must not undo it): at the
    // view's centre, or where keeping it clear of the card moved it (the free part's centre).
    const box = await page.locator('canvas.surface-3d').boundingBox();
    const top = (await page.locator('.top').boundingBox()).y + (await page.locator('.top').boundingBox()).height;
    const centres = [[box.x + box.width / 2, box.y + box.height / 2], [right / 2, (top + bottom) / 2]];
    const off = mpt ? Math.min(...centres.map(([cx, cy]) => Math.hypot(mpt.x - cx, mpt.y - cy))) : Infinity;
    check(`${vp} the element view in 3D keeps its Pin centred after the list completes`, off < 30, `${off.toFixed(0)} px off`);
    if (phone) check(`${vp} the element view in 3D opens as a peek on a phone`, (await mapper(() => window.__mapper.peek)) === true);
    await snap('3d-element');
  });

  // 3d-stand-in. A layout with a depth and no written size, opened from the element view: its frame is
  // a stand-in (the element's own Pin) until the map's read brings the far Pin. The centring waits for
  // the final frame, so the camera stands back far enough for the whole layout, never at the stand-in's.
  await section('3d-stand-in', async () => {
    await page.goto(`${site.url}/?world=${F}&type=location&element=${F_NEAR}`);
    await complete();
    // Slow answers, so 3D is on while the frame is still the stand-in (instant ones end it first).
    slowMs = 1500;
    await page.click('.element-head .chip:has-text("Deep, no size")').catch(async () => {
      await page.click('.maps-fold');
      await page.click('.element-head .chip:has-text("Deep, no size")');
    });
    await page.waitForFunction(() => window.__mapper.view3d?.state === 'on', null, { timeout: 30_000 });
    const standIn = await mapper(() => window.__mapper.scene?.frame.from !== 'written' && !window.__mapper.scene?.complete && window.__mapper.scene?.counts.pins === 1);
    await complete();
    slowMs = 0;
    check(`${vp} 3D was on while the frame was the stand-in (one Pin, the list not complete)`, standIn);
    await page.waitForTimeout(1000);
    const v = await mapper(() => window.__mapper.view3d);
    const d = v.cam ? Math.hypot(v.cam[0] - 100, v.cam[1] - 100, v.cam[2] - 50) : 0;
    const marked = await mapper(() => window.__mapper.marked);
    // The whole layout's fit stands about 7,800 units off; the stand-in's (one Pin and the depth) about 1,200.
    check(`${vp} 3D on a stand-in frame: the element's Pin marked, the camera fitted to the final frame`, marked.length === 1 && d > 4000, `${Math.round(d)} units from the Pin; ${JSON.stringify(v)}`);
    await snap('3d-stand-in');
  });

  // 6. The element view by address: its first Map not written, the element selected and marked.
  await section('6', async () => {
    await page.goto(`${site.url}/?world=${M}&type=location&element=${M_ELEMENT}`);
    await complete();
    const head = await page.textContent('.element-head');
    check(`${vp} the element view names the element and its maps`, head.includes('Puddleton') && head.includes('on 2 maps') && (await page.locator('.element-head .chip').count()) === 2, head);
    check(`${vp} the element view's first Map is not written`, !(await where()).includes('map=') && (await mapper(() => history.state?.map)) === M_MAP);
    const sel = await mapper(() => window.__mapper.selection);
    check(`${vp} the element view selects the element's items`, sel.length === 1 && (await page.textContent('.card h2')).includes('Puddleton'), JSON.stringify(sel));
    await snap('element');
    if (phone) {
      // On a phone the maps fold behind one button.
      check(`${vp} the element view folds its maps on a phone`, !(await page.locator('.element-head .chips').isVisible()) && (await page.locator('.element-head .maps-fold').isVisible()));
      await page.click('.element-head .maps-fold');
    }
    await page.click(`.element-head .chip:has-text("Moppetopia: layout")`);
    await complete();
    check(`${vp} another of its Maps is a press away`, (await where()).includes(`map=${M_LAYOUT}`));
    await page.goBack();
    await complete();
    check(`${vp} Back returns to the element's first Map`, !(await where()).includes('map=') && (await page.textContent('.map-name')) === 'MoppetopiaMap');
    // A camera gesture on the element view's first Map names that Map with its at, so a reload opens
    // the same Map whatever the tab held.
    {
      const eb = await page.locator('canvas.surface').boundingBox();
      const ex = eb.x + eb.width / 2;
      const ey = eb.y + eb.height * 0.3;
      if (!phone) {
        await page.mouse.move(ex, ey);
        await page.mouse.down();
        await page.mouse.move(ex + 40, ey + 20, { steps: 5 });
        await page.mouse.up();
      } else {
        await mapper(([x, y]) => {
          const c = document.querySelector('canvas.surface');
          const ev = (type, dx, dy, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 12, pointerType: 'touch', isPrimary: true, clientX: x + dx, clientY: y + dy, buttons }));
          ev('pointerdown', 0, 0, 1);
          for (let i = 1; i <= 5; i++) ev('pointermove', i * 8, i * 4, 1);
          ev('pointerup', 40, 20, 0);
        }, [ex, ey]);
      }
      const ea = await where();
      const cam1 = await mapper(() => window.__mapper.camera);
      await page.reload();
      await complete();
      const cam2 = await mapper(() => window.__mapper.camera);
      check(`${vp} a gesture on the element view writes its Map with its at, and a reload keeps both`, ea.includes(`map=${M_MAP}`) && ea.includes('at=') && (await page.textContent('.map-name')) === 'MoppetopiaMap' && Math.abs(cam1.cx - cam2.cx) < 2 && Math.abs(cam1.cy - cam2.cy) < 2, `${ea} ${JSON.stringify([cam1, cam2])}`);
    }
    // Without a type, the long way, said.
    await page.goto(`${site.url}/?world=${M}&element=${M_ELEMENT}`);
    await complete();
    check(`${vp} an address without a type takes the long way and says so`, (await page.textContent('.element-head')).includes('found the long way'));
    await page.goto(`${site.url}/?world=${M}&type=location&element=${GONE}`);
    await page.waitForSelector('.status-page .error');
    check(`${vp} an element not there is said`, (await page.textContent('.status-page')).includes('No element with this id that this reader can see in this world.'));
  });

  // 7. A failed read with Try again, then a 429 waited out: on a Map opened by address with a camera.
  await section('7', async () => {
    faults.push({ match: `/marker/?limit=1000&map=${M_SPACE}`, abort: true });
    faults.push({ match: `/zone/?ids=`, answer: json(429, { error: { code: 'rate_limited', message: 'Too many requests.' } }, { 'RateLimit-Reset': '2' }) });
    await page.goto(`${site.url}/?world=${M}&map=${M_SPACE}&at=${AT}`);
    await page.waitForSelector('.status .failure .retry');
    check(`${vp} a failed read is said in place`, (await page.textContent('.status .failure')).includes('The Markers read did not reach OnlyWorlds'));
    const cam = await mapper(() => window.__mapper.camera);
    const vpw = opts.viewport;
    check(`${vp} at from the address wins over the fit`, Math.abs(cam.cx - 1200) < 1 && Math.abs(Math.min(vpw.width, vpw.height) / cam.s - 600) < 1, JSON.stringify(cam));
    await snap('failed-read');
    await page.click('.status .failure .retry');
    await page.waitForSelector('.status .wait');
    check(`${vp} a 429 waits and says so`, (await page.textContent('.status .wait')).includes('OnlyWorlds lets a visitor read 60 times a minute; reading again in'));
    await snap('waiting');
    await complete();
    check(`${vp} Try again completes the map`, (await mapper(() => window.__mapper.scene.counts.zones)) > 0 && (await page.locator('.status .failure').count()) === 0);
  });

  // 8. A stranger's text stays text; a picture on http is not drawn.
  await section('8', async () => {
    await page.goto(`${site.url}/?world=${H}`);
    await page.waitForSelector('.map-row');
    await page.click('.map-row');
    await complete();
    const hp = await mapper(() => window.__mapper.pins());
    const hpt = await mapper((id) => window.__mapper.screenOf(id), hp[0].id);
    await press(hpt.x, hpt.y);
    await page.waitForSelector('.card h2');
    const pwned = await mapper(() => window.__pwned ?? null);
    check(`${vp} a stranger's markup is shown as text`, pwned === null && (await page.textContent('.card h2')).includes('<b onmouseover') && (await page.locator('main img, .card b, main script').count()) === 0);
    check(`${vp} a picture on http is refused and said`, (await page.textContent('.status')).includes('not on a secure (https) address'));
    await snap('stranger-text');
  });

  // 9. Sikelia: a world too large for per-map counts, its largest map, its layout, an element.
  await section('9', async () => {
    await page.goto(`${site.url}/?world=${S}`);
    await page.waitForSelector('.map-row');
    check(`${vp} Sikelia's list leaves the counts out and says why`, (await page.locator('.map-row').count()) === 214 && (await page.textContent('main')).includes('more than one read of 1,000 holds'));
    await page.click('.map-row:has(.row-name:text-is("Sikelia"))');
    await complete();
    await page.waitForFunction(() => !document.querySelector('.status')?.textContent.includes('is being'), null, { timeout: 60_000 });
    const big = await mapper(() => window.__mapper.scene);
    check(`${vp} Sikelia's map Sikelia`, big.counts.pins === 224 && big.counts.zones === 344 && big.counts.lines === 405, JSON.stringify(big.counts));
    await page.waitForTimeout(500);
    await snap('sikelia');
    await page.click('button.back');
    await page.click('.map-row:has(.row-name:text-is("Sikelia: layout"))');
    await complete();
    await page.waitForFunction(() => !document.querySelector('.status')?.textContent.includes('is being'), null, { timeout: 60_000 });
    const sl = await mapper(() => window.__mapper.scene);
    check(`${vp} Sikelia's layout`, sl.counts.pins === 349 && sl.counts.lines === 1050 && sl.counts.zones === 344, JSON.stringify(sl.counts));
    await page.waitForTimeout(500);
    await snap('sikelia-layout');
    await page.goto(`${site.url}/?world=${S}&type=location&element=${S_ELEMENT}`);
    await complete();
    check(`${vp} Sikelia's element view`, (await page.locator('.element-head .chip').count()) === 4);
    await page.waitForTimeout(800);
    await snap('sikelia-element');
    // The element view is the page most strangers land on: the map and the marked element are in
    // sight, between the top block and the card, at both phone sizes.
    const inSight = async (tag) => {
      await page.waitForFunction(() => !document.querySelector('.status')?.textContent.includes('is being'), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(500);
      const seen = await mapper(() => {
        const marked = window.__mapper.marked;
        const hits = marked.map((id) => {
          const p = window.__mapper.screenOf(id);
          const hit = p && document.elementFromPoint(p.x, p.y);
          return hit?.tagName === 'CANVAS' ? 'visible' : `covered by ${hit?.className || hit?.tagName || 'nothing (off screen)'}`;
        });
        const top = document.querySelector('.top').getBoundingClientRect().bottom;
        const panel = document.querySelector('.panel');
        const sheet = panel.hidden ? innerHeight : panel.getBoundingClientRect().top;
        return { hits, top: Math.round(top), sheet: Math.round(sheet), free: Math.round(sheet - top), vh: innerHeight, peek: window.__mapper.peek };
      });
      check(`${vp} ${tag}: the element view's marked Pin is in sight`, seen.hits.length > 0 && seen.hits.every((v) => v === 'visible'), JSON.stringify(seen));
      if (phone) check(`${vp} ${tag}: the element view leaves the map at least a third of the screen`, seen.free >= seen.vh / 3, JSON.stringify(seen));
      return seen;
    };
    if (phone) {
      await inSight('390x844');
      // Details opens the sheet, and the Pin is kept clear of it. By the keyboard: the focus follows
      // into the sheet, and Close gives it back to Details, never to the page.
      await page.focus('.card .details');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      const into = await mapper(() => ({ inCard: !!document.activeElement?.closest('.card'), tag: document.activeElement?.tagName }));
      check(`${vp} Details moves the focus into the sheet`, into.inCard, JSON.stringify(into));
      const opened = await mapper(() => window.__mapper.marked.map((id) => { const p = window.__mapper.screenOf(id); const hit = p && document.elementFromPoint(p.x, p.y); return hit?.tagName === 'CANVAS'; }));
      check(`${vp} Details opens the sheet and keeps the marked Pin clear of it`, (await page.locator('.card .block').count()) >= 1 && opened.every(Boolean), JSON.stringify(opened));
      await snap('sikelia-element-details');
      await page.focus('.card .close');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      const back = await mapper(() => ({ details: document.activeElement?.classList.contains('details'), peek: window.__mapper.peek, tag: document.activeElement?.tagName }));
      check(`${vp} Close on the whole card folds it back and gives the focus to Details`, back.details && back.peek, JSON.stringify(back));
      await page.focus('.card .close');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      const gone = await mapper(() => ({ canvas: document.activeElement?.classList.contains('surface'), tag: document.activeElement?.tagName, sel: window.__mapper.selection.length }));
      check(`${vp} Close on the peek ends the selection and gives the focus to the map`, gone.canvas && gone.sel === 0, JSON.stringify(gone));
      await page.setViewportSize({ width: 360, height: 640 });
      await page.goto(`${site.url}/?world=${S}&type=location&element=${S_ELEMENT}`);
      await complete();
      await inSight('360x640');
      await snap('sikelia-element-360');
      await page.setViewportSize(opts.viewport);
    } else await inSight('desk');
  });

  // 13 (walked here, before the measure). The widths between a phone and a desk, and a turn: an
  // open card never covers the bar's controls, and the held Pin stays in sight when the window
  // changes under it.
  await section('13', async () => {
    const controls = () => mapper(() => {
      const out = { covered: [], outside: [] };
      for (const el of document.querySelectorAll('.top button, .top a, .card button')) {
        if (!el.checkVisibility?.()) continue;
        const scroller = el.closest('.panel, .status, .extra');
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        // A row partly past the edge of its own scrolling box is reached by scrolling it: judged only whole.
        if (scroller) { const sr = scroller.getBoundingClientRect(); if (r.top < sr.top || r.bottom > sr.bottom) continue; }
        if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) { out.outside.push(el.textContent.trim().slice(0, 24)); continue; }
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 10));
        if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) out.covered.push(`${el.textContent.trim().slice(0, 24)} under ${hit.className || hit.tagName}`);
      }
      return out;
    });
    const sight = () => mapper(() => window.__mapper.selection.filter((i) => i.startsWith('pin:')).map((id) => { const p = window.__mapper.screenOf(id); const hit = p && document.elementFromPoint(p.x, p.y); return hit?.tagName === 'CANVAS' ? 'visible' : `covered by ${hit?.className || hit?.tagName || 'nothing'}`; }));
    const ok = (c, v) => c.covered.length === 0 && c.outside.length === 0 && v.length > 0 && v.every((x) => x === 'visible');
    const sizes = phone ? [[844, 390]] : [[844, 390], [900, 700]];
    for (const [w, h] of sizes) {
      const tag = `${w}x${h}${phone ? ' touch' : ''}`;
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${site.url}/?world=${S}&type=location&element=${S_ELEMENT}`);
      await complete();
      await page.waitForTimeout(600);
      let c = await controls();
      let v = await sight();
      check(`${vp} ${tag}: the element view's card covers no control, and its Pin is in sight`, ok(c, v), JSON.stringify({ c, v }));
      await snap(`width-${w}-element`);
      await page.goto(`${site.url}/?world=${S}&map=${S_BIG}`);
      await complete();
      await page.waitForTimeout(400);
      const ps = await mapper(() => window.__mapper.pins());
      const pp = await mapper((id) => window.__mapper.screenOf(id), ps[Math.floor(ps.length / 2)].id);
      await press(pp.x, pp.y);
      await page.waitForSelector('.card:not([hidden])');
      await page.waitForTimeout(400);
      c = await controls();
      v = await sight();
      check(`${vp} ${tag}: a pressed Pin's card covers no control, and the Pin is in sight`, ok(c, v), JSON.stringify({ c, v }));
      await snap(`width-${w}-card`);
    }
    // A turn (a phone) or a narrowed window (a desk), with the element view open and untouched.
    const [from, to] = phone ? [[390, 844], [844, 390]] : [[1440, 900], [390, 844]];
    await page.setViewportSize({ width: from[0], height: from[1] });
    await page.goto(`${site.url}/?world=${S}&type=location&element=${S_ELEMENT}`);
    await complete();
    await page.waitForTimeout(600);
    await page.setViewportSize({ width: to[0], height: to[1] });
    await page.waitForTimeout(600);
    const turned = await sight();
    const peek = await mapper(() => window.__mapper.peek);
    const wantPeek = to[0] <= 640 || phone;
    check(`${vp} ${from.join('x')} turned to ${to.join('x')}: the held Pin stays in sight${wantPeek ? ', the card a peek' : ''}`, turned.length > 0 && turned.every((x) => x === 'visible') && (!wantPeek || peek), JSON.stringify({ turned, peek }));
    await snap('turned');
    await page.setViewportSize(opts.viewport);
  });

  // 10. The measure readout on Sikelia's largest map: a scripted pan and zoom over the picture.
  await section('10', async () => {
    if (!phone) {
      await page.goto(`${site.url}/?world=${S}&map=${S_BIG}&measure=1`);
      await complete();
      await page.waitForFunction(() => document.querySelector('.readout')?.dataset.firstDraw !== 'none', null, { timeout: 60_000 });
      await page.waitForFunction(() => !document.querySelector('.status')?.textContent.includes('is being'), null, { timeout: 60_000 });
      // The first draw comes first: the source is decoded into the copy that fits the screen (Sikelia
      // fitted at a 1440 by 900 desk is about 1,050 px wide), then once more into the largest; the
      // other copies are made from those, never a third decode.
      const decodes = await mapper(() => window.__decodes);
      const sources = decodes.filter((d) => d.from === 'source');
      check(`${vp} the picture's first copy is the one that fits the screen, and the source is decoded at most twice`, sources.length >= 1 && sources.length <= 2 && sources[0].w <= 2048 && decodes[0].from === 'source', JSON.stringify(decodes));
      const derives0 = await mapper(() => window.__mapper.derives);
      const b2 = await page.locator('canvas.surface').boundingBox();
      const mx = b2.x + b2.width / 2;
      const my = b2.y + b2.height / 2;
      await page.mouse.move(mx, my);
      for (let r = 0; r < 3; r++) {
        await page.mouse.down();
        for (let i = 0; i < 30; i++) await page.mouse.move(mx + Math.sin(i / 5) * 200, my + Math.cos(i / 5) * 120);
        await page.mouse.up();
        for (let i = 0; i < 10; i++) {
          await page.mouse.wheel(0, r % 2 ? 120 : -120);
          await page.waitForTimeout(16);
        }
      }
      await page.waitForTimeout(400);
      measures[vp] = await mapper(() => ({ ...document.querySelector('.readout').dataset, text: document.querySelector('.readout').textContent }));
      check(`${vp} no derive on a camera move`, (await mapper(() => window.__mapper.derives)) === derives0, `${derives0} -> ${await mapper(() => window.__mapper.derives)}`);
      await snap('measure');
      // A held arrow key writes at once, at its end, never on every repeat (WebKit refuses more than
      // 100 history writes in 10 s).
      await page.focus('canvas.surface');
      const w0 = await mapper(() => window.__mapper.writes.length);
      for (let i = 0; i < 160; i++) await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(700);
      const w1 = await mapper(() => window.__mapper.writes.length);
      const camK = await mapper(() => window.__mapper.camera);
      const atK = new URLSearchParams(await where()).get('at')?.split(',').map(Number) ?? [];
      check(`${vp} 160 arrow presses write at only at their end`, w1 - w0 <= 3 && Math.abs(atK[0] - camK.cx) <= 1 && Math.abs(atK[1] - camK.cy) <= 1, `${w1 - w0} writes, at ${atK}, camera ${JSON.stringify(camK)}`);
      // The window for the walks hands copies: changing one moves nothing.
      const moved = await mapper(() => {
        const c = window.__mapper.camera;
        c.cx += 5000;
        const f = window.__mapper.scene.frame;
        f.w = 1;
        return { cx: window.__mapper.camera.cx, mine: c.cx, w: window.__mapper.scene.frame.w, global: '__mapperScene' in window };
      });
      check(`${vp} the walk window hands copies and keeps no scene of its own`, moved.cx !== moved.mine && moved.w !== 1 && !moved.global, JSON.stringify(moved));
    }
  });

  // 11. A stranger's shapes: a Pin and a Marker far past the frame; a Map with no written size whose
  // picture comes at once while its Pins come later; a map name of 3,000 characters.
  await section('11', async () => {
    {
      const t0 = Date.now();
      await page.goto(`${site.url}/?world=${F}&map=${F_FAR}`);
      await page.waitForFunction(() => window.__mapper.scene?.complete || document.querySelector('.status .failure'), null, { timeout: 60_000 }).catch(() => {});
      const farMs = Date.now() - t0;
      const farSc = await mapper(() => window.__mapper.scene);
      const farSaid = await page.textContent('.status');
      check(`${vp} a Pin and a Marker at x 100000 on a 1000 map draw at once, nothing failed`, farSc?.complete && farMs < 8000 && farSc.counts.lines === 1 && farSc.counts.zones === 1 && !(await page.locator('.status .failure').count()), `${farMs} ms, ${JSON.stringify(farSc?.counts)}, "${farSaid}"`);
      const near = (await mapper(() => window.__mapper.pins())).find((p) => p.element === F_NEAR);
      const np = near && (await mapper((id) => window.__mapper.screenOf(id), near.id));
      if (np) {
        await press(np.x, np.y);
        await page.waitForSelector('.card h2', { timeout: 5000 }).catch(() => {});
      }
      check(`${vp} the near Pin answers a press on the far map`, !!np && (await page.locator('.card h2').count()) > 0 && (await page.textContent('.card h2')).includes('Near'));
      await snap('far');

      for (const pinDelay of [0, 150, 400]) {
        faults.push({ match: `/pin/?limit=1000&map=${F_NOSIZE}`, delayMs: pinDelay, answer: playedF(new URL(`https://www.onlyworlds.com/api/v2/pin/?map=${F_NOSIZE}&world=${F}`)) });
        await page.goto(`${site.url}/?world=${F}&map=${F_NOSIZE}`);
        await complete();
        await page.waitForFunction(() => window.__mapper.scene?.frame.from === 'picture', null, { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(300);
        const ns = await mapper(() => ({ f: window.__mapper.scene.frame, c: window.__mapper.camera, vh: innerHeight }));
        check(`${vp} a Map with no written size fits its picture's frame, not its Pins' (Pins after ${pinDelay} ms)`, ns.f.from === 'picture' && Math.abs(ns.c.cx - ns.f.w / 2) < 2 && ns.c.s * ns.f.h <= ns.vh, JSON.stringify(ns));
      }
      await snap('no-size');

      await page.goto(`${site.url}/?world=${F}&map=${F_LONG}`);
      await complete();
      const top = await mapper(() => {
        const b = document.querySelector('button.back').getBoundingClientRect();
        const l = [...document.querySelectorAll('.tools button')].find((x) => x.textContent === 'List').getBoundingClientRect();
        const t = document.querySelector('.top').getBoundingClientRect();
        const st = document.querySelector('.status').getBoundingClientRect();
        return { back: [Math.round(b.top), Math.round(b.bottom)], list: [Math.round(l.top), Math.round(l.bottom)], top: Math.round(t.height), status: Math.round(st.top), vh: innerHeight, title: document.querySelector('.map-name').title.length };
      });
      check(`${vp} a very long map name keeps Back, List and the status on screen and the map in view`, top.back[0] >= 0 && top.back[1] < 80 && top.list[1] < 80 && top.status < top.vh / 2 && top.top <= top.vh * 0.6 && top.title === LONG_NAME.length, JSON.stringify(top));
      await snap('long-name');
    }
  });

  // 12. Leaving a map stops its reads: none of them is read for a map nobody is looking at, and the
  // next map in the same world is not read behind them.
  await section('12', async () => {
    if (!phone) {
      await page.goto(`${site.url}/?world=${S}`);
      await page.waitForSelector('.map-row');
      slowMs = 250;
      await page.click('.map-row:has(.row-name:text-is("Sikelia: layout"))');
      await page.waitForFunction(() => (window.__mapper.scene?.counts.pins ?? 0) > 0, null, { timeout: 30_000 });
      await page.click('button.back');
      await page.waitForSelector('.map-row');
      // On the list, for a second and a half: the layout's Markers, Zones and bodies are not read.
      const left = sent.length;
      await page.waitForTimeout(1500);
      const after = sent.slice(left);
      check(`${vp} leaving a map starts none of its reads`, after.length <= 1, `${after.length} reads after leaving: ${after.slice(0, 3).join(' | ')}`);
      slowMs = 0;
      // The next map in the same world opens whole.
      await page.click('.map-row:has(.row-name:text-is("Sikelia"))');
      await complete();
    }
  });

  // 1, read last. The stalled body is said after its time limit, with Try again, and Try again reads.
  await section('stall', async () => {
    {
      const wait = 33_000 - (Date.now() - stallOpened);
      if (wait > 0) await stall.waitForTimeout(wait);
      await stall.waitForSelector('.failure .retry', { timeout: 15_000 }).catch(() => {});
      const said = await stall.textContent('main');
      check(`${vp} a Maps read whose body stalls is said after its limit, with Try again`, said.includes('did not finish in 30 s') && (await stall.locator('.retry').count()) === 1, `${Math.round((Date.now() - stallOpened) / 1000)} s after open: "${said.slice(0, 200)}"`);
      await stall.click('.retry').catch(() => {});
      await stall.waitForSelector('.map-row', { timeout: 20_000 }).catch(() => {});
      check(`${vp} Try again after a stalled read reads the maps`, (await stall.locator('.map-row').count()) === 3);
      await stall.close();
    }
  });

  check(`${vp} no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // signin. Sign in with OnlyWorlds and the home of worlds, on the registered origin (walk/signin.mjs).
  await section('signin', () => signinWalk({ browser, which, vp, opts, check, dist: DIST, fx }));
}

clearTimeout(watchdog);
await browser.close();
await site.close();
check('every request was played', unplayed.length === 0, [...new Set(unplayed)].slice(0, 5).join(', '));
if (measures.desk) console.log(`measure (${which}, desk 1440x900, played): ${measures.desk.text}`);
console.log(`played ${which}: ${checks - fails.length} of ${checks} checks passed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
