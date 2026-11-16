// The unplaced line on a played OnlyWorlds: what a saved `by-kind` layout map does not place (the
// default layouts page, `unplaced`). Every request is answered by the played world below; none
// reaches the real server. A desk in Chromium or Firefox.
//   npm run build && node walk/unplaced.mjs [chromium|firefox]
// MAPPER_DIST serves another build (a control), MAPPER_PORT another port. Exits 1 on any failed check.
import { chromium, firefox } from '@playwright/test';
import { serve } from './serve.mjs';

const which = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const engine = which === 'firefox' ? firefox : chromium;
const DIST = process.env.MAPPER_DIST ?? 'dist';
const PORT = Number(process.env.MAPPER_PORT ?? 4188);

const W = '66666666-6666-7666-8666-666666666666';
const BIG = '77777777-7777-7777-8777-777777777777';
const id = (n) => `66666666-6666-7666-8666-${String(n).padStart(12, '0')}`;
const BYKIND = id(1);
const BYKIND2 = id(2);
const AROUND = id(3);
const PLAIN = id(4);
const DEEP = id(5);
const HAND = id(6);
const BIGMAP = '77777777-7777-7777-8777-000000000001';
const C1 = id(11);
const C2 = id(12);
const C3 = id(13);
const C4 = id(14);
const Z1 = id(21);

// C1 pinned; C2's Pin has no whole x; C3 hidden (a public reader's graph cuts it); C4's Pin names
// its element with no element_type; Z1 outlined on the map by Markers and never pinned.
// Expected on BYKIND for the public reader: C2, C4 and Z1 not placed, 3.
const maps = [
  { id: BYKIND, type: 'map', name: 'By kind', width: 1000, height: 1000, x_layout: { method: 'by-kind' } },
  { id: BYKIND2, type: 'map', name: 'By kind, every one', width: 1000, height: 1000, x_layout: { method: 'by-kind' } },
  { id: AROUND, type: 'map', name: 'Around', width: 1000, height: 1000, x_layout: { method: 'around' } },
  { id: PLAIN, type: 'map', name: 'Plain', width: 1000, height: 1000 },
  { id: DEEP, type: 'map', name: 'By kind, deep', width: 1000, height: 1000, depth: 500, x_layout: { method: 'by-kind' } },
  { id: HAND, type: 'map', name: 'By hand', width: 1000, height: 1000, x_layout: { method: 'hand' } },
];
const pins = [
  { id: id(31), type: 'pin', map: BYKIND, element_type: 'character', element_id: C1, x: 100, y: 100 },
  { id: id(32), type: 'pin', map: BYKIND, element_type: 'character', element_id: C2, x: 'ten', y: 100 },
  { id: id(33), type: 'pin', map: BYKIND, element_id: C4, x: 300, y: 300 },
  { id: id(34), type: 'pin', map: BYKIND2, element_type: 'character', element_id: C1, x: 100, y: 100 },
  { id: id(35), type: 'pin', map: BYKIND2, element_type: 'character', element_id: C2, x: 200, y: 100 },
  { id: id(36), type: 'pin', map: BYKIND2, element_type: 'character', element_id: C4, x: 300, y: 100 },
  { id: id(37), type: 'pin', map: BYKIND2, element_type: 'zone', element_id: Z1, x: 400, y: 100 },
  { id: id(38), type: 'pin', map: AROUND, element_type: 'character', element_id: C1, x: 100, y: 100 },
  { id: id(39), type: 'pin', map: PLAIN, element_type: 'character', element_id: C1, x: 100, y: 100 },
  { id: id(40), type: 'pin', map: DEEP, element_type: 'character', element_id: C1, x: 100, y: 100, z: 10 },
  { id: id(41), type: 'pin', map: HAND, element_type: 'character', element_id: C1, x: 100, y: 100 },
];
const markers = [
  { id: id(51), type: 'marker', map: BYKIND, zone: Z1, x: 500, y: 500, order: 0 },
  { id: id(52), type: 'marker', map: BYKIND, zone: Z1, x: 700, y: 500, order: 1 },
  { id: id(53), type: 'marker', map: BYKIND, zone: Z1, x: 600, y: 700, order: 2 },
];
const characters = [
  { id: C1, type: 'character', name: 'One' },
  { id: C2, type: 'character', name: 'Two' },
  { id: C3, type: 'character', name: 'Three', hidden: true },
  { id: C4, type: 'character', name: 'Four' },
];
const zones = [{ id: Z1, type: 'zone', name: 'Reach', shape: 'polygon' }];

const TYPES = ['ability', 'character', 'collective', 'construct', 'creature', 'event', 'family', 'institution', 'language', 'law', 'location', 'map', 'marker', 'narrative', 'object', 'phenomenon', 'pin', 'relation', 'species', 'title', 'trait', 'zone'];
/** keel names all 22 types in a world's counts, zeros included (read live on Moppetopia). */
const counts = (some) => Object.fromEntries(TYPES.map((t) => [t, some[t] ?? 0]));
const json = (status, body) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'RateLimit-Reset' }, body: JSON.stringify(body) });
const page1 = (data) => json(200, { data, has_more: false, next_cursor: null });

function answer(url) {
  const u = new URL(url);
  const p = u.pathname;
  const w = u.searchParams.get('world');
  const map = u.searchParams.get('map');
  const ids = u.searchParams.get('ids')?.split(',') ?? null;
  const pick = (rows) => page1(rows.filter((r) => (!map || r.map === map) && (!ids || ids.includes(r.id))));
  if (w === BIG) {
    if (p.startsWith('/api/v2/world')) return json(200, { id: BIG, name: 'Big', counts: { total: 12003, types: counts({ map: 1, pin: 1, character: 12001 }) } });
    if (p.startsWith('/api/v2/map')) return page1([{ id: BIGMAP, type: 'map', name: 'Big by kind', width: 1000, height: 1000, x_layout: { method: 'by-kind' } }]);
    if (p.startsWith('/api/v2/pin')) return pick([{ id: '77777777-7777-7777-8777-000000000002', type: 'pin', map: BIGMAP, element_type: 'character', element_id: '77777777-7777-7777-8777-000000000003', x: 1, y: 1 }]);
    if (p.startsWith('/api/v2/marker')) return page1([]);
    if (p.startsWith('/api/v2/character')) return pick([{ id: '77777777-7777-7777-8777-000000000003', type: 'character', name: 'Only' }]);
    return page1([]);
  }
  if (w !== W) return json(404, { error: { code: 'not_found', message: 'World not found.' } });
  if (p.startsWith('/api/v2/world')) return json(200, { id: W, name: 'Unplaced', counts: { total: 25, types: counts({ map: 6, pin: 11, marker: 3, character: 4, zone: 1 }) } });
  if (p.startsWith('/api/v2/map')) return pick(maps);
  if (p.startsWith('/api/v2/pin')) return pick(pins);
  if (p.startsWith('/api/v2/marker')) return pick(markers);
  if (p.startsWith('/api/v2/character')) return pick(characters);
  if (p.startsWith('/api/v2/zone')) return pick(zones);
  return page1([]);
}

let checks = 0;
const fails = [];
function check(label, ok, detail = '') {
  checks++;
  if (process.env.SHOW) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${which} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) fails.push(`${which} ${label}${detail ? `: ${detail}` : ''}`);
}

const site = await serve(DIST, PORT, '127.0.0.1', { drop: which === 'firefox' ? ['Cross-Origin-Opener-Policy'] : [] });
const browser = await engine.launch();
const watchdog = setTimeout(() => {
  console.error('unplaced: watchdog, 240 s');
  process.exit(2);
}, 240_000);

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const sent = [];
const faults = [];
let slowType = null;
await ctx.route('https://www.onlyworlds.com/**', async (route) => {
  const url = route.request().url();
  const u = new URL(url);
  sent.push(u);
  const type = u.pathname.split('/')[3];
  const whole = !u.searchParams.has('ids') && !u.searchParams.has('map') && !['world', 'map', 'pin', 'marker'].includes(type);
  const f = faults.findIndex((x) => x === type && whole);
  if (f >= 0) {
    faults.splice(f, 1);
    return route.fulfill(json(500, { error: { code: 'server_error', message: 'played' } }));
  }
  if (slowType === type && whole) {
    setTimeout(() => route.fulfill(answer(url)).catch(() => {}), 4000);
    return;
  }
  return route.fulfill(answer(url));
});
const errors = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text())); // the played 500 the browser logs itself

/** Whole-type reads (no ids, no map filter) of the element types, since `from`. */
const wholeReads = (from) => sent.slice(from).filter((u) => {
  const type = u.pathname.split('/')[3];
  return !u.searchParams.has('ids') && !u.searchParams.has('map') && !['world', 'map', 'pin', 'marker'].includes(type);
}).map((u) => u.pathname.split('/')[3]);
const lineText = async () => ((await page.locator('.unplaced').count()) ? (await page.locator('.unplaced').first().innerText()).trim() : null);
const waitLine = async (re, ms = 15_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await lineText();
    if (t && re.test(t)) return t;
    await page.waitForTimeout(100);
  }
  return await lineText();
};
const open = async (world, map) => {
  await page.goto(`${site.url}/?world=${world}&map=${map}`);
  await page.waitForFunction(() => window.__mapper?.scene?.complete === true, null, { timeout: 20_000 }).catch(() => {});
};
const settle = () => page.waitForTimeout(1500);
const goInApp = (search) => page.evaluate((s) => {
  history.pushState(null, '', s);
  window.dispatchEvent(new PopStateEvent('popstate'));
}, search);
const openInApp = async (world, map) => {
  await goInApp(`/?world=${world}&map=${map}`);
  await page.waitForFunction((n) => document.title.startsWith(n), 'By kind, every one', { timeout: 20_000 }).catch(() => {});
  await page.waitForFunction(() => window.__mapper?.scene?.complete === true, null, { timeout: 20_000 }).catch(() => {});
};

// 1. A by-kind Map: the count, from the types keel counts above 0 only.
let from = sent.length;
await open(W, BYKIND);
let t = await waitLine(/not placed|places every/);
check('a by-kind map says what it does not place: 3 (a Pin with no whole x, a Pin with no element_type, a Zone outlined and not pinned; the hidden one cut)', t === 'Of the elements this layout would draw for you, 3 are not placed on this map.', String(t));
const reads1 = wholeReads(from);
check('it reads only the types keel counts above 0, each once', JSON.stringify([...reads1].sort()) === JSON.stringify(['character', 'zone']), JSON.stringify(reads1));
check('the map is drawn, with no map failure', (await page.locator('.failure').count()) === 0 && (await page.evaluate(() => window.__mapper?.scene?.counts?.pins ?? -1)) >= 1);

// 2. A second by-kind Map in the same world: no type read again; every element placed.
from = sent.length;
await openInApp(W, BYKIND2);
t = await waitLine(/places every|not placed/);
check('a second by-kind map: every element placed', t === 'This map places every element this layout would draw for you.', String(t));
check('a second by-kind map reads no type again', wholeReads(from).length === 0, JSON.stringify(wholeReads(from)));

// 3. An around Map, a plain Map: no line, no whole-type read. (A fresh page: nothing cached.)
for (const [name, m] of [['an around map', AROUND], ['a hand map', HAND], ['a plain map', PLAIN]]) {
  await page.goto('about:blank');
  from = sent.length;
  await open(W, m);
  await settle();
  check(`${name} opened and drew`, (await page.evaluate(() => window.__mapper?.scene?.complete)) === true);
  check(`${name} has no unplaced line`, (await lineText()) === null, String(await lineText()));
  check(`${name} makes no whole-type read`, wholeReads(from).length === 0, JSON.stringify(wholeReads(from)));
}

// 4. A failed read: the count's own line with Try again; the map drawn; Try again resumes.
await page.goto('about:blank');
faults.push('zone');
from = sent.length;
await open(W, BYKIND);
t = await waitLine(/could not be counted/);
check('a failed read says the count could not be made, with Try again', /^What this map does not place could not be counted\. OnlyWorlds could not answer the elements read \(500\)\. Try again$/.test(t ?? ''), String(t));
check('a failed count is not the map\'s failure', (await page.locator('.failure:not(.unplaced)').count()) === 0);
const before = wholeReads(from);
await page.locator('.unplaced .retry').click().catch(() => {});
t = await waitLine(/not placed|places every/);
const after = wholeReads(from).slice(before.length);
check('Try again counts', t === 'Of the elements this layout would draw for you, 3 are not placed on this map.', String(t));
check('Try again reads only what failed', JSON.stringify(after) === JSON.stringify(['zone']), JSON.stringify(after));

// 5. Leaving mid-count says nothing on the next page.
await page.goto('about:blank');
slowType = 'character';
await open(W, BYKIND);
await page.waitForTimeout(500);
check('while it reads, it says it is counting', (await lineText()) === 'Counting what this map does not place.', String(await lineText()));
const leftAt = sent.length;
await goInApp(`/?world=${W}`);
await page.waitForTimeout(5000);
check('leaving mid-count (inside the page): nothing said on the next page', (await page.locator('.unplaced').count()) === 0);
check('leaving mid-count: no element type read after the route moved', wholeReads(leftAt).length === 0, JSON.stringify(wholeReads(leftAt)));
slowType = null;

// 6. Too large: the ceiling line, nothing read.
await page.goto('about:blank');
from = sent.length;
await open(BIG, BIGMAP);
t = await waitLine(/too many/);
check('a world above the ceiling says so', t === 'This world holds more than 10,000 elements you can see, too many for the mapper to count what this map does not place.', String(t));
check('above the ceiling nothing is read', wholeReads(from).length === 0, JSON.stringify(wholeReads(from)));

// 7. A by-kind Map with a depth (3D): the line is there too.
await page.goto('about:blank');
await open(W, DEEP);
await page.waitForFunction(() => window.__mapper.view3d?.state === 'on', null, { timeout: 30_000 }).catch(() => {});
t = await waitLine(/not placed|places every/);
check('a by-kind map with a depth opens in 3D and shows the line', (await page.evaluate(() => window.__mapper.view3d?.state)) === 'on' && t === 'Of the elements this layout would draw for you, 3 are not placed on this map.', `${await page.evaluate(() => window.__mapper.view3d?.state)}: ${t}`);
await page.goto(`${site.url}/?world=${W}&map=${DEEP}&view=flat`);
await page.waitForFunction(() => window.__mapper?.scene?.complete === true, null, { timeout: 20_000 }).catch(() => {});
t = await waitLine(/not placed|places every/);
check('the same map in Flat shows the line', (await page.evaluate(() => window.__mapper.view3d?.state)) !== 'on' && t === 'Of the elements this layout would draw for you, 3 are not placed on this map.', `${await page.evaluate(() => window.__mapper.view3d?.state)}: ${t}`);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
clearTimeout(watchdog);
await browser.close();
await site.close();
console.log(`unplaced ${which}: ${checks - fails.length} of ${checks} checks passed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
