// The 3D view's icon look, on a played world of its own: a saved layout with a depth whose Pins stand
// apart, of seven element types. Every request is answered here; none reaches the real server.
// The drawn widths are read from the picture's pixels (the canvas screenshot, walk/png.mjs), never
// only from the page's own numbers: at Fit, along a zoom until a point turns into its icon, a selected
// Pin and the Pin its link reaches at their lit sizes, at device ratio 1 and 2, then back in Dots.
// The switch: shown only in 3D, reachable by keyboard, kept per browser (a reload, Dots then Icons,
// junk or a throwing storage), carried across Flat and 3D and a WebGL context lost.
// The played walk (walk/played.mjs) runs it as its section `look3d`.
//   npm run build && node walk/look3d.mjs [chromium|firefox]
//   node walk/look3d.mjs [chromium|firefox] --bench   frame time on a world of 5,000 Pins, Dots against
//     Icons, each frame waited for; Chromium draws on the machine's GPU (ANGLE on Direct3D 11), and the
//     renderer each engine drew with is printed beside the numbers.
// MAPPER_DIST serves another build (a control), MAPPER_PORT another port, SHOW=1 prints every check.
import { chromium, firefox } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { decodePng } from './png.mjs';
import { serve } from './serve.mjs';

const LOOK_KEY = 'mapper.points3d';
const W = 'a3a3a3a3-a3a3-7a3a-8a3a-a3a3a3a3a3a3';
const BW = 'a4a4a4a4-a4a4-7a4a-8a4a-a4a4a4a4a4a4';
const id = (w, n) => `${w.slice(0, 8)}-${w.slice(0, 4)}-7${w.slice(1, 4)}-8${w.slice(1, 4)}-${String(n).padStart(12, '0')}`;
const MAP = id(W, 1);
const BMAP = id(BW, 1);
const TYPES = ['ability', 'character', 'collective', 'construct', 'creature', 'event', 'family', 'institution', 'language', 'law', 'location', 'map', 'marker', 'narrative', 'object', 'phenomenon', 'pin', 'relation', 'species', 'title', 'trait', 'zone'];
const counts = (some) => Object.fromEntries(TYPES.map((t) => [t, some[t] ?? 0]));
const json = (status, body) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'RateLimit-Reset' }, body: JSON.stringify(body) });
const page1 = (data) => json(200, { data, has_more: false, next_cursor: null });

// The played world: Mara and Ivo friends, Ivo at the pier and of the well (at the frame's
// centre, on a height), the tower alone at the back on a height, the rest alone on the ground (z 0).
const E = {
  mara: { id: id(W, 101), type: 'character', name: 'Mara', at: [300, 420, 0] },
  ivo: { id: id(W, 102), type: 'character', name: 'Ivo', at: [620, 420, 0] },
  pier: { id: id(W, 103), type: 'location', name: 'The pier', at: [760, 760, 0] },
  // At the back corner: no Pin stands behind it, so its stem crosses none on screen.
  tower: { id: id(W, 104), type: 'location', name: 'The tower', at: [950, 950, 300] },
  storm: { id: id(W, 105), type: 'phenomenon', name: 'The storm', at: [140, 760, 0] },
  wren: { id: id(W, 106), type: 'creature', name: 'Wren', at: [120, 200, 0] },
  ledger: { id: id(W, 107), type: 'object', name: 'The ledger', at: [880, 180, 0] },
  feast: { id: id(W, 108), type: 'event', name: 'The feast', at: [870, 780, 0] },
  // At the frame's centre, where the camera aims at Fit: the zoom buttons move toward it, so it stays in view and grows.
  well: { id: id(W, 109), type: 'institution', name: 'The well', at: [500, 500, 200] },
};
const fields = { mara: { friends: [E.ivo.id] }, ivo: { location: E.pier.id, institutions: [E.well.id] } };
const rows = Object.entries(E).map(([k, e]) => ({ id: e.id, type: e.type, name: e.name, ...(fields[k] ?? {}) }));
const pins = Object.values(E).map((e, i) => ({ id: id(W, 300 + i), type: 'pin', name: 'pin', map: MAP, element_type: e.type, element_id: e.id, x: e.at[0], y: e.at[1], z: e.at[2] }));
const pinOf = (e) => `pin:${pins.find((p) => p.element_id === e.id).id}`;
const map = { id: MAP, type: 'map', name: 'Icon ground', width: 1000, height: 1000, depth: 400, x_layout: { method: 'played' } };

// The bench world: 5,000 Pins of eight types in a box 1000 by 1000 by 400, a fifth of them linked.
const BENCH_N = 5000;
const BTYPES = ['character', 'location', 'object', 'event', 'creature', 'institution', 'species', 'phenomenon'];
let bench = null;
function benchWorld() {
  if (bench) return bench;
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const els = [];
  const bpins = [];
  for (let i = 0; i < BENCH_N; i++) {
    const t = BTYPES[i % BTYPES.length];
    const e = { id: id(BW, 10000 + i), type: t, name: `B${i}` };
    if (t === 'character' && i > 8) e.friends = [id(BW, 10000 + ((i * 7919) % i))];
    els.push(e);
    bpins.push({ id: id(BW, 20000 + i), type: 'pin', name: 'pin', map: BMAP, element_type: t, element_id: e.id, x: Math.round(rnd() * 1000), y: Math.round(rnd() * 1000), z: Math.round(rnd() * 400) });
  }
  bench = { els, pins: bpins, map: { id: BMAP, type: 'map', name: 'Five thousand', width: 1000, height: 1000, depth: 400, x_layout: { method: 'played' } } };
  return bench;
}

function answer(url) {
  const u = new URL(url);
  const p = u.pathname;
  const w = u.searchParams.get('world');
  const m = u.searchParams.get('map');
  const ids = u.searchParams.get('ids')?.split(',') ?? null;
  const pick = (list) => page1(list.filter((r) => (!m || r.map === m) && (!ids || ids.includes(r.id))));
  const type = p.split('/')[3];
  if (w === W) {
    if (type === 'world') return json(200, { id: W, name: 'Icon walk', counts: { total: rows.length + pins.length + 1, types: counts({ map: 1, pin: pins.length, character: 2, location: 2, phenomenon: 1, creature: 1, object: 1, event: 1 }) } });
    if (type === 'map') return pick([map]);
    if (type === 'pin') return pick(pins);
    if (type === 'marker' || type === 'zone') return page1([]);
    return pick(rows.filter((r) => r.type === type));
  }
  if (w === BW) {
    const b = benchWorld();
    if (type === 'world') return json(200, { id: BW, name: 'Bench', counts: { total: BENCH_N * 2 + 1, types: counts({ map: 1, pin: BENCH_N, ...Object.fromEntries(BTYPES.map((t) => [t, BENCH_N / BTYPES.length])) }) } });
    if (type === 'map') return pick([b.map]);
    if (type === 'pin') return pick(b.pins);
    if (type === 'marker' || type === 'zone') return page1([]);
    return pick(b.els.filter((r) => r.type === type));
  }
  return json(404, { error: { code: 'not_found', message: 'World not found.' } });
}

const settle = (page) => page.waitForTimeout(250);

/** The opened map's 3D view, its look and how it draws one Pin; null where it is not drawn. */
const v3 = (page) => page.evaluate(() => window.__mapper.view3d);
const drawnOf = (page, pin) => page.evaluate((p) => window.__mapper.drawn3d(p), pin);

/**
 * Each Pin's drawn radius read from the picture's pixels: along 8 rays from far outside inward, the
 * first pixel unlike that ray's own outer colour by half the ray's peak difference is the edge. Two
 * opposite rays make a diameter (so a sprite placed half a pixel off, as Firefox places some, reads
 * true), and the radius is the median of the four halved diameters, CSS px. The overlays are hidden
 * for the shot (the canvas does not move).
 */
async function pixelRadii(page, pts) {
  const cv = page.locator('canvas.surface-3d');
  const box = await cv.boundingBox();
  await page.evaluate(() => { for (const el of document.querySelectorAll('.labels3d, .top, .zoom, .look3d, .panel, .tip')) el.style.visibility = 'hidden'; });
  const png = decodePng(await cv.screenshot());
  await page.evaluate(() => { for (const el of document.querySelectorAll('.labels3d, .top, .zoom, .look3d, .panel, .tip')) el.style.visibility = ''; });
  const k = png.w / box.width;
  const px = (X, Y) => { const i = (Y * png.w + X) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
  const out = {};
  for (const [name, cx, cy, far] of pts) {
    const x = (cx - box.x) * k;
    const y = (cy - box.y) * k;
    const rs = new Array(8).fill(null);
    let peakAll = 0;
    for (let a = 0; a < 8; a++) {
      const dx = Math.cos((a * Math.PI) / 4);
      const dy = Math.sin((a * Math.PI) / 4);
      const prof = [];
      let bg = null;
      for (let r = far * k; r >= 0; r -= 0.25) {
        // The pixel holding the point (a pixel's own centre is half a pixel in).
        const X = Math.floor(x + dx * r);
        const Y = Math.floor(y + dy * r);
        if (X < 0 || Y < 0 || X >= png.w || Y >= png.h) continue;
        const c = px(X, Y);
        bg ??= c;
        prof.push([r, Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2])]);
      }
      const peak = Math.max(0, ...prof.map((q) => q[1]));
      peakAll = Math.max(peakAll, peak);
      if (peak > 60) {
        const e = prof.find((q) => q[1] >= peak / 2);
        if (e) rs[a] = e[0] / k;
      }
    }
    const ds = [0, 1, 2, 3].filter((a) => rs[a] !== null && rs[a + 4] !== null).map((a) => (rs[a] + rs[a + 4]) / 2).sort((a, b) => a - b);
    const mid = ds.length === 4 ? (ds[1] + ds[2]) / 2 : ds[Math.floor(ds.length / 2)];
    out[name] = { r: ds.length >= 3 ? mid : null, peak: peakAll };
  }
  return out;
}

/** Every Pin standing clear of the others and of the edges, as drawn now, against its pixels. */
async function ratios(page, only = null) {
  const vw = page.viewportSize();
  // The pointer off every Pin: a hovered Pin is ringed, and the ring would be read as its edge.
  await page.mouse.move(3, Math.round(vw.height / 2));
  await page.waitForTimeout(60);
  const all = [];
  for (const [k, e] of Object.entries(E)) {
    const d = await drawnOf(page, pinOf(e));
    if (d) all.push({ k, name: e.name, ...d });
  }
  // The tower and the well stand on stems, a line through their edge: read only when asked for.
  const clear = all.filter((a) => (only ? only.includes(a.k) : a.k !== 'tower' && a.k !== 'well') && a.x > 60 && a.y > 60 && a.x < vw.width - 60 && a.y < vw.height - 60
    && all.every((b) => b === a || Math.hypot(b.x - a.x, b.y - a.y) > (a.px + b.px) * 0.8 + 10));
  const read = await pixelRadii(page, clear.map((a) => [a.name, a.x, a.y, a.px * 0.9 + 6]));
  return clear.map((a) => ({ ...a, drawn: read[a.name].r, peak: read[a.name].peak, ratio: read[a.name].r === null ? null : read[a.name].r / a.r }));
}

// The scan finds an antialiased edge within about a device pixel: a radius under 6 px is held to 1.75
// px either way, a larger one to 1.15 of the page's own radius above and to 0.9 of it or 0.75 px
// (whichever is looser) below (Firefox at device ratio 1 read a dot of 6.2 at 5.6). A dot's edge drawn
// at the whole radius, or the press reading 0.8 of a body's, is 20% off: outside either band from 6 px.
const near = (x) => (x.r < 6 ? Math.abs(x.drawn - x.r) <= 1.75 : x.drawn >= Math.min(0.9 * x.r, x.r - 0.75) && x.ratio < 1.15);
const ratiosOk = (rows) => {
  const read = rows.filter((x) => x.drawn !== null);
  return read.length >= 2 && read.every(near);
};
const span = (rows) => (rows.length ? `${Math.min(...rows.map((x) => x.ratio)).toFixed(2)} to ${Math.max(...rows.map((x) => x.ratio)).toFixed(2)}` : 'none');
const words = (rows) => rows.map((x) => `${x.name} ${x.px.toFixed(1)} px ${x.icon ? 'icon' : 'dot'} r ${x.r.toFixed(1)} drawn ${x.drawn === null ? '?' : x.drawn.toFixed(1)}`).join(', ');

/**
 * One context's walk of the icon look. `dpr` is the device ratio asked for, `phone` a touch phone
 * (its presses are taps), `scheme` the colour scheme (the pixel reads run on the dark one, where the
 * Dots' ring is the ground's own colour and a body's rim stands out from it).
 */
async function lookWalk({ browser, which, tag, opts, check, base, phone = false, dpr = 1 }) {
  mkdirSync('.scratch/shots', { recursive: true });
  let shotN = 0;
  const ctx = await browser.newContext(opts);
  await ctx.route('https://www.onlyworlds.com/**', (route) => route.fulfill(answer(route.request().url())));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/^Failed to load resource|CORS request did not succeed|WebGL|GL_|context/i.test(m.text()) && errors.push(m.text()));
  const snap = (name) => page.screenshot({ path: `.scratch/shots/look3d-${which}-${tag}-${String(++shotN).padStart(2, '0')}-${name}.png` }).catch(() => {});
  const c = (label, ok, detail = '') => check(`${tag} look3d ${label}`, ok, detail);
  const press = async (x, y) => (phone ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const row = page.locator('.look3d');
  const btn = (name) => row.getByRole('button', { name, exact: true });
  const pressed = async (name) => (await btn(name).getAttribute('aria-pressed')) === 'true';
  const stored = () => page.evaluate((k) => { try { return localStorage.getItem(k); } catch { return 'unreadable'; } }, LOOK_KEY);
  const on3d = () => page.waitForFunction(() => window.__mapper.view3d?.state === 'on', null, { timeout: 30_000 }).then(() => true, () => false);
  const open = async () => {
    await page.goto(`${base}/?world=${W}&map=${MAP}`);
    await page.waitForFunction(() => window.__mapper.scene?.complete, null, { timeout: 30_000 });
    const ok = await on3d();
    await settle(page);
    return ok;
  };

  c('the 3D view comes on', await open());
  const real = await page.evaluate(() => devicePixelRatio);
  // Playwright's Firefox can drop the asked device ratio (a page with COOP same-origin): a run that is not at its ratio fails, never passes for the other.
  c(`runs at device ratio ${dpr}`, real === dpr, `the page reads ${real}`);
  let v = await v3(page);
  c('the dots by default: Dots pressed, no threshold shown', v.look === 'dots' && v.icons === 0 && (await row.isVisible()) && (await pressed('Dots')) && !(await pressed('Icons')) && !(await btn('20 px').isVisible()), JSON.stringify({ look: v.look, icons: v.icons }));
  c('a saved layout keeps its stems in the dots', v.stems === 2, `${v.stems}`);

  // Dots: each Pin a 9 px disc as before, read from the pixels (the page's own 9 is a constant).
  if (!phone) {
    const dots = await ratios(page);
    c('Dots: each Pin drawn 9 px wide, from the pixels', ratiosOk(dots) && dots.every((x) => x.px === 9), words(dots));
  }

  // Icons, by keyboard: Tab from Dots reaches Icons, Enter presses it; the focus stays on it.
  if (!phone) {
    await btn('Dots').focus();
    await page.keyboard.press('Tab');
    const at = await page.evaluate(() => document.activeElement?.textContent);
    c('Tab from Dots reaches Icons', at === 'Icons', at);
    await page.keyboard.press('Enter');
  } else await btn('Icons').tap();
  await settle(page);
  v = await v3(page);
  c('Icons pressed: the icon look from 20 px', v.look === 'icons' && v.from === 20 && (await pressed('Icons')) && (await pressed('20 px')) && !(await pressed('16 px')), JSON.stringify({ look: v.look, from: v.from }));
  c('kept for this browser', (await stored()) === 'icons:20', await stored());
  if (!phone) c('the focus stays on Icons', (await page.evaluate(() => document.activeElement?.textContent)) === 'Icons');
  c('stems unchanged in the icon look', v.stems === 2, `${v.stems}`);
  await snap('icons-fit');

  const box = await page.locator('canvas.surface-3d').boundingBox();
  if (!phone) {
    // At Fit every Pin is a dot in the icon look, drawn at the radius the press reads.
    const fit = await ratios(page);
    c('at Fit each Pin is drawn at the radius the press reads, from the pixels', ratiosOk(fit), words(fit));
  }

  // Nearer until the target turns into its icon: at a desk the wheel toward Mara (and at each step the
  // drawn radii are read: a dot of radius 6 or more, drawn 15 to 20 px wide, must be among them, for at
  // smaller dots the band cannot tell a dot's edge wrong); on a phone the + button, which moves toward
  // where the camera aims, toward the well standing there.
  const T = phone ? E.well : E.mara;
  const N = E.ivo;
  const focusWant = { pins: 2, lines: 1 };
  const reach = phone ? 14 : 8;
  let t = await drawnOf(page, pinOf(T));
  const seen = [];
  for (let k = 0; k < 60 && t && t.px < 34; k++) {
    if (phone) await page.locator('.zoom button[aria-label="Zoom in"]').tap();
    else {
      await page.mouse.move(t.x, t.y);
      await page.mouse.wheel(0, -120);
    }
    await page.waitForTimeout(80);
    t = await drawnOf(page, pinOf(T));
    if (!phone) seen.push(...(await ratios(page)));
  }
  await settle(page);
  t = await drawnOf(page, pinOf(T));
  v = await v3(page);
  c(`nearer, ${T.name} grows into its icon`, !!t && t.px >= 32 && t.icon && v.icons >= 1, JSON.stringify({ t, icons: v.icons }));
  await snap('icons-near');
  if (!phone) {
    const bad = seen.filter((x) => x.drawn !== null && !near(x));
    const bigDot = seen.filter((x) => !x.icon && x.r >= 6 && x.drawn !== null);
    const icon = seen.filter((x) => x.icon && x.drawn !== null);
    c('along the zoom each Pin is drawn at the radius the press reads, an icon and a dot of radius 6 or more among them', seen.length > 10 && bad.length === 0 && bigDot.length > 0 && icon.length > 0, `${seen.length} read, ${bigDot.length} large dots (ratio ${span(bigDot)}), ${icon.length} icons (ratio ${span(icon)}); off: ${words(bad.slice(0, 4))}`);
  }

  // A press near its rim, past the reach of a centre (8 px, a touch 14), selects it.
  const rim = t.r * 0.85;
  c(`the test press lands past the ${reach} px reach`, rim > reach, rim.toFixed(1));
  let target = null;
  for (const [dx, dy] of [[rim, 0], [-rim, 0], [0, -rim], [0, rim]]) {
    const at = [t.x + dx, t.y + dy];
    const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className ?? '', at);
    if (String(top).includes('surface-3d') || String(top).includes('label3d')) { target = at; break; }
  }
  const before = { t: t.px, n: (await drawnOf(page, pinOf(N)))?.px ?? null, rest: phone ? [] : await ratios(page, ['feast', 'ledger', 'wren', 'storm']) };
  if (target) await press(target[0], target[1]);
  await page.waitForSelector('.card:not([hidden])', { timeout: 5000 }).catch(() => {});
  await settle(page);
  let sel = await page.evaluate(() => window.__mapper.selection);
  c(`a press near its rim selects ${T.name}`, sel[0] === pinOf(T), `${JSON.stringify(sel)} at ${target}`);

  // Lit: the selected Pin 1.5 times its width (to 48 px), the Pin its link reaches 1.25; the rest dimmed.
  const lit = await drawnOf(page, pinOf(T));
  c(`selected, ${T.name} is drawn 1.5 times wider, to 48 px at most`, Math.abs(lit.px - Math.min(48, before.t * 1.5)) < 0.6, `${lit.px.toFixed(1)} against ${before.t.toFixed(1)}`);
  const nb = await drawnOf(page, pinOf(N));
  c(`${N.name}, reached by its link, 1.25 times`, before.n !== null && !!nb && Math.abs(nb.px - Math.min(48, before.n * 1.25)) < 0.6, `${nb?.px.toFixed(1)} against ${before.n?.toFixed(1)}`);
  v = await v3(page);
  c('the focus: its lines and the Pins they reach', !!v.focus && v.focus.pins === focusWant.pins && v.focus.lines === focusWant.lines, JSON.stringify(v.focus));
  if (!phone) {
    // Her lit width from the pixels (a shader that dropped the lit scale passes every number above); her glow
    // pushes the scan out a little, so the band is 0.9 to 1.2.
    const litRows = await ratios(page, ['mara', 'ivo']);
    const m = litRows.find((x) => x.k === 'mara');
    c('selected, she is drawn at her lit width, from the pixels', !!m && m.ratio !== null && m.ratio > 0.9 && m.ratio < 1.2, words(litRows));
    const n = litRows.find((x) => x.k === 'ivo');
    if (n) c('Ivo is drawn at his lit width, from the pixels', n.ratio !== null && n.ratio > 0.9 && n.ratio < 1.2, words([n]));
    // The Pins her links do not reach step back: their peak against the ground falls well below what it was.
    const after = await ratios(page, ['feast', 'ledger', 'wren', 'storm']);
    const pairs = after.map((a) => [a, before.rest.find((b) => b.k === a.k)]).filter(([a, b]) => b && b.peak > 100);
    c('the Pins she does not reach are dimmed', pairs.length > 0 && pairs.every(([a, b]) => a.peak < b.peak * 0.45), pairs.map(([a, b]) => `${a.name} ${b.peak} to ${a.peak}`).join(', '));
    await snap('icons-lit');
    // Escape gives the whole picture back: the lit sizes go.
    await page.locator('canvas.surface-3d').focus();
    await page.keyboard.press('Escape');
    await settle(page);
    const back = await drawnOf(page, pinOf(E.mara));
    sel = await page.evaluate(() => window.__mapper.selection);
    c('Escape: nothing selected, Mara back to her width', sel.length === 0 && Math.abs(back.px - before.t) < 0.6, `${JSON.stringify(sel)} ${back.px.toFixed(1)}`);
    const unlit = await ratios(page, ['mara']);
    c('Escape: she is drawn at her width again, from the pixels', unlit.length === 1 && unlit[0].ratio > 0.9 && unlit[0].ratio < 1.15, words(unlit));
  }
  await snap('icons-open');

  // The threshold: from 16 px more Pins (or as many) carry their icon, kept.
  const n20 = (await v3(page)).icons;
  if (phone) {
    // The sheet covers the switch on a phone (as it does the zoom buttons): it is closed first.
    c('on a phone the switch steps aside for the sheet', !(await row.isVisible()));
    await page.locator('.card .close').first().tap();
    await settle(page);
    await btn('16 px').tap();
  }
  else await btn('16 px').click();
  await settle(page);
  v = await v3(page);
  c('Icon from 16 px chosen and kept', v.from === 16 && v.icons >= n20 && (await stored()) === 'icons:16' && (await pressed('16 px')), `${v.icons} icons against ${n20}, ${await stored()}`);
  if (phone || dpr !== 1) {
    await ctx.close();
    c('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    return;
  }

  // A reload keeps the look.
  await open();
  v = await v3(page);
  c('after a reload the icon look from 16 px', v.look === 'icons' && v.from === 16 && (await pressed('Icons')) && (await pressed('16 px')), JSON.stringify({ look: v.look, from: v.from }));

  // Flat hides the switch; 3D brings it back with the look.
  await page.click('button.view-toggle');
  await settle(page);
  c('Flat: the switch is not shown', !(await row.isVisible()) && (await v3(page)).state === 'off');
  await page.click('button.view-toggle');
  await on3d();
  await settle(page);
  v = await v3(page);
  c('3D again: the switch and the icon look back', (await row.isVisible()) && v.look === 'icons' && v.from === 16 && v.canvases === 1, JSON.stringify({ look: v.look, canvases: v.canvases }));

  // The WebGL context lost: drawn flat with its line, the switch gone, the focus on it handed to the
  // Flat or 3D button; Try 3D again brings the icon look back.
  await btn('Icons').focus();
  await page.evaluate(() => {
    const cv = document.querySelector('canvas.surface-3d');
    (cv.getContext('webgl2') ?? cv.getContext('webgl'))?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  await page.waitForFunction(() => window.__mapper.view3d?.state === 'failed', null, { timeout: 10_000 }).catch(() => {});
  const lost = await v3(page);
  const focusLost = await page.evaluate(() => document.activeElement?.className ?? document.activeElement?.tagName);
  c('WebGL lost: drawn flat, the switch gone, its focus on the Flat or 3D button', lost.state === 'failed' && !(await row.isVisible()) && String(focusLost).includes('view-toggle'), `${lost.state} ${focusLost}`);
  await page.click('.line3d button');
  await on3d();
  await settle(page);
  v = await v3(page);
  c('Try 3D again: the icon look from 16 px', v.look === 'icons' && v.from === 16 && (await row.isVisible()), JSON.stringify({ state: v.state, look: v.look }));

  // Dots again: the dots as before, kept with the threshold for the next Icons.
  await btn('Dots').click();
  await settle(page);
  v = await v3(page);
  c('Dots: the dots again, kept with the threshold, no threshold shown', v.look === 'dots' && v.icons === 0 && (await stored()) === 'dots:16' && !(await btn('16 px').isVisible()), `${v.look} ${await stored()}`);
  const dots = await ratios(page);
  c('Dots: each Pin drawn 9 px wide again, from the pixels', ratiosOk(dots) && dots.every((x) => x.px === 9), words(dots));
  c('Dots: the stems still drawn', v.stems === 2);
  await btn('Icons').click();
  await settle(page);
  c('Icons again comes back from 16 px, as chosen before Dots', (await v3(page)).from === 16 && (await pressed('16 px')));
  await ctx.close();
  c('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // Junk kept, and a storage that throws: the dots, and the switch still works.
  for (const [what, script] of [
    ['junk kept', `localStorage.setItem('${LOOK_KEY}', 'icons:17')`],
    ['a storage that throws', `Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } })`],
  ]) {
    const cx = await browser.newContext(opts);
    await cx.route('https://www.onlyworlds.com/**', (route) => route.fulfill(answer(route.request().url())));
    await cx.addInitScript(script);
    const pg = await cx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.goto(`${base}/?world=${W}&map=${MAP}`);
    const ok = await pg.waitForFunction(() => window.__mapper.view3d?.state === 'on', null, { timeout: 30_000 }).then(() => true, () => false);
    const a = await pg.evaluate(() => window.__mapper.view3d);
    await pg.locator('.look3d').getByRole('button', { name: 'Icons', exact: true }).click();
    await pg.waitForTimeout(200);
    const b = await pg.evaluate(() => window.__mapper.view3d);
    c(`${what}: the dots, and Icons still draws`, ok && a.look === 'dots' && b.look === 'icons' && errs.length === 0, `${a.look} then ${b.look} ${errs.join(' | ')}`);
    await cx.close();
  }

  // A browser that cannot draw the icons (no Path2D): Icons leaves the dots drawn, the switch on Dots and
  // the dots kept, never a pressed Icons over dots.
  {
    const cx = await browser.newContext(opts);
    await cx.route('https://www.onlyworlds.com/**', (route) => route.fulfill(answer(route.request().url())));
    await cx.addInitScript('delete window.Path2D');
    const pg = await cx.newPage();
    await pg.goto(`${base}/?world=${W}&map=${MAP}`);
    await pg.waitForFunction(() => window.__mapper.view3d?.state === 'on', null, { timeout: 30_000 }).catch(() => {});
    const r = pg.locator('.look3d');
    await r.getByRole('button', { name: 'Icons', exact: true }).click();
    await pg.waitForTimeout(200);
    const b = await pg.evaluate(() => window.__mapper.view3d);
    const kept = await pg.evaluate((k) => localStorage.getItem(k), LOOK_KEY);
    const on = await r.getByRole('button', { name: 'Dots', exact: true }).getAttribute('aria-pressed');
    c('no Path2D: Icons leaves the dots, Dots pressed and kept', b.look === 'dots' && on === 'true' && kept === 'dots:20', `${b.look} ${on} ${kept}`);
    await cx.close();
  }
}

/** The section for one viewport of the played walk: at a desk, device ratio 1 then 2 (both on the dark scheme); a touch phone as given. */
export async function look3dWalk({ browser, which, vp, opts, check, base }) {
  if (vp === 'phone') return lookWalk({ browser, which, tag: 'phone', opts, check, base, phone: true, dpr: opts.deviceScaleFactor ?? 1 });
  await lookWalk({ browser, which, tag: 'desk', opts: { ...opts, colorScheme: 'dark' }, check, base });
  await lookWalk({ browser, which, tag: 'desk-dpr2', opts: { ...opts, colorScheme: 'dark', deviceScaleFactor: 2 }, check, base, dpr: 2 });
}

/** Frame time on 5,000 Pins: Dots and Icons taken in turn nine times each, 300 frames a time, the median of each, at Fit and nearer. */
async function benchWalk({ browser, which, base, check }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await ctx.route('https://www.onlyworlds.com/**', (route) => route.fulfill(answer(route.request().url())));
  const page = await ctx.newPage();
  await page.goto(`${base}/?world=${BW}&map=${BMAP}`);
  await page.waitForFunction(() => window.__mapper.scene?.complete && window.__mapper.view3d?.state === 'on', null, { timeout: 120_000 });
  await page.waitForTimeout(500);
  const row = page.locator('.look3d');
  const pinsDrawn = (await page.evaluate(() => window.__mapper.scene.kinds.pin)) ?? 0;
  const one = () => page.evaluate(() => window.__mapper.bench3d(300));
  const look = async (name) => { await row.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(150); await one(); };
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const take = async () => {
    const d = [];
    const i = [];
    for (let k = 0; k < 9; k++) {
      await look('Dots');
      d.push((await one()).ms);
      await look('Icons');
      i.push((await one()).ms);
    }
    return { dots: median(d), icons: median(i), d, i };
  };
  const fit = await take();
  const fitIcons = (await page.evaluate(() => window.__mapper.view3d)).icons;
  const box = await page.locator('canvas.surface-3d').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let k = 0; k < 8; k++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
  await page.waitForTimeout(300);
  const near = await take();
  const nearIcons = (await page.evaluate(() => window.__mapper.view3d)).icons;
  const gpu = (await one()).gpu;
  await page.screenshot({ path: `.scratch/shots/look3d-${which}-bench-near.png` });
  const f = (x) => x.toFixed(2);
  console.log(`bench ${which}: renderer ${gpu}`);
  console.log(`bench ${which}: ${pinsDrawn} Pins; ms a frame (median of 9 in turn, 300 frames each), Fit dots ${f(fit.dots)} icons ${f(fit.icons)} (${fitIcons} icons drawn); nearer dots ${f(near.dots)} icons ${f(near.icons)} (${nearIcons} icons drawn)`);
  console.log(`bench ${which}: runs Fit dots ${fit.d.map(f).join(' ')} | icons ${fit.i.map(f).join(' ')}; nearer dots ${near.d.map(f).join(' ')} | icons ${near.i.map(f).join(' ')}`);
  check(`bench a world of 5,000 Pins drawn`, pinsDrawn >= BENCH_N, `${pinsDrawn}`);
  check(`bench Icons within 10% of Dots at Fit (${((fit.icons / fit.dots) * 100).toFixed(0)}%)`, fit.icons <= fit.dots * 1.1);
  check(`bench Icons within 10% of Dots nearer (${((near.icons / near.dots) * 100).toFixed(0)}%)`, near.icons <= near.dots * 1.1);
  await ctx.close();
}

// Run alone: the desk (ratio 1 and 2) and the phone in one engine, or the bench.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('walk/look3d.mjs')) {
  const which = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
  const doBench = process.argv.includes('--bench');
  const engine = which === 'firefox' ? firefox : chromium;
  const site = await serve(process.env.MAPPER_DIST ?? 'dist', Number(process.env.MAPPER_PORT ?? 4187), '127.0.0.1', { drop: which === 'firefox' ? ['Cross-Origin-Opener-Policy'] : [] });
  // The bench draws on the machine's GPU in Chromium (headless Chromium otherwise draws WebGL in software, SwiftShader).
  const browser = await engine.launch(doBench && which === 'chromium' ? { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] } : {});
  const watchdog = setTimeout(() => {
    console.error('look3d: watchdog, 600 s');
    process.exit(2);
  }, 600_000);
  let checks = 0;
  const fails = [];
  const check = (label, ok, detail = '') => {
    checks++;
    if (process.env.SHOW) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${which} ${label}${detail ? `: ${detail}` : ''}`);
    if (!ok) fails.push(`${which} ${label}${detail ? `: ${detail}` : ''}`);
  };
  const runs = doBench ? [['bench', null]] : [
    ['desk', { viewport: { width: 1440, height: 900 } }],
    ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3, ...(which === 'chromium' ? { isMobile: true } : {}) }],
  ];
  for (const [vp, opts] of runs) {
    try {
      if (vp === 'bench') await benchWalk({ browser, which, base: site.url, check });
      else await look3dWalk({ browser, which, vp, opts, check, base: site.url });
    } catch (e) {
      check(`${vp} section look3d ran to its end`, false, String(e?.message ?? e).split('\n')[0].slice(0, 300));
    }
  }
  clearTimeout(watchdog);
  await browser.close();
  await site.close();
  console.log(`look3d ${which}: ${checks - fails.length} of ${checks} checks passed`);
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(fails.length ? 1 : 0);
}
