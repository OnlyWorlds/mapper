// The 3D view's icon look, on a played world of its own: a saved layout with a depth whose Pins stand
// apart, of eight element types. Every request is answered here; none reaches the real server.
// The drawn widths are read from the picture's pixels (the canvas screenshot, walk/png.mjs), never
// only from the page's own numbers: at Fit, either side of the 16 px threshold, along a zoom until a
// point turns into its icon, a selected Pin and the Pin its link reaches at their lit sizes, at device
// ratio 1 and 2, and the dots where a browser cannot draw the icons (no Path2D). The press: near a
// large icon's rim, where a selected Pin overlaps a nearer dimmed one, and the lowest Pin at Fit.
// The played walk (walk/played.mjs) runs it as its section `look3d`.
//   npm run build && node walk/look3d.mjs [chromium|firefox]
//   BENCH_DOTS=<dist> node walk/look3d.mjs [chromium|firefox] --bench   frame time on a world of 5,000
//     Pins, the icons against the dots of a build from before them (served beside), each frame waited
//     for; Chromium draws on the machine's GPU (ANGLE on Direct3D 11; LOOK_GPU=high asks for a laptop's
//     faster one), and the renderer each engine drew with is printed beside the numbers.
// MAPPER_DIST serves another build (a control), MAPPER_PORT another port, SHOW=1 prints every check.
import { chromium, firefox } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { decodePng } from './png.mjs';
import { serve } from './serve.mjs';

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
  // At the frame's near left corner: at Fit the lowest Pin on screen, near the foot of the view.
  gate: { id: id(W, 110), type: 'construct', name: 'The gate', at: [20, 20, 0] },
  // At the frame's centre, where the camera aims at Fit: the zoom buttons move toward it, so it stays in view and grows.
  well: { id: id(W, 109), type: 'institution', name: 'The well', at: [500, 500, 200] },
};
const fields = { mara: { friends: [E.ivo.id] }, ivo: { location: E.pier.id, institutions: [E.well.id] } };
const rows = Object.entries(E).map(([k, e]) => ({ id: e.id, type: e.type, name: e.name, ...(fields[k] ?? {}) }));
const pins = Object.values(E).map((e, i) => ({ id: id(W, 300 + i), type: 'pin', name: 'pin', map: MAP, element_type: e.type, element_id: e.id, x: e.at[0], y: e.at[1], z: e.at[2] }));
const pinOf = (e) => `pin:${pins.find((p) => p.element_id === e.id).id}`;
const map = { id: MAP, type: 'map', name: 'Icon ground', width: 1000, height: 1000, depth: 400, x_layout: { method: 'played' } };
// A second layout: Ada and Bram drawn overlapping, Bram twelve units nearer the camera (to the south).
const OMAP = id(W, 2);
const omap = { id: OMAP, type: 'map', name: 'Overlap ground', width: 1000, height: 1000, depth: 400, x_layout: { method: 'played' } };
const ada = { id: id(W, 121), type: 'character', name: 'Ada' };
const bram = { id: id(W, 122), type: 'creature', name: 'Bram' };
const opins = [
  { id: id(W, 321), type: 'pin', name: 'pin', map: OMAP, element_type: 'character', element_id: ada.id, x: 500, y: 512, z: 0 },
  { id: id(W, 322), type: 'pin', name: 'pin', map: OMAP, element_type: 'creature', element_id: bram.id, x: 500, y: 500, z: 0 },
];

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
    if (type === 'world') return json(200, { id: W, name: 'Icon walk', counts: { total: rows.length + pins.length + 5, types: counts({ map: 2, pin: pins.length + 2, character: 3, location: 2, phenomenon: 1, creature: 2, object: 1, event: 1, institution: 1, construct: 1 }) } });
    if (type === 'map') return pick([map, omap]);
    if (type === 'pin') return pick([...pins, ...opins]);
    if (type === 'marker' || type === 'zone') return page1([]);
    return pick([...rows, ada, bram].filter((r) => r.type === type));
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
 * Each Pin's drawn radius read from the picture's pixels: along 16 rays from far outside inward, the
 * first pixel unlike that ray's own outer colour by half the ray's peak difference is the edge. The
 * peak is taken outside 0.62 of the page's own radius, so an icon's ink (lifted toward white, inside
 * 0.56 of the radius) never stands in for its rim (a small dark-coloured icon read 0.86 by its ink);
 * a dot's edge drawn at 0.8 of the radius the press reads, or past it by a quarter, still lies in that
 * window and is read where it is drawn. Two
 * opposite rays make a diameter (so a sprite placed half a pixel off, as Firefox places some, reads
 * true), and the radius is the median of the eight halved diameters, CSS px (a small icon at device
 * ratio 1 read 8.9 of its 10 from four, about 9.6 from eight: the diagonals land between pixels). The overlays are hidden
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
  for (const [name, cx, cy, far, rExp] of pts) {
    const x = (cx - box.x) * k;
    const y = (cy - box.y) * k;
    const rs = new Array(16).fill(null);
    let peakAll = 0;
    for (let a = 0; a < 16; a++) {
      const dx = Math.cos((a * Math.PI) / 8);
      const dy = Math.sin((a * Math.PI) / 8);
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
      const peak = Math.max(0, ...prof.filter((q) => q[0] >= 0.62 * rExp * k).map((q) => q[1]));
      peakAll = Math.max(peakAll, peak);
      if (peak > 60) {
        const e = prof.find((q) => q[1] >= peak / 2);
        if (e) rs[a] = e[0] / k;
      }
    }
    const ds = [0, 1, 2, 3, 4, 5, 6, 7].filter((a) => rs[a] !== null && rs[a + 8] !== null).map((a) => (rs[a] + rs[a + 8]) / 2).sort((a, b) => a - b);
    const mid = ds.length % 2 === 0 ? (ds[ds.length / 2 - 1] + ds[ds.length / 2]) / 2 : ds[Math.floor(ds.length / 2)];
    out[name] = { r: ds.length >= 5 ? mid : null, peak: peakAll };
  }
  return out;
}

/** Every Pin standing clear of the others and of the edges, as drawn now, against its pixels. */
async function ratios(page, only = null) {
  const vw = page.viewportSize();
  // The pointer off every Pin: a hovered Pin is ringed, and the ring would be read as its edge.
  await page.mouse.move(3, Math.round(vw.height / 2));
  await page.waitForTimeout(60);
  const clear = await clearPins(page, only);
  const read = await pixelRadii(page, clear.map((a) => [a.name, a.x, a.y, a.px * 0.9 + 6, a.r]));
  return clear.map((a) => ({ ...a, drawn: read[a.name].r, peak: read[a.name].peak, ratio: read[a.name].r === null ? null : read[a.name].r / a.r }));
}

/** The Pins standing clear of the others and of the edges, as drawn now (the stemmed ones only when asked for). */
async function clearPins(page, only = null) {
  const vw = page.viewportSize();
  const all = [];
  for (const [k, e] of Object.entries(E)) {
    const d = await drawnOf(page, pinOf(e));
    if (d) all.push({ k, name: e.name, ...d });
  }
  // The tower and the well stand on stems, a line through their edge: read only when asked for.
  const clear = all.filter((a) => (only ? only.includes(a.k) : a.k !== 'tower' && a.k !== 'well') && a.x > 60 && a.y > 60 && a.x < vw.width - 60 && a.y < vw.height - 60
    && all.every((b) => b === a || Math.hypot(b.x - a.x, b.y - a.y) > (a.px + b.px) * 0.8 + 10));
  return clear;
}

// The scan finds an antialiased edge within about a device pixel: a radius under 6 px is held to 1.75
// px either way, a larger one to 1.15 of the page's own radius above and to 0.9 of it or 1 px
// (whichever is looser) below (at device ratio 1 Firefox read a dot of 6.2 at 5.6, Chromium an icon of 10 at 8.9). A dot's edge drawn
// at the whole radius, or the press reading 0.8 of a body's, is 20% off: outside either band from 6 px.
const near = (x) => (x.r < 6 ? Math.abs(x.drawn - x.r) <= 1.75 : x.drawn >= Math.min(0.9 * x.r, x.r - 1) && x.ratio < 1.15);
const ratiosOk = (rows) => {
  const read = rows.filter((x) => x.drawn !== null);
  return read.length >= 2 && read.every(near);
};
const span = (rows) => (rows.length ? `${Math.min(...rows.map((x) => x.ratio)).toFixed(2)} to ${Math.max(...rows.map((x) => x.ratio)).toFixed(2)}` : 'none');
const words = (rows) => rows.map((x) => `${x.name} ${x.px.toFixed(1)} px ${x.icon ? 'icon' : 'dot'} r ${x.r.toFixed(1)} drawn ${x.drawn === null ? '?' : x.drawn.toFixed(1)}`).join(', ');

/**
 * One context's walk of the icon look. `dpr` is the device ratio asked for, `phone` a touch phone
 * (its presses are taps). The pixel reads run on the dark scheme, where a body's rim stands out from
 * the ground and the dots' ring is the ground's own colour.
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
  const fitBtn = () => page.locator('.zoom button[aria-label="Fit the map"]');
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
  c('the icons from the first draw, from 16 px, with no switch', v.look === 'icons' && v.from === 16 && (await page.locator('.look3d, .corner').count()) === 0, JSON.stringify({ look: v.look, from: v.from }));
  c('a saved layout keeps its stems', v.stems === 2, `${v.stems}`);

  // At Fit the Pin lowest on screen (the gate, at the frame's near left corner) is the element under
  // its own middle and a press on it selects it; on a phone also turned on its side.
  const lowCheck = async (how) => {
    const at = [];
    for (const e of Object.values(E)) {
      const d = await drawnOf(page, pinOf(e));
      if (d) at.push({ e, ...d });
    }
    const low = at.sort((x, y) => y.y - x.y)[0];
    const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className ?? '', [low.x, low.y]);
    c(`${how}: at Fit the lowest Pin is drawn in the open`, /surface-3d|label3d/.test(String(top)), `${low.e.name} at ${Math.round(low.x)},${Math.round(low.y)}, under it: ${top}`);
    await press(low.x, low.y);
    await page.waitForSelector('.card:not([hidden])', { timeout: 5000 }).catch(() => {});
    const sel = await page.evaluate(() => window.__mapper.selection);
    c(`${how}: a press on the lowest Pin at Fit selects it`, sel.includes(pinOf(low.e)), `${JSON.stringify(sel)} for ${low.e.name}`);
    if (await page.locator('.card .close').first().isVisible()) await page.locator('.card .close').first().click();
    await settle(page);
  };
  await lowCheck('upright');
  if (phone) {
    const upright = page.viewportSize();
    await page.setViewportSize({ width: upright.height, height: upright.width });
    await page.waitForTimeout(400);
    await fitBtn().click();
    await settle(page);
    await snap('sideways');
    await lowCheck('on its side');
    await page.setViewportSize(upright);
    await page.waitForTimeout(400);
    await fitBtn().click();
    await settle(page);
  }
  await snap('icons-fit');

  if (!phone) {
    // At Fit every Pin is a dot, drawn at the radius the press reads.
    const fit = await ratios(page);
    c('at Fit each Pin is drawn at the radius the press reads, from the pixels', ratiosOk(fit), words(fit));
    // Either side of the threshold, read from the picture: nearer toward the middle in small steps until
    // a ground Pin is drawn 15 to 15.9 px wide (a dot of radius 6 or more, where the band tells a dot's
    // edge at 0.8 from one at the whole radius) and one 16.3 to 19.7 px wide (its icon), each against
    // the radius the press reads.
    const cb = await page.locator('canvas.surface-3d').boundingBox();
    let dotMid = null;
    let iconMid = null;
    for (let k = 0; k < 240 && !(dotMid && iconMid); k++) {
      const rows = await clearPins(page);
      const d = rows.find((a) => a.px >= 15 && a.px <= 15.9);
      const i = rows.find((a) => a.px >= 16.3 && a.px <= 19.7);
      if (d && !dotMid) dotMid = (await ratios(page, [d.k]))[0] ?? null;
      if (i && !iconMid) iconMid = (await ratios(page, [i.k]))[0] ?? null;
      await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
      await page.mouse.wheel(0, -10);
      await page.waitForTimeout(50);
    }
    c('below 16 px a Pin is a dot, drawn at the radius the press reads, from the pixels', !!dotMid && !dotMid.icon && dotMid.r >= 6 && dotMid.drawn !== null && near(dotMid), dotMid ? words([dotMid]) : 'none found');
    c('from 16 px a Pin is its icon, drawn at the radius the press reads, from the pixels', !!iconMid && iconMid.icon && iconMid.drawn !== null && near(iconMid), iconMid ? words([iconMid]) : 'none found');
    await fitBtn().click();
    await settle(page);
  }

  // Nearer until the target turns into its icon: at a desk the wheel toward Mara (the drawn radii read
  // at each step); on a phone the + button, which moves toward where the camera aims, toward the well
  // standing there.
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
    const dots = seen.filter((x) => !x.icon && x.drawn !== null);
    const icon = seen.filter((x) => x.icon && x.drawn !== null);
    c('along the zoom each Pin is drawn at the radius the press reads, dots and icons among them', seen.length > 10 && bad.length === 0 && dots.length > 0 && icon.length > 0, `${seen.length} read, ${dots.length} dots (ratio ${span(dots)}), ${icon.length} icons (ratio ${span(icon)}); off: ${words(bad.slice(0, 4))}`);
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
  if (phone || dpr !== 1) {
    await ctx.close();
    c('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    return;
  }

  // Flat, then 3D again: the icons again; the WebGL context lost, then Try 3D again: the icons again.
  await page.click('button.view-toggle');
  await settle(page);
  c('Flat: drawn flat', (await v3(page)).state === 'off');
  await page.click('button.view-toggle');
  await on3d();
  await settle(page);
  v = await v3(page);
  c('3D again: the icons from 16 px', v.look === 'icons' && v.from === 16 && v.canvases === 1, JSON.stringify({ look: v.look, canvases: v.canvases }));
  await page.evaluate(() => {
    const cv = document.querySelector('canvas.surface-3d');
    (cv.getContext('webgl2') ?? cv.getContext('webgl'))?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  await page.waitForFunction(() => window.__mapper.view3d?.state === 'failed', null, { timeout: 10_000 }).catch(() => {});
  c('WebGL lost: drawn flat', (await v3(page)).state === 'failed');
  await page.click('.line3d button');
  await on3d();
  await settle(page);
  v = await v3(page);
  c('Try 3D again: the icons from 16 px', v.look === 'icons' && v.from === 16, JSON.stringify({ state: v.state, look: v.look }));
  await ctx.close();
  c('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // What the switch once kept matters no more: a stored "dots" still draws the icons.
  {
    const cx = await browser.newContext(opts);
    await cx.route('https://www.onlyworlds.com/**', (route) => route.fulfill(answer(route.request().url())));
    await cx.addInitScript("localStorage.setItem('mapper.points3d', 'dots:20')");
    const pg = await cx.newPage();
    await pg.goto(`${base}/?world=${W}&map=${MAP}`);
    await pg.waitForFunction(() => window.__mapper.view3d?.state === 'on', null, { timeout: 30_000 }).catch(() => {});
    const b = await pg.evaluate(() => window.__mapper.view3d);
    c('an old stored look is not read: the icons from 16 px', b?.look === 'icons' && b?.from === 16, JSON.stringify(b && { look: b.look, from: b.from }));
    await cx.close();
  }

  // A browser that cannot draw the icons (no Path2D): the dots, drawn 9 px wide as before, read from the pixels.
  {
    const cx = await browser.newContext(opts);
    await cx.route('https://www.onlyworlds.com/**', (route) => route.fulfill(answer(route.request().url())));
    await cx.addInitScript('delete window.Path2D');
    const pg = await cx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.goto(`${base}/?world=${W}&map=${MAP}`);
    await pg.waitForFunction(() => window.__mapper.scene?.complete && window.__mapper.view3d?.state === 'on', null, { timeout: 30_000 }).catch(() => {});
    await settle(pg);
    const b = await pg.evaluate(() => window.__mapper.view3d);
    c('no Path2D: the dots, the stems as before', b.look === 'dots' && b.icons === 0 && b.stems === 2 && errs.length === 0, `${b.look} ${b.stems} ${errs.join(' | ')}`);
    const dots = await ratios(pg);
    c('no Path2D: each Pin drawn 9 px wide, from the pixels', ratiosOk(dots) && dots.every((x) => x.px === 9), words(dots));
    await cx.close();
  }

  // A ring round a hovered Pin is drawn with one program, linked once: moving the view with the pointer
  // resting on the Pin (the wheel keeps the point under the pointer) links no program again.
  {
    const cx = await browser.newContext(opts);
    await cx.route('https://www.onlyworlds.com/**', (route) => route.fulfill(answer(route.request().url())));
    await cx.addInitScript(() => {
      window.__links = 0;
      for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!C) continue;
        const real = C.prototype.linkProgram;
        C.prototype.linkProgram = function (prog) {
          window.__links++;
          return real.call(this, prog);
        };
      }
    });
    const pg = await cx.newPage();
    await pg.goto(`${base}/?world=${W}&map=${MAP}`);
    await pg.waitForFunction(() => window.__mapper.scene?.complete && window.__mapper.view3d?.state === 'on', null, { timeout: 30_000 }).catch(() => {});
    await settle(pg);
    const m = await pg.evaluate((q) => window.__mapper.drawn3d(q), pinOf(E.mara));
    await pg.mouse.move(m.x, m.y);
    await pg.waitForTimeout(300);
    const hovered = (await pg.evaluate(() => document.querySelector('canvas.surface-3d').style.cursor)) === 'pointer';
    // The ring itself, read from the pixels with the pointer still on her: its outer edge 5.5 px past
    // her drawn edge (3 clear and a 2.5 px line), and never under 17 px across.
    const ringR = Math.max(8.5, m.r + 5.5);
    const seen = (await pixelRadii(pg, [['Mara', m.x, m.y, ringR + 8, ringR]])).Mara;
    c('the hover ring is drawn round her as drawn, from the pixels', hovered && seen.r !== null && Math.abs(seen.r - ringR) <= 1.5, `ring ${ringR.toFixed(1)}, read ${seen.r?.toFixed(1)}`);
    const read = () => pg.evaluate(() => ({ links: window.__links, draws: window.__mapper.view3d.draws }));
    const a = await read();
    for (let k = 0; k < 10; k++) {
      const before = (await read()).draws;
      await pg.mouse.wheel(0, -60);
      await pg.waitForFunction((n) => window.__mapper.view3d.draws > n, before, { timeout: 5000 }).catch(() => {});
      await pg.waitForTimeout(60);
    }
    const b = await read();
    c('a hovered Pin\'s ring links no program again while the view moves', hovered && b.draws - a.draws >= 8 && b.links === a.links, `hovered ${hovered}, ${b.draws - a.draws} draws, ${b.links - a.links} links`);
    await cx.close();
  }

  // A selected Pin is drawn over the rest without a depth test, so a press where it overlaps a nearer,
  // dimmed Pin picks the selected one, as the eye sees it (the press's layer).
  {
    const cx = await browser.newContext(opts);
    await cx.route('https://www.onlyworlds.com/**', (route) => route.fulfill(answer(route.request().url())));
    const pg = await cx.newPage();
    await pg.goto(`${base}/?world=${W}&map=${OMAP}`);
    await pg.waitForFunction(() => window.__mapper.scene?.complete && window.__mapper.view3d?.state === 'on', null, { timeout: 30_000 }).catch(() => {});
    await pg.waitForTimeout(300);
    const A = `pin:${opins[0].id}`;
    const B = `pin:${opins[1].id}`;
    const dOf = (q) => pg.evaluate((x) => window.__mapper.drawn3d(x), q);
    let a = await dOf(A);
    const b = await dOf(B);
    // Ada selected by a press on her far side, clear of Bram's disc.
    const len = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    await pg.mouse.click(a.x + ((a.x - b.x) / len) * a.r * 0.7, a.y + ((a.y - b.y) / len) * a.r * 0.7);
    await pg.waitForTimeout(300);
    const first = await pg.evaluate(() => window.__mapper.selection);
    a = await dOf(A);
    // A point inside both discs, on the line between the centres.
    const lo = Math.max(0, len - b.r * 0.8);
    const hi = Math.min(len, a.r * 0.8);
    const fits = first[0] === A && lo < hi;
    if (fits) {
      const t = (lo + hi) / 2;
      await pg.mouse.move(3, 300);
      await pg.mouse.click(a.x + ((b.x - a.x) / len) * t, a.y + ((b.y - a.y) / len) * t);
      await pg.waitForTimeout(300);
    }
    const sel = await pg.evaluate(() => window.__mapper.selection);
    c('where a selected Pin overlaps a nearer dimmed one, a press picks the selected', fits && sel[0] === A, `first ${first}, then ${sel}; Ada r ${a.r.toFixed(1)}, Bram r ${b.r.toFixed(1)}, ${len.toFixed(1)} apart`);
    await cx.close();
  }
}

/** The section for one viewport of the played walk: at a desk, device ratio 1 then 2 (both on the dark scheme); a touch phone as given. */
export async function look3dWalk({ browser, which, vp, opts, check, base }) {
  if (vp === 'phone') return lookWalk({ browser, which, tag: 'phone', opts, check, base, phone: true, dpr: opts.deviceScaleFactor ?? 1 });
  await lookWalk({ browser, which, tag: 'desk', opts: { ...opts, colorScheme: 'dark' }, check, base });
  await lookWalk({ browser, which, tag: 'desk-dpr2', opts: { ...opts, colorScheme: 'dark', deviceScaleFactor: 2 }, check, base, dpr: 2 });
}

/**
 * Frame time on 5,000 Pins, the icons against the dots. The dots are a build that draws them (BENCH_DOTS,
 * a dist of the mapper before the icons, served beside this one): a page with no Path2D draws the dots
 * too, but its flat map fails and says so, which moves the fit. One page at a time, so one WebGL
 * context draws: the icons, the dots, the icons, the dots, each page loaded fresh, at Fit and then
 * nearer (the same wheel at the same place), five times 300 frames each; the medians of the ten.
 */
async function benchWalk({ browser, which, base, dotsBase, check }) {
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
  const runs = { icons: { fit: [], near: [], gpu: '', look: [], cams: [], fits: [], iconsFit: 0, iconsNear: 0 }, dots: { fit: [], near: [], gpu: '', look: [], cams: [], fits: [] } };
  let pinsDrawn = 0;
  for (const round of [0, 1]) {
    for (const name of ['icons', 'dots']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
      await ctx.route('https://www.onlyworlds.com/**', (route) => route.fulfill(answer(route.request().url())));
      const pg = await ctx.newPage();
      if (name === 'dots' && !dotsBase) await pg.addInitScript('delete window.Path2D');
      await pg.goto(`${name === 'dots' && dotsBase ? dotsBase : base}/?world=${BW}&map=${BMAP}`);
      await pg.waitForFunction(() => window.__mapper.scene?.complete && window.__mapper.view3d?.state === 'on', null, { timeout: 120_000 });
      await pg.waitForTimeout(500);
      const R = runs[name];
      const v = await pg.evaluate(() => window.__mapper.view3d);
      R.look.push(v.look);
      pinsDrawn = (await pg.evaluate(() => window.__mapper.scene.kinds.pin)) ?? 0;
      const one = () => pg.evaluate(() => window.__mapper.bench3d(300));
      R.gpu = (await one()).gpu;
      R.fits.push(`fit ${JSON.stringify(v.cam)} top ${await pg.evaluate(() => Math.round(document.querySelector('.top').getBoundingClientRect().height))} ${await pg.evaluate(() => JSON.stringify(document.querySelector('.status').innerText.slice(0, 160)))}`);
      for (let k = 0; k < 5; k++) R.fit.push((await one()).ms);
      if (name === 'icons' && round === 0) R.iconsFit = (await pg.evaluate(() => window.__mapper.view3d)).icons;
      const box = await pg.locator('canvas.surface-3d').boundingBox();
      await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // Each step drawn before the next: a slower page must not merge two steps into one.
      for (let k = 0; k < 8; k++) {
        const before = await pg.evaluate(() => window.__mapper.view3d.draws);
        await pg.mouse.wheel(0, -240);
        await pg.waitForFunction((n) => window.__mapper.view3d.draws > n, before, { timeout: 10_000 }).catch(() => {});
        await pg.waitForTimeout(150);
      }
      await pg.waitForTimeout(400);
      R.cams.push(JSON.stringify((await pg.evaluate(() => window.__mapper.view3d)).cam));
      if (name === 'icons' && round === 0) {
        R.iconsNear = (await pg.evaluate(() => window.__mapper.view3d)).icons;
        await pg.screenshot({ path: `.scratch/shots/look3d-${which}-bench-near.png` });
      }
      await one();
      for (let k = 0; k < 5; k++) R.near.push((await one()).ms);
      await ctx.close();
    }
  }
  const I = runs.icons;
  const D = runs.dots;
  const fit = { icons: median(I.fit), dots: median(D.fit) };
  const near = { icons: median(I.near), dots: median(D.near) };
  const camSame = new Set([...I.cams, ...D.cams]).size === 1 && new Set([...I.fits, ...D.fits]).size === 1;
  const f = (x) => x.toFixed(2);
  console.log(`bench ${which}: renderer ${I.gpu}${D.gpu !== I.gpu ? ` (the dots' page: ${D.gpu})` : ''}`);
  console.log(`bench ${which}: ${pinsDrawn} Pins; ms a frame (median of 10, 300 frames each, one page at a time), Fit dots ${f(fit.dots)} icons ${f(fit.icons)} (${I.iconsFit} icons drawn); nearer dots ${f(near.dots)} icons ${f(near.icons)} (${I.iconsNear} icons drawn)`);
  console.log(`bench ${which}: runs Fit dots ${D.fit.map(f).join(' ')} | icons ${I.fit.map(f).join(' ')}; nearer dots ${D.near.map(f).join(' ')} | icons ${I.near.map(f).join(' ')}`);
  check(`bench a world of 5,000 Pins drawn, the icons and the dots, the same camera nearer on every page`, pinsDrawn >= BENCH_N && I.look.every((l) => l === 'icons') && D.look.every((l) => l === 'dots') && camSame, `${pinsDrawn} ${I.look} ${D.look} cams ${[...new Set([...I.fits, ...D.fits, ...I.cams, ...D.cams])].join(' | ')}`);
  check(`bench Icons within 10% of Dots at Fit (${((fit.icons / fit.dots) * 100).toFixed(0)}%)`, fit.icons <= fit.dots * 1.1);
  check(`bench Icons within 10% of Dots nearer (${((near.icons / near.dots) * 100).toFixed(0)}%)`, near.icons <= near.dots * 1.1);
}

// Run alone: the desk (ratio 1 and 2) and the phone in one engine, or the bench.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('walk/look3d.mjs')) {
  const which = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
  const doBench = process.argv.includes('--bench');
  const engine = which === 'firefox' ? firefox : chromium;
  const site = await serve(process.env.MAPPER_DIST ?? 'dist', Number(process.env.MAPPER_PORT ?? 4187), '127.0.0.1', { drop: which === 'firefox' ? ['Cross-Origin-Opener-Policy'] : [] });
  const dotsSite = doBench && process.env.BENCH_DOTS ? await serve(process.env.BENCH_DOTS, Number(process.env.MAPPER_PORT ?? 4187) + 1, '127.0.0.1', { drop: which === 'firefox' ? ['Cross-Origin-Opener-Policy'] : [] }) : null;
  // The bench draws on the machine's GPU in Chromium (headless Chromium otherwise draws WebGL in software, SwiftShader).
  // LOOK_GPU=high asks Chromium for the machine's high-performance GPU where it has two (a laptop's).
  const gpuArgs = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', ...(process.env.LOOK_GPU === 'high' ? ['--force_high_performance_gpu'] : [])];
  const browser = await engine.launch(doBench && which === 'chromium' ? { args: gpuArgs } : {});
  const watchdog = setTimeout(() => {
    console.error(`look3d: watchdog, ${doBench ? 1700 : 600} s`);
    process.exit(2);
  }, doBench ? 1_700_000 : 600_000);
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
      if (vp === 'bench') await benchWalk({ browser, which, base: site.url, dotsBase: dotsSite?.url ?? null, check });
      else await look3dWalk({ browser, which, vp, opts, check, base: site.url });
    } catch (e) {
      check(`${vp} section look3d ran to its end`, false, String(e?.message ?? e).split('\n')[0].slice(0, 300));
    }
  }
  clearTimeout(watchdog);
  await browser.close();
  await site.close();
  await dotsSite?.close();
  console.log(`look3d ${which}: ${checks - fails.length} of ${checks} checks passed`);
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(fails.length ? 1 : 0);
}
