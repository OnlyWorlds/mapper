// The played walk: the built page against a played OnlyWorlds. Every request to the API is answered
// from the recorded fixtures (walk/record.mjs) or from a small played world made here, none reaches
// the real server; pictures come from the recording too. At a desk and on a 390 px touch phone.
//   npm run build && node walk/played.mjs [chromium|firefox]
// Screenshots go to .scratch/shots/. Exits 1 on any failed check.
import { chromium, firefox } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { serve } from './serve.mjs';
import { keyOf, MOPPETOPIA as M, SIKELIA as S, M_MAP, M_SPACE, M_LAYOUT, S_BIG, S_ELEMENT, M_ELEMENT, AT } from './worlds.mjs';

const which = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const engine = which === 'firefox' ? firefox : chromium;
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
const json = (status, body, headers = {}) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'RateLimit-Reset', ...headers }, body: JSON.stringify(body) });
const page1 = (data) => json(200, { data, has_more: false, next_cursor: null });
function played(url) {
  const u = new URL(url);
  const w = u.searchParams.get('world');
  if (u.pathname.startsWith('/api/v2/world') && w === NOPE) return json(404, { error: { code: 'not_found', message: 'World not found.' } });
  if (u.pathname.includes(`/location/${GONE}`)) return json(404, { error: { code: 'not_found', message: 'Not found.' } });
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

const site = await serve('dist', 4187);
const browser = await engine.launch();
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
  // Faults, each used once: a key part and how to answer it.
  const faults = [];
  await ctx.route('https://www.onlyworlds.com/**', async (route) => {
    const url = route.request().url();
    const k = keyOf(url);
    const f = faults.findIndex((x) => k.includes(x.match));
    if (f >= 0) {
      const [fault] = faults.splice(f, 1);
      if (fault.abort) return route.abort('failed');
      return route.fulfill(fault.answer);
    }
    const p = played(url);
    if (p) return route.fulfill(p);
    const hit = fx.api[k];
    if (hit) return route.fulfill({ status: hit.status, contentType: hit.type, headers: { 'access-control-allow-origin': '*' }, body: hit.body });
    unplayed.push(k);
    return route.fulfill(json(599, { error: { code: 'unplayed', message: 'not in the fixtures' } }));
  });
  await ctx.route('https://media.onlyworlds.com/**', async (route) => {
    const m = fx.media[route.request().url()];
    if (!m) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: m.type, headers: { 'access-control-allow-origin': '*' }, body: readFileSync(`.scratch/fixtures/media/${m.file}`) });
  });
  await ctx.route('http://media.example/**', (route) => route.abort('failed'));
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

  // 1. The front page, and an id that is not one: said, nothing read.
  await page.goto(`${site.url}/`);
  await page.fill('#world-id', 'not-an-id');
  await page.click('.open-form button[type=submit]');
  check(`${vp} a malformed id is said`, (await page.textContent('.intro .error')).includes('This is not a world id'));
  await snap('front');

  // 2. A world that is not public, or not there: one sentence and the key form.
  await page.goto(`${site.url}/?world=${NOPE}`);
  await page.waitForSelector('.key-form');
  check(`${vp} a 404 world says it may be mistyped or private`, (await page.textContent('main')).includes('No public world has this id. It may be mistyped, or private: paste a key to open it.'));
  await page.fill('#world-key', '1234567890');
  await page.click('.key-form button[type=submit]');
  check(`${vp} a legacy key is refused`, (await page.textContent('.key-form .error')).includes('Keys of ten digits are not taken here'));
  await snap('not-public');

  // 3. Moppetopia's maps: words, kinds and counts as soon as the reads land.
  await page.goto(`${site.url}/?world=${M}`);
  await page.waitForSelector('.map-row');
  await page.waitForFunction(() => document.querySelectorAll('.map-row .row-meta')[0]?.textContent.includes('Pin'));
  const rows = await page.$$eval('.map-row', (els) => els.map((e) => e.textContent));
  check(`${vp} the Maps list`, rows.length === 3 && rows.some((r) => r.includes('MoppetopiaMapa picture · 5 Pins')) && rows.some((r) => r.includes('a layout · 3D · 170 Pins')), JSON.stringify(rows));
  await snap('maps');

  // 4. A pictured map, pressed: the address gains its map by a push.
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

  // 5. A layout map: lines always, its depth said, its ground drawn.
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

  // 6. The element view by address: its first Map not written, the element selected and marked.
  await page.goto(`${site.url}/?world=${M}&type=location&element=${M_ELEMENT}`);
  await complete();
  const head = await page.textContent('.element-head');
  check(`${vp} the element view names the element and its maps`, head.includes('Puddleton') && head.includes('on 2 maps') && (await page.locator('.element-head .chip').count()) === 2, head);
  check(`${vp} the element view's first Map is not written`, !(await where()).includes('map=') && (await mapper(() => history.state?.map)) === M_MAP);
  const sel = await mapper(() => window.__mapper.selection);
  check(`${vp} the element view selects the element's items`, sel.length === 1 && (await page.textContent('.card h2')).includes('Puddleton'), JSON.stringify(sel));
  await snap('element');
  await page.click(`.element-head .chip:has-text("Moppetopia: layout")`);
  await complete();
  check(`${vp} another of its Maps is a press away`, (await where()).includes(`map=${M_LAYOUT}`));
  await page.goBack();
  await complete();
  check(`${vp} Back returns to the element's first Map`, !(await where()).includes('map=') && (await page.textContent('.map-name')) === 'MoppetopiaMap');
  // Without a type, the long way, said.
  await page.goto(`${site.url}/?world=${M}&element=${M_ELEMENT}`);
  await complete();
  check(`${vp} an address without a type takes the long way and says so`, (await page.textContent('.element-head')).includes('found the long way'));
  await page.goto(`${site.url}/?world=${M}&type=location&element=${GONE}`);
  await page.waitForSelector('.status-page .error');
  check(`${vp} an element not there is said`, (await page.textContent('.status-page')).includes('No element with this id that this reader can see in this world.'));

  // 7. A failed read with Try again, then a 429 waited out: on a Map opened by address with a camera.
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

  // 8. A stranger's text stays text; a picture on http is not drawn.
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

  // 9. Sikelia: a world too large for per-map counts, its largest map, its layout, an element.
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

  // 10. The measure readout on Sikelia's largest map: a scripted pan and zoom over the picture.
  if (!phone) {
    await page.goto(`${site.url}/?world=${S}&map=${S_BIG}&measure=1`);
    await complete();
    await page.waitForFunction(() => document.querySelector('.readout')?.dataset.firstDraw !== 'none', null, { timeout: 60_000 });
    await page.waitForFunction(() => !document.querySelector('.status')?.textContent.includes('is being'), null, { timeout: 60_000 });
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
    await snap('measure');
  }

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
