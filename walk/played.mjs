// The played walk: the built page against a played OnlyWorlds. Every request to the API is answered
// from the recorded fixtures (walk/record.mjs) or from a small played world made here, none reaches
// the real server; pictures come from the recording too. At a desk and on a 390 px touch phone
// (and the element view at 360 by 640 too).
//   npm run build && node walk/played.mjs [chromium|firefox]
// Screenshots go to .scratch/shots/. Exits 1 on any failed check. MAPPER_DIST serves another build
// (a control built from an older commit), MAPPER_PORT another port, SECTIONS=9,12 only those.
import { chromium, firefox } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { serve } from './serve.mjs';
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
  const on = (rows) => page1(map ? rows.filter((r) => r.map === map) : rows);
  if (p.startsWith('/api/v2/world')) return json(200, { id: F, name: 'Shapes', counts: { total: 9, types: { map: 3, pin: 4, location: 2 } } });
  if (p.startsWith('/api/v2/map')) return page1([
    { id: F_FAR, type: 'map', name: 'Far Pin', width: 1000, height: 1000 },
    { id: F_NOSIZE, type: 'map', name: 'No size', image_url: PICTURE },
    { id: F_LONG, type: 'map', name: LONG_NAME, width: 1000, height: 800 },
  ]);
  if (p.startsWith('/api/v2/pin')) return on([fPin(30, F_FAR, F_NEAR, 100, 100), fPin(31, F_FAR, F_AWAY, 100000, 100000), fPin(32, F_NOSIZE, F_NEAR, 300, 300), fPin(33, F_LONG, F_NEAR, 500, 400)]);
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
  if (!ok) fails.push(`${which} ${label}${detail ? `: ${detail}` : ''}`);
}

const site = await serve(DIST, PORT);
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
      window.__decodes.push(src instanceof Blob ? 'source' : src instanceof HTMLImageElement ? 'source' : 'copy');
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

  // 2. A world that is not public, or not there: one sentence and the key form.
  await section('2', async () => {
    await page.goto(`${site.url}/?world=${NOPE}`);
    await page.waitForSelector('.key-form');
    check(`${vp} a 404 world says it may be mistyped or private`, (await page.textContent('main')).includes('No public world has this id. It may be mistyped, or private: paste a key to open it.'));
    // The key field is not a password field in a form, which a browser offers to save.
    const field = await mapper(() => { const i = document.querySelector('#world-key'); return { type: i.type, form: !!i.closest('form'), auto: i.autocomplete }; });
    check(`${vp} the key field invites no password save`, field.type === 'text' && !field.form && field.auto === 'off', JSON.stringify(field));
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
    const status = await page.textContent('.status');
    check(`${vp} the layout says 3D comes later and names its ground`, status.includes('The 3D view comes in a later version') && status.includes('Drawn over its ground, the map Moppetopia Space Map'));
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
      // Details opens the sheet, and the Pin is kept clear of it.
      await page.click('.card .details');
      await page.waitForTimeout(300);
      const opened = await mapper(() => window.__mapper.marked.map((id) => { const p = window.__mapper.screenOf(id); const hit = p && document.elementFromPoint(p.x, p.y); return hit?.tagName === 'CANVAS'; }));
      check(`${vp} Details opens the sheet and keeps the marked Pin clear of it`, (await page.locator('.card .block').count()) >= 1 && opened.every(Boolean), JSON.stringify(opened));
      await snap('sikelia-element-details');
      await page.setViewportSize({ width: 360, height: 640 });
      await page.goto(`${site.url}/?world=${S}&type=location&element=${S_ELEMENT}`);
      await complete();
      await inSight('360x640');
      await snap('sikelia-element-360');
      await page.setViewportSize(opts.viewport);
    } else await inSight('desk');
  });

  // 10. The measure readout on Sikelia's largest map: a scripted pan and zoom over the picture.
  await section('10', async () => {
    if (!phone) {
      await page.goto(`${site.url}/?world=${S}&map=${S_BIG}&measure=1`);
      await complete();
      await page.waitForFunction(() => document.querySelector('.readout')?.dataset.firstDraw !== 'none', null, { timeout: 60_000 });
      await page.waitForFunction(() => !document.querySelector('.status')?.textContent.includes('is being'), null, { timeout: 60_000 });
      const decodes = await mapper(() => window.__decodes);
      check(`${vp} the picture is decoded once, its smaller copies made from the largest`, decodes.filter((d) => d === 'source').length === 1, JSON.stringify(decodes));
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
}

clearTimeout(watchdog);
await browser.close();
await site.close();
check('every request was played', unplayed.length === 0, [...new Set(unplayed)].slice(0, 5).join(', '));
if (measures.desk) console.log(`measure (${which}, desk 1440x900, played): ${measures.desk.text}`);
console.log(`played ${which}: ${checks - fails.length} of ${checks} checks passed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
