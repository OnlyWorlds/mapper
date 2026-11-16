// The world laid out by its links in 3D, here and unsaved, on played OnlyWorlds worlds of its own.
// Every request is answered here; none reaches the real server. A desk and a 390 px touch phone.
// The played walk (walk/played.mjs) runs it as its section `links3d`.
//   npm run build && node walk/links3d.mjs [chromium|firefox]
// MAPPER_DIST serves another build (a control), MAPPER_PORT another port, SHOW=1 prints every check.
import { chromium, firefox } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';

const UNSAVED = 'Drawn here and not saved: nothing is written to the world. Atlas saves a layout.';
const FRESH = 'Laid out from nothing.';
const LOST = 'The last picture could not be kept, so this one was laid out from nothing.';
const kept = (n) => `Kept the picture you last saw here; ${n} placed new.`;
const CEILING = 'This world holds more than 10,000 elements you can see, too many for the mapper to lay out here.';
const NO_PLATE = 'The world’s map was too large to use (more than 10,000 Pins), so this picture has no plate: its pinned elements are laid out with the rest.';
const EMPTY = 'Nothing to lay out for you here.';
const STOPPED = 'Stopped. Nothing was drawn.';
const HEAD = 'By links, in 3D (not saved)';
const KIND = 'a layout · 3D · not saved';
const OFFER = 'Lay out by links, in 3D';

const lid = (w, n) => `${w.slice(0, 8)}-${w.slice(0, 4)}-7${w.slice(1, 4)}-8${w.slice(1, 4)}-${String(n).padStart(12, '0')}`;
const LW = '88888888-8888-7888-8888-888888888888'; // the world: 8 Characters, 4 Locations, a Map pinning 4
const EMPTYW = '89898989-8989-7989-8989-898989898989'; // no element for this reader
const BIG = '8a8a8a8a-8a8a-7a8a-8a8a-8a8a8a8a8a8a'; // 12,001 served Characters by its counts
const NOCOUNT = '8b8b8b8b-8b8b-7b8b-8b8b-8b8b8b8b8b8b'; // no counts served, 10,001 Characters
const PINBIG = '8c8c8c8c-8c8c-7c8c-8c8c-8c8c8c8c8c8c'; // 20,000 Pins by its counts
// A Map whose width is below 0 pinning three Locations: since SDK 4.171.1 such a Map is no plate
// (4.171.0 threw on it), so the picture is drawn with no element on a plate.
const BENT = '8e8e8e8e-8e8e-7e8e-8e8e-8e8e8e8e8e8e';
const SLOW = '8d8d8d8d-8d8d-7d8d-8d8d-8d8d8d8d8d8d'; // 2,000 Characters richly linked, for a Cancel while the layout runs
const COAST = lid(LW, 1);
const C = (n) => lid(LW, 100 + n);
const L = (n) => lid(LW, 200 + n);
const NEW = C(9);

const TYPES = ['ability', 'character', 'collective', 'construct', 'creature', 'event', 'family', 'institution', 'language', 'law', 'location', 'map', 'marker', 'narrative', 'object', 'phenomenon', 'pin', 'relation', 'species', 'title', 'trait', 'zone'];
const counts = (some) => Object.fromEntries(TYPES.map((t) => [t, some[t] ?? 0]));
const json = (status, body) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'RateLimit-Reset' }, body: JSON.stringify(body) });
const page1 = (data) => json(200, { data, has_more: false, next_cursor: null });

const characters = [
  { id: C(1), type: 'character', name: 'Ama', friends: [C(2), C(3)], birthplace: L(1) },
  { id: C(2), type: 'character', name: 'Bree', friends: [C(3)], birthplace: L(2) },
  { id: C(3), type: 'character', name: 'Cato', rivals: [C(4)] },
  { id: C(4), type: 'character', name: 'Dov', friends: [C(5)], location: L(3) },
  { id: C(5), type: 'character', name: 'Eli', friends: [C(6)] },
  { id: C(6), type: 'character', name: 'Fen', friends: [C(4)] },
  { id: C(7), type: 'character', name: 'Gil' },
  { id: C(8), type: 'character', name: 'Hale', hidden: true, friends: [C(1)] },
];
const added = { id: NEW, type: 'character', name: 'Ines', friends: [C(1)] };
const locations = [
  { id: L(1), type: 'location', name: 'Port' },
  { id: L(2), type: 'location', name: 'Mill', parent_location: L(1) },
  { id: L(3), type: 'location', name: 'Ford', parent_location: L(1) },
  { id: L(4), type: 'location', name: 'Cairn' },
];
const coast = { id: COAST, type: 'map', name: 'Coast', width: 1000, height: 800 };
const pins = [
  { id: lid(LW, 301), type: 'pin', map: COAST, element_type: 'location', element_id: L(1), x: 200, y: 300 },
  { id: lid(LW, 302), type: 'pin', map: COAST, element_type: 'location', element_id: L(2), x: 600, y: 200 },
  { id: lid(LW, 303), type: 'pin', map: COAST, element_type: 'location', element_id: L(3), x: 450, y: 650 },
  { id: lid(LW, 304), type: 'pin', map: COAST, element_type: 'character', element_id: C(4), x: 500, y: 500 },
];
const many = (w, n, linked) => Array.from({ length: n }, (_, i) => ({ id: lid(w, 1000 + i), type: 'character', name: `N${i}`, ...(linked && i ? { friends: [lid(w, 1000 + Math.floor(i / 2)), lid(w, 1000 + ((i * 7) % n))] } : {}) }));
let bigRows = null;
let slowRows = null;

/** The played worlds. `state.extra` adds an element to LW (read by a reload, never by the tab's reading). */
function answer(url, state) {
  const u = new URL(url);
  const p = u.pathname;
  const w = u.searchParams.get('world');
  const map = u.searchParams.get('map');
  const ids = u.searchParams.get('ids')?.split(',') ?? null;
  const pick = (rows) => page1(rows.filter((r) => (!map || r.map === map) && (!ids || ids.includes(r.id))));
  const is = (t) => p.startsWith(`/api/v2/${t}/`) || p === `/api/v2/${t}`;
  if (w === LW) {
    const chars = state.extra ? [...characters, added] : characters;
    if (is('world')) return json(200, { id: LW, name: 'Linkwater', counts: { total: 18, types: counts({ map: 1, pin: 4, character: chars.length, location: 4 }) } });
    if (is('map')) return pick([coast]);
    if (is('pin')) return pick(pins);
    if (is('marker')) return page1([]);
    if (is('character')) return pick(chars);
    if (is('location')) return pick(locations);
    return page1([]);
  }
  if (w === EMPTYW) {
    if (is('world')) return json(200, { id: EMPTYW, name: 'Hollow', counts: { total: 0, types: counts({}) } });
    return page1([]);
  }
  if (w === BIG) {
    if (is('world')) return json(200, { id: BIG, name: 'Big', counts: { total: 12001, types: counts({ character: 12001 }) } });
    return page1([]);
  }
  if (w === NOCOUNT) {
    if (is('world')) return json(200, { id: NOCOUNT, name: 'Uncounted' });
    if (is('character')) return page1((bigRows ??= many(NOCOUNT, 10001, false)));
    return page1([]);
  }
  if (w === PINBIG) {
    if (is('world')) return json(200, { id: PINBIG, name: 'Pinned deep', counts: { total: 20003, types: counts({ map: 1, pin: 20000, character: 3 }) } });
    if (is('map')) return pick([{ id: lid(PINBIG, 1), type: 'map', name: 'Deep pins', width: 100, height: 100 }]);
    if (is('character')) return pick([{ id: lid(PINBIG, 11), type: 'character', name: 'One', friends: [lid(PINBIG, 12)] }, { id: lid(PINBIG, 12), type: 'character', name: 'Two' }, { id: lid(PINBIG, 13), type: 'character', name: 'Three' }]);
    return page1([]);
  }
  if (w === BENT) {
    const bent = lid(BENT, 1);
    if (is('world')) return json(200, { id: BENT, name: 'Bent', counts: { total: 7, types: counts({ map: 1, pin: 3, location: 3 }) } });
    if (is('map')) return pick([{ id: bent, type: 'map', name: 'Bent', width: -5, height: 100 }]);
    if (is('pin')) return pick([1, 2, 3].map((n) => ({ id: lid(BENT, 20 + n), type: 'pin', map: bent, element_type: 'location', element_id: lid(BENT, 10 + n), x: 10 * n, y: 10 })));
    if (is('location')) return pick([1, 2, 3].map((n) => ({ id: lid(BENT, 10 + n), type: 'location', name: `Bend ${n}` })));
    return page1([]);
  }
  if (w === SLOW) {
    if (is('world')) return json(200, { id: SLOW, name: 'Slow', counts: { total: 2000, types: counts({ character: 2000 }) } });
    if (is('character')) return page1((slowRows ??= many(SLOW, 2000, true)));
    return page1([]);
  }
  return json(404, { error: { code: 'not_found', message: 'World not found.' } });
}

const waitUntil = async (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

/**
 * The section for one viewport. `check(label, ok, detail)` counts; `base` is the served build's address.
 */
export async function links3dWalk({ browser, which, vp, opts, check, base }) {
  const phone = vp === 'phone';
  mkdirSync('.scratch/shots', { recursive: true });
  let shotN = 0;
  const ctx = await browser.newContext(opts);
  const state = { extra: false, slow: null, slowMs: 0, faults: [] };
  /** Every request the page makes, to anywhere, with its method. */
  const all = [];
  /** The OnlyWorlds reads, in order. */
  const sent = [];
  await ctx.route('https://www.onlyworlds.com/**', async (route) => {
    const url = route.request().url();
    const u = new URL(url);
    sent.push(u);
    const type = u.pathname.split('/')[3];
    const whole = !u.searchParams.has('ids') && !u.searchParams.has('map') && !['world', 'map', 'marker'].includes(type);
    const f = state.faults.findIndex((x) => x === type && whole);
    if (f >= 0) {
      state.faults.splice(f, 1);
      return route.fulfill(json(500, { error: { code: 'server_error', message: 'played' } }));
    }
    if (state.slow === type && whole) {
      setTimeout(() => route.fulfill(answer(url, state)).catch(() => {}), state.slowMs);
      return;
    }
    return route.fulfill(answer(url, state));
  });
  const page = await ctx.newPage();
  page.on('request', (r) => all.push(`${r.method()} ${r.url()}`));
  const errors = [];
  /** The layout's own errors, kept for the console by the page on purpose (the bent Map's case). */
  const layoutErrors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().startsWith('by-links-3d: ')) layoutErrors.push(m.text());
    else if (m.type() === 'error' && !/^Failed to load resource|CORS request did not succeed/.test(m.text())) errors.push(m.text());
    if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) errors.push(m.text());
  });
  const snap = (name) => page.screenshot({ path: `.scratch/shots/links3d-${which}-${vp}-${String(++shotN).padStart(2, '0')}-${name}.png` }).catch(() => {});
  const where = () => page.evaluate(() => location.search);
  const info = () => page.evaluate(() => window.__mapper?.links3d ?? null);
  const drawn = () => waitUntil(page, () => !!window.__mapper?.links3d && window.__mapper.scene?.complete === true);
  const heldLine = async () => ((await page.locator('.held3d').count()) ? (await page.locator('.held3d').first().innerText()).replace(/\s*Lay out again from nothing\s*$/, '').trim() : null);
  const statusText = async () => (await page.locator('.status').count() ? await page.locator('.status').first().innerText() : '');
  const boxText = async () => ((await page.locator('.links3d .status-page').count()) ? (await page.locator('.links3d .status-page').innerText()).trim() : null);
  const wholeReads = (from) => sent.slice(from).filter((u) => {
    const type = u.pathname.split('/')[3];
    return !u.searchParams.has('ids') && !u.searchParams.has('map') && !['world', 'map', 'marker'].includes(type);
  }).map((u) => u.pathname.split('/')[3]);
  const holdOf = (key) => page.evaluate((k) => new Promise((ok) => {
    const req = indexedDB.open('mapper-holds');
    req.onerror = () => ok(null);
    req.onsuccess = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('points')) return ok(null);
      const g = d.transaction('points').objectStore('points').get(k);
      g.onsuccess = () => {
        const v = g.result;
        d.close();
        ok(v ? { ids: v.ids, xyz: [...v.xyz], at: v.at } : null);
      };
      g.onerror = () => ok(null);
    };
  }), key);
  const plant = (key, value) => page.evaluate(([k, v]) => new Promise((ok) => {
    const req = indexedDB.open('mapper-holds', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('points');
      req.result.createObjectStore('times');
    };
    req.onsuccess = () => {
      const d = req.result;
      const tx = d.transaction(['points', 'times'], 'readwrite');
      tx.objectStore('points').put({ ...v, xyz: new Float64Array(v.xyz) }, k);
      tx.objectStore('times').put(v.at, k);
      tx.oncomplete = () => {
        d.close();
        ok(true);
      };
    };
  }), [key, value]);
  const KEY = `${LW}|public|public`;
  const pointsById = (l) => new Map(l.ids.map((x, i) => [x, l.xyz.slice(3 * i, 3 * i + 3).join(',')]));

  // 1. A world's page offers the press, with its words. (The control's first check: no press there.)
  await page.goto(`${base}/?world=${LW}`);
  await page.waitForSelector('.map-row', { timeout: 20_000 }).catch(() => {});
  const offer = page.locator('.links3d-offer button.links3d-press');
  check(`${vp} links3d a world's page offers "${OFFER}"`, (await offer.count()) === 1 && (await offer.innerText()).trim() === OFFER, `${await offer.count()} buttons`);
  await snap('offer');

  // 2. The press: pushed, the running line with its count and time, and Cancel; all fit on a phone.
  const histBefore = await page.evaluate(() => history.length);
  state.slow = 'location';
  state.slowMs = 1500;
  let from = sent.length;
  await offer.click();
  const running = await waitUntil(page, () => /^Reading what you can see of the world: [\d,]+ elements? so far, \d+ s\.$/.test(document.querySelector('.running3d')?.textContent ?? ''), null, 10_000);
  check(`${vp} links3d the press writes &layout=by-links-3d by pushState`, (await where()) === `?world=${LW}&layout=by-links-3d` && (await page.evaluate(() => history.length)) === histBefore + 1, `${await where()}`);
  check(`${vp} links3d while it reads, the running line counts elements and time, with Cancel`, running && (await page.locator('button.cancel3d').count()) === 1, String(await page.locator('.running3d').textContent().catch(() => null)));
  check(`${vp} links3d the page's head names it, and says it is not saved`, (await page.locator('.links3d h1').innerText()) === HEAD && (await page.locator('.links3d').innerText()).includes(UNSAVED));
  if (phone) {
    const fit = await page.evaluate(() => {
      const r = (s) => document.querySelector(s)?.getBoundingClientRect();
      const out = [r('.running3d'), r('button.cancel3d'), r('.links3d h1')].map((b) => (b ? [Math.round(b.left), Math.round(b.right)] : null));
      return { out, sw: document.documentElement.scrollWidth, w: innerWidth };
    });
    check(`${vp} links3d the running line and Cancel fit at 390 px, no sideways scroll`, fit.out.every((b) => b && b[0] >= 0 && b[1] <= fit.w) && fit.sw <= fit.w, JSON.stringify(fit));
    await snap('running');
  }
  const ok1 = await drawn();
  state.slow = null;
  const first = await info();
  const reads1 = wholeReads(from);
  check(`${vp} links3d the picture is drawn: one Pin per element this reader sees (11 of 12, the hidden one cut), with links`, ok1 && first?.nodes === 11 && (await page.evaluate(() => window.__mapper.scene.counts.pins)) === 11 && (await page.evaluate(() => window.__mapper.scene.counts.lines)) >= 8, JSON.stringify({ nodes: first?.nodes, counts: await page.evaluate(() => window.__mapper.scene?.counts) }));
  check(`${vp} links3d the world's map is the plate: its four pinned elements stand at their Pins`, first?.plate === 4, JSON.stringify({ plate: first?.plate }));
  check(`${vp} links3d a first press says "${FRESH}"`, (await heldLine()) === FRESH, String(await heldLine()));
  check(`${vp} links3d the bar names the map and its kind`, (await page.locator('.map-name').innerText()) === HEAD && (await page.locator('.kind').innerText()) === KIND, `${await page.locator('.kind').innerText()}`);
  check(`${vp} links3d the lines say Atlas saves a layout, the method may change, and when the world was read`, /Atlas saves a layout/.test(await statusText()) && /later version/.test(await statusText()) && /From the world as read at \d\d:\d\d; a reload reads it again\./.test(await statusText()), (await statusText()).slice(0, 400));
  // The world's page already read every Pin for its counts (4 fit one read): the press reads them no more.
  check(`${vp} links3d it reads each element type keel counts above 0 once, and the Pins no more`, JSON.stringify([...reads1].sort()) === JSON.stringify(['character', 'location']), JSON.stringify(reads1));
  const on3d = await waitUntil(page, () => window.__mapper.view3d?.state === 'on', null, 30_000);
  check(`${vp} links3d it opens in 3D`, on3d, JSON.stringify(await page.evaluate(() => window.__mapper.view3d)));
  await page.waitForTimeout(500);
  await snap('drawn');
  check(`${vp} links3d the address is unchanged by the drawing (no map, no camera)`, (await where()) === `?world=${LW}&layout=by-links-3d`, await where());
  if (!phone) console.log(`  links3d ${which} measure: Linkwater, ${first?.nodes} elements: layout in the worker ${first?.layoutMs?.toFixed(1)} ms, build ${first?.buildMs?.toFixed(1)} ms`);

  // The card and the List: names and types from this page's rows, no position line.
  await page.locator('.tools button', { hasText: 'List' }).click();
  await page.waitForSelector('.list-rows .row', { timeout: 5000 }).catch(() => {});
  const listMeta = await page.locator('.list-rows .row-meta').allInnerTexts();
  check(`${vp} links3d the List names each element and its type, no position`, listMeta.length === 11 && listMeta.every((m) => /^(Character|Location)$/.test(m)), JSON.stringify(listMeta.slice(0, 4)));
  await page.locator('.list-rows .row', { hasText: 'Port' }).first().click();
  await page.waitForTimeout(400);
  const card = await page.locator('.card').innerText().catch(() => '');
  check(`${vp} links3d the card reads the element from this page's rows, with its links and no position`, /Port/.test(card) && /Location/.test(card) && (await page.locator('.card .pos').count()) === 0 && /Linked on this map/.test(card), card.slice(0, 200));
  if (phone) await page.locator('.card button.close').first().click().catch(() => {});
  else await page.keyboard.press('Escape');

  // 3. The hold: kept on this device, per world and reader, the rounded points in the answer's frame.
  const h1 = await holdOf(KEY);
  check(`${vp} links3d the picture is kept on this device under the world and the public reader`, !!h1 && JSON.stringify(h1.ids) === JSON.stringify(first.ids) && JSON.stringify(h1.xyz) === JSON.stringify(first.xyz) && h1.xyz.every(Number.isInteger), JSON.stringify(h1)?.slice(0, 160));

  // 4. Back to the world's maps: the made-up Map is in no list and no count.
  await page.locator('button.back').click();
  await page.waitForSelector('.map-row', { timeout: 10_000 }).catch(() => {});
  const rows = await page.locator('.map-row .row-name').allInnerTexts();
  check(`${vp} links3d Back returns to the world's maps, which hold only the world's own`, (await where()) === `?world=${LW}` && JSON.stringify(rows) === '["Coast"]', `${await where()} ${JSON.stringify(rows)}`);
  check(`${vp} links3d the world's Pin count is its own`, (await page.locator('.map-row .row-meta').first().innerText()).includes('4 Pins'), await page.locator('.map-row .row-meta').first().innerText());

  // 5. A second press in the tab: this tab's reading (no type read again) and the hold: nothing moves.
  from = sent.length;
  await page.locator('.links3d-offer button.links3d-press').click();
  await drawn();
  const second = await info();
  check(`${vp} links3d a second press keeps the picture: "${kept(0)}"`, (await heldLine()) === kept(0) && second?.from === 'kept', String(await heldLine()));
  check(`${vp} links3d a second press in the tab reads no element type again`, wholeReads(from).length === 0, JSON.stringify(wholeReads(from)));
  check(`${vp} links3d every kept element stands at its held point, in the answer's frame, to the unit`, JSON.stringify(second?.xyz) === JSON.stringify(h1?.xyz) && JSON.stringify(second?.ids) === JSON.stringify(h1?.ids));

  if (!phone) {
    // 6. Lay out again from nothing: drawn fresh, without the hold, and the hold replaced.
    const atBefore = (await holdOf(KEY))?.at ?? 0;
    await page.waitForTimeout(20);
    await page.locator('.held3d button.again3d').click();
    await waitUntil(page, () => document.querySelector('.held3d')?.textContent?.startsWith('Laid out from nothing.') === true, null, 20_000);
    await drawn();
    check(`${vp} links3d Lay out again from nothing says "${FRESH}"`, (await heldLine()) === FRESH && (await info())?.from === 'nothing', String(await heldLine()));
    const h2 = await holdOf(KEY);
    check(`${vp} links3d Lay out again from nothing replaces the hold`, !!h2 && h2.at > atBefore, `${atBefore} -> ${h2?.at}`);

    // 7. Flat: written beside layout, kept by a reload; a gesture writes no camera; 3D drops it.
    await page.locator('button.view-toggle').click();
    await page.waitForTimeout(400);
    check(`${vp} links3d Flat writes view=flat beside layout`, (await where()) === `?world=${LW}&layout=by-links-3d&view=flat` && (await page.evaluate(() => window.__mapper.view3d?.state)) !== 'on', await where());
    await page.mouse.move(700, 600);
    await page.mouse.down();
    await page.mouse.move(820, 660, { steps: 6 });
    await page.mouse.up();
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(900);
    check(`${vp} links3d a flat gesture writes no camera on this view`, !(await where()).includes('at=') && !(await page.evaluate(() => window.__mapper.writes.some((w) => w.url.includes('at=') || w.url.includes('map=')))), JSON.stringify(await page.evaluate(() => window.__mapper.writes)));
    from = sent.length;
    await page.reload();
    await drawn();
    check(`${vp} links3d a reload of the Flat address runs it again, flat, with the hold`, (await page.evaluate(() => window.__mapper.view3d?.state)) !== 'on' && (await heldLine()) === kept(0) && wholeReads(from).length > 0, `${await page.evaluate(() => window.__mapper.view3d?.state)} ${await heldLine()}`);
    await snap('flat');
    await page.locator('button.view-toggle').click();
    await waitUntil(page, () => window.__mapper.view3d?.state === 'on', null, 20_000);
    check(`${vp} links3d 3D drops view=flat`, (await where()) === `?world=${LW}&layout=by-links-3d`, await where());

    // 8. An element added, then a reload (a reload reads again): it alone is placed new; nothing else moves.
    const before = await holdOf(KEY);
    state.extra = true;
    await page.reload();
    await drawn();
    const third = await info();
    const was = pointsById(before);
    const now = pointsById(third);
    const moved = [...was].filter(([k, v]) => now.get(k) !== v).map(([k]) => k);
    check(`${vp} links3d an element added between presses (a reload between): "${kept(1)}"`, (await heldLine()) === kept(1) && third?.fresh === 1 && now.has(NEW) && !was.has(NEW), String(await heldLine()));
    check(`${vp} links3d nothing else moved: every kept element's point equal by bytes, in the answer's frame`, moved.length === 0 && was.size === 11, `${moved.length} moved of ${was.size}`);
    state.extra = false;

    // 9. A bad hold planted: laid out from nothing, with its line. A corrupt value, then one the method refuses (held-box).
    await plant(KEY, { v: 1, key: KEY, at: Date.now(), ids: [C(1)], xyz: [1.5, 0, 0] });
    await page.reload();
    await drawn();
    check(`${vp} links3d a hold that cannot be read is laid out from nothing, and said`, (await heldLine()) === LOST && (await info())?.from === 'lost', String(await heldLine()));
    await plant(KEY, { v: 1, key: KEY, at: Date.now(), ids: [C(1), C(2)], xyz: [0, 0, 0, 60 * 800, 0, 0] });
    await page.reload();
    await drawn();
    check(`${vp} links3d a hold the method refuses (held-box) is laid out from nothing, and said`, (await heldLine()) === LOST && (await info())?.from === 'lost', String(await heldLine()));
    const fixed = await holdOf(KEY);
    check(`${vp} links3d the refused hold is replaced by the new picture`, !!fixed && fixed.ids.length === 11 && fixed.xyz.every(Number.isInteger));
  }

  // 10. Cancel while it reads: nothing drawn after, and the next press reads only what was not read whole.
  await page.goto(`${base}/?world=${LW}`);
  await page.waitForSelector('.links3d-offer button.links3d-press', { timeout: 20_000 });
  state.slow = 'location';
  state.slowMs = 2500;
  from = sent.length;
  await page.locator('.links3d-offer button.links3d-press').click();
  await waitUntil(page, () => !!document.querySelector('button.cancel3d'), null, 10_000);
  await page.waitForTimeout(700);
  await page.locator('button.cancel3d').click();
  await page.waitForTimeout(3500);
  const readsBefore = wholeReads(from);
  check(`${vp} links3d Cancel while it reads: "${STOPPED}", and nothing drawn after`, (await boxText())?.startsWith(STOPPED) && (await page.evaluate(() => window.__mapper.scene)) === null && (await info()) === null, `${await boxText()}`);
  state.slow = null;
  from = sent.length;
  await page.locator('.links3d .status-page button.again3d').click();
  await drawn();
  check(`${vp} links3d the press after a Cancel reads only what was not read whole`, JSON.stringify(wholeReads(from)) === JSON.stringify(['location']) && readsBefore.includes('character'), `before ${JSON.stringify(readsBefore)}, after ${JSON.stringify(wholeReads(from))}`);

  // 11. Cancel while the worker lays it out (2,000 richly linked elements): the worker ends, nothing drawn after.
  await page.goto(`${base}/?world=${SLOW}&layout=by-links-3d`);
  const laying = await waitUntil(page, () => /^Laying out the [\d,]+ elements read, \d+ s so far\.$/.test(document.querySelector('.running3d')?.textContent ?? ''), null, 30_000);
  const linesAt = await page.locator('.running3d').textContent().catch(() => null);
  if (laying) await page.locator('button.cancel3d').click();
  await page.waitForTimeout(phone ? 4000 : 6000);
  check(`${vp} links3d Cancel while the layout runs: "${STOPPED}", and nothing drawn after`, laying && (await boxText())?.startsWith(STOPPED) && (await page.evaluate(() => window.__mapper.scene)) === null && (await info()) === null, `${laying ? 'cancelled at' : 'never saw'} "${linesAt}"; now ${await boxText()}`);
  if (!phone) {
    await page.locator('.links3d .status-page button.again3d').click();
    await drawn();
    const big = await info();
    check(`${vp} links3d a world of 2,000 richly linked elements draws`, big?.nodes === 2000, JSON.stringify({ nodes: big?.nodes }));
    console.log(`  links3d ${which} measure: Slow, ${big?.nodes} elements: layout in the worker ${big?.layoutMs?.toFixed(1)} ms, build ${big?.buildMs?.toFixed(1)} ms`);
  }

  // 12. Leaving by Back while it reads (inside the page): the world's maps, and nothing drawn after.
  await page.goto(`${base}/?world=${LW}`);
  await page.waitForSelector('.links3d-offer button.links3d-press', { timeout: 20_000 });
  state.slow = 'character';
  state.slowMs = 2500;
  await page.locator('.links3d-offer button.links3d-press').click();
  await waitUntil(page, () => !!document.querySelector('button.cancel3d'), null, 10_000);
  await page.goBack();
  const leftAt = sent.length;
  await page.waitForTimeout(3500);
  check(`${vp} links3d Back while it reads returns to the maps, draws nothing and reads on no further`, (await where()) === `?world=${LW}` && (await page.evaluate(() => window.__mapper.scene)) === null && (await info()) === null && (await page.locator('.map-row').count()) === 1 && wholeReads(leftAt).length === 0, `${await where()} ${JSON.stringify(wholeReads(leftAt))}`);
  state.slow = null;

  if (!phone) {
    // 13. A failed read: its words and Try again, which resumes at the types not read whole.
    await page.goto(`${base}/?world=${LW}`);
    await page.waitForSelector('.links3d-offer button.links3d-press', { timeout: 20_000 });
    state.faults.push('location');
    from = sent.length;
    await page.locator('.links3d-offer button.links3d-press').click();
    await waitUntil(page, () => !!document.querySelector('.links3d .failure .retry'), null, 15_000);
    const failText = await boxText();
    check(`${vp} links3d a failed read says so, with Try again`, failText === 'OnlyWorlds could not answer the elements read (500). Try again', String(failText));
    const beforeRetry = wholeReads(from);
    await page.locator('.links3d .failure .retry').click();
    await drawn();
    check(`${vp} links3d Try again draws, reading only what failed and what came after`, JSON.stringify(wholeReads(from).slice(beforeRetry.length)) === JSON.stringify(['location']) && (await info())?.nodes === 11, `${JSON.stringify(beforeRetry)} then ${JSON.stringify(wholeReads(from).slice(beforeRetry.length))}`);

    // 14. The ceiling: no press offered, and a shared link reads nothing.
    await page.goto(`${base}/?world=${BIG}`);
    await page.waitForSelector('.links3d-offer', { timeout: 20_000 }).catch(() => {});
    check(`${vp} links3d above the ceiling the press is not offered, and a line says why`, (await page.locator('.links3d-offer button').count()) === 0 && (await page.locator('.links3d-offer .ceiling3d').innerText().catch(() => '')) === CEILING);
    from = sent.length;
    await page.goto(`${base}/?world=${BIG}&layout=by-links-3d`);
    await waitUntil(page, () => !!document.querySelector('.ceiling3d'), null, 15_000);
    check(`${vp} links3d a shared link above the ceiling says so and reads no element`, (await boxText()) === CEILING && wholeReads(from).length === 0, `${await boxText()} ${JSON.stringify(wholeReads(from))}`);
    from = sent.length;
    await page.goto(`${base}/?world=${NOCOUNT}&layout=by-links-3d`);
    await waitUntil(page, () => !!document.querySelector('.ceiling3d'), null, 30_000);
    const nc = wholeReads(from);
    check(`${vp} links3d with no counts served, the read stops past 10,000 elements and says so`, (await boxText()) === CEILING && nc.at(-1) === 'character' && !nc.includes('location') && (await info()) === null, `${await boxText()} ${JSON.stringify(nc)}`);

    // 15. The empty world, and a world whose Pins are past their ceiling.
    await page.goto(`${base}/?world=${EMPTYW}&layout=by-links-3d`);
    await waitUntil(page, () => !!document.querySelector('.empty3d'), null, 15_000);
    check(`${vp} links3d a world with nothing for this reader says "${EMPTY}"`, (await boxText()) === EMPTY, String(await boxText()));
    from = sent.length;
    await page.goto(`${base}/?world=${PINBIG}&layout=by-links-3d`);
    await drawn();
    check(`${vp} links3d Pins past their ceiling: drawn with no plate, said, and no Pin read`, (await statusText()).includes(NO_PLATE) && !sent.slice(from).some((u) => u.pathname.startsWith('/api/v2/pin')) && (await info())?.nodes === 3, (await statusText()).slice(0, 300));
  }

  if (!phone) {
    // 16. A served Map with a width below 0 is no plate: the picture is drawn, no element on a plate.
    await page.goto(`${base}/?world=${BENT}&layout=by-links-3d`);
    await drawn();
    const bent = await info();
    check(`${vp} links3d a Map with a width below 0 is no plate: drawn, no element on a plate`, bent?.nodes === 3 && bent?.plate === 0 && layoutErrors.length === 0, JSON.stringify({ nodes: bent?.nodes, plate: bent?.plate, errors: layoutErrors.length }));

    // 17. A layout that throws: the worker's file is played as one whose layout fails. Its words and
    // Try again, the error kept in the console, nothing drawn; Try again lays out again.
    const worker = '**/assets/links3d.worker-*.js';
    await ctx.route(worker, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: "self.onmessage = () => self.postMessage({ ok: false, message: 'Error: played layout failure' });" }));
    await page.goto(`${base}/?world=${LW}&layout=by-links-3d`);
    await waitUntil(page, () => !!document.querySelector('.links3d .failure .retry'), null, 20_000);
    check(`${vp} links3d a layout that throws says "This world could not be laid out." with Try again, kept in the console`, (await boxText()) === 'This world could not be laid out. Try again' && (await info()) === null && layoutErrors.some((e) => /played layout failure/.test(e)), `${await boxText()} | ${layoutErrors.join(' | ').slice(0, 200)}`);
    await ctx.unroute(worker);
    await page.locator('.links3d .failure .retry').click();
    await drawn();
    check(`${vp} links3d its Try again lays out again`, (await info())?.nodes === 11 && (await page.locator('.links3d .failure').count()) === 0, JSON.stringify({ nodes: (await info())?.nodes }));
  }

  // 18. Nothing written: every request the page made was a GET, and nothing left for OnlyWorlds but reads.
  const notGet = all.filter((r) => !r.startsWith('GET '));
  check(`${vp} links3d every request is a GET (${all.length} requests)`, notGet.length === 0, notGet.slice(0, 3).join(' | '));
  if (process.env.SHOW) for (const r of [...new Set(all.map((x) => x.replace(/\?.*$/, '')))]) console.log(`    request ${r}`);
  check(`${vp} links3d no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// Run alone: both viewports in one engine.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('walk/links3d.mjs')) {
  const which = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
  const engine = which === 'firefox' ? firefox : chromium;
  const site = await serve(process.env.MAPPER_DIST ?? 'dist', Number(process.env.MAPPER_PORT ?? 4187), '127.0.0.1', { drop: which === 'firefox' ? ['Cross-Origin-Opener-Policy'] : [] });
  const browser = await engine.launch();
  const watchdog = setTimeout(() => {
    console.error('links3d: watchdog, 600 s');
    process.exit(2);
  }, 600_000);
  let checks = 0;
  const fails = [];
  const check = (label, ok, detail = '') => {
    checks++;
    if (process.env.SHOW) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${which} ${label}${detail ? `: ${detail}` : ''}`);
    if (!ok) fails.push(`${which} ${label}${detail ? `: ${detail}` : ''}`);
  };
  for (const [vp, opts] of [
    ['desk', { viewport: { width: 1440, height: 900 } }],
    ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3, ...(which === 'chromium' ? { isMobile: true } : {}) }],
  ]) {
    try {
      await links3dWalk({ browser, which, vp, opts, check, base: site.url });
    } catch (e) {
      check(`${vp} section links3d ran to its end`, false, String(e?.message ?? e).split('\n')[0].slice(0, 300));
    }
  }
  clearTimeout(watchdog);
  await browser.close();
  await site.close();
  console.log(`links3d ${which}: ${checks - fails.length} of ${checks} checks passed`);
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(fails.length ? 1 : 0);
}
