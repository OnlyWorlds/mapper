// The live read: the FLOWN page at https://maps.onlyworlds.com/ against the real OnlyWorlds, as its
// builder's control. No local server, keyless public reads only, nothing written to any server.
// At a 1440 by 900 desk and a 390 by 844 touch phone, one engine a run:
//   node walk/live.mjs [chromium|firefox]
// LIVE_IP=<ip> pins the host for an engine whose resolver has cached it as missing (Chromium by
// --host-resolver-rules, Firefox by network.dns.forceResolve); without it the system resolver is used.
// Screenshots go to .scratch/live/. Exits 1 on any failed check.
import { chromium, firefox } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { MOPPETOPIA as M, SIKELIA as S, M_MAP, S_BIG, M_ELEMENT } from './worlds.mjs';

const HOST = 'maps.onlyworlds.com';
const BASE = `https://${HOST}`;
const BLOOD_MERIDIAN = '721d154b-43f3-4cc1-b7b4-7ea2b83c401e'; // public, keyless: 1,218 elements across 22 types
const which = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const engine = which === 'firefox' ? firefox : chromium;
const IP = process.env.LIVE_IP;
mkdirSync('.scratch/live', { recursive: true });

const launch = () => (which === 'chromium'
  ? chromium.launch({ args: IP ? [`--host-resolver-rules=MAP ${HOST} ${IP}`] : [] })
  : firefox.launch(IP ? { firefoxUserPrefs: { 'network.dns.forceResolve': IP } } : {}));
const browser = await launch();
const watchdog = setTimeout(() => {
  console.error('live: watchdog, 1500 s');
  process.exit(2);
}, 1_500_000);

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

for (const [vp, opts] of [
  ['desk', { viewport: { width: 1440, height: 900 } }],
  ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3, ...(which === 'chromium' ? { isMobile: true } : {}) }],
]) {
  const phone = vp === 'phone';
  const tag = `${which} ${vp}`;
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await ctx.newPage();
  const errors = [];
  const apiLog = []; // [status, url, allow-origin]
  const mediaLog = [];
  const failed = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror ${e}`));
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', async (r) => {
    const u = r.url();
    if (u.startsWith('https://www.onlyworlds.com/')) {
      apiLog.push([r.status(), new URL(u).pathname + new URL(u).search.slice(0, 60), r.headers()['access-control-allow-origin'] ?? '-', r.request().method()]);
    } else if (u.startsWith('https://media.onlyworlds.com/') || /^https:\/\/(?!maps\.onlyworlds\.com)/.test(u)) mediaLog.push([r.status(), u.slice(0, 100)]);
  });
  const snap = (name) => page.screenshot({ path: `.scratch/live/${which}-${vp}-${name}.png` });
  const complete = () => page.waitForFunction(() => window.__mapper.scene?.complete && !document.querySelector('.status')?.textContent.includes('is being'), null, { timeout: 300_000 });
  const go = (search) => page.evaluate((s) => { history.pushState(null, '', s); dispatchEvent(new PopStateEvent('popstate')); }, search);
  const press = (x, y) => (phone ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const where = () => page.evaluate(() => location.search);
  const sight = () => page.evaluate(() => window.__mapper.selection.filter((i) => i.startsWith('pin:')).map((id) => {
    const p = window.__mapper.screenOf(id);
    const hit = p && document.elementFromPoint(p.x, p.y);
    return hit?.tagName === 'CANVAS' ? 'visible' : `covered by ${hit?.className || hit?.tagName || 'nothing'}`;
  }));
  const scene = () => page.evaluate(() => window.__mapper.scene);
  const section = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      check(`${tag} ${name} ran`, false, String(e).split('\n')[0]);
      await snap(`error-${name.replace(/\W+/g, '-')}`).catch(() => {});
    }
  };

  // 1. The host: the page, its headers, no console error, no CSP violation.
  await section('1 load', async () => {
    const res = await page.goto(`${BASE}/`, { waitUntil: 'load' });
    const h = res.headers();
    check(`${tag} 1 / answers 200`, res.status() === 200, `status ${res.status()}`);
    check(`${tag} 1 CSP header`, /default-src 'none'/.test(h['content-security-policy'] ?? '') && /frame-ancestors 'none'/.test(h['content-security-policy'] ?? ''), h['content-security-policy']);
    check(`${tag} 1 HSTS header`, /max-age=31536000/.test(h['strict-transport-security'] ?? ''), h['strict-transport-security']);
    check(`${tag} 1 X-Robots-Tag noindex`, (h['x-robots-tag'] ?? '') === 'noindex', h['x-robots-tag']);
    console.log(`${tag} 1 other headers: nosniff=${h['x-content-type-options']} referrer=${h['referrer-policy']} coop=${h['cross-origin-opener-policy']} cache=${h['cache-control']}`);
    await page.waitForSelector('h1');
    await page.waitForTimeout(600);
    console.log(`${tag} 1 front page: ${(await page.textContent('main')).replace(/\s+/g, ' ').slice(0, 200)}`);
    await snap('front');
  });

  // 2. Moppetopia: the Maps list, a pictured map, a pressed Pin.
  await section('2 moppetopia', async () => {
    await page.goto(`${BASE}/?world=${M}`);
    await page.waitForSelector('.map-row', { timeout: 120_000 });
    await page.waitForFunction(() => document.querySelectorAll('.map-row .row-meta')[0]?.textContent.includes('Pin'), null, { timeout: 120_000 });
    const rows = await page.$$eval('.map-row', (els) => els.map((e) => e.textContent));
    check(`${tag} 2 Moppetopia's Maps list`, rows.length >= 3 && rows.some((r) => r.startsWith('MoppetopiaMap')), JSON.stringify(rows));
    await snap('moppetopia-maps');
    await page.click('.map-row:has(.row-name:text-is("MoppetopiaMap"))');
    await complete();
    await page.waitForFunction(() => window.__mapper.labels.length > 0, null, { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const sc = await scene();
    const said = (await page.textContent('.status')).replace(/\s+/g, ' ');
    check(`${tag} 2 the pictured map is drawn: picture and Pins`, sc.kinds.picture === 1 && sc.counts.pins > 0 && !/did not load|not drawn/.test(said), JSON.stringify({ counts: sc.counts, kinds: sc.kinds, said }));
    check(`${tag} 2 the address gains the map`, (await where()).includes(`map=${M_MAP}`), await where());
    await snap('moppetopia-map');
    const pins = await page.evaluate(() => window.__mapper.pins());
    const target = pins.find((p) => p.element === M_ELEMENT) ?? pins[0];
    const pt = await page.evaluate((id) => window.__mapper.screenOf(id), target.id);
    await press(pt.x, pt.y);
    await page.waitForSelector('.card:not([hidden]) h2', { timeout: 10_000 });
    const sel = await page.evaluate(() => window.__mapper.selection);
    const cardName = (await page.textContent('.card h2')).trim();
    check(`${tag} 2 a Pin pressed shows its card`, sel.includes(target.id) && cardName.length > 0, `selection ${JSON.stringify(sel)}, card "${cardName}"`);
    await snap('moppetopia-card');
    // 8. Back from a map returns to the list.
    if (await page.locator('.card .close').count()) await page.click('.card .close').catch(() => {});
    await page.click('button.back');
    await page.waitForSelector('.map-row', { timeout: 30_000 });
    check(`${tag} 8 Back from a map (opened from the list) returns to the list`, (await where()) === `?world=${M}`, await where());
  });

  // 3. Sikelia: the largest map, the measure readout, the layout.
  await section('3 sikelia', async () => {
    await go(`?world=${S}&map=${S_BIG}&measure=1`);
    await complete();
    await page.waitForFunction(() => document.querySelector('.readout')?.dataset.firstDraw !== 'none', null, { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const sc = await scene();
    const title = (await page.textContent('.map-name')).trim();
    const said = (await page.textContent('.top')).replace(/\s+/g, ' ');
    check(`${tag} 3 Sikelia's map "Sikelia" is drawn`, title === 'Sikelia' && sc.complete && sc.kinds.picture === 1 && sc.counts.pins > 0, JSON.stringify({ title, counts: sc.counts, kinds: sc.kinds, out: sc.out, derive: sc.ms }));
    console.log(`${tag} 3 the page states: ${said}`);
    await snap('sikelia');
    if (!phone) {
      const b = await page.locator('canvas.surface').boundingBox();
      const mx = b.x + b.width / 2;
      const my = b.y + b.height / 2;
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
      await page.waitForTimeout(500);
      const ro = await page.evaluate(() => ({ ...document.querySelector('.readout').dataset, text: document.querySelector('.readout').textContent }));
      console.log(`${tag} 3 MEASURE ${JSON.stringify(ro)}`);
      check(`${tag} 3 the measure readout is there`, ro.text.length > 0);
      await snap('sikelia-measured');
    }
    await go(`?world=${S}`);
    await page.waitForSelector('.map-row', { timeout: 120_000 });
    await page.click('.map-row:has(.row-name:text-is("Sikelia: layout"))');
    await complete();
    await page.waitForTimeout(1000);
    const sl = await scene();
    const lsaid = (await page.textContent('.top')).replace(/\s+/g, ' ');
    check(`${tag} 3 Sikelia: layout is drawn`, sl.complete && sl.counts.pins > 0, JSON.stringify({ counts: sl.counts, kinds: sl.kinds, out: sl.out }));
    console.log(`${tag} 3 the layout states: ${lsaid}`);
    await snap('sikelia-layout');
  });

  // 4. Blood Meridian opens and lists its maps.
  await section('4 blood meridian', async () => {
    await go(`?world=${BLOOD_MERIDIAN}`);
    // Timer polling, not the default rAF one: Firefox's rAF can idle after a heavy canvas map, and the
    // selector wait then never fires on a page that is already there (seen twice, runs 1 and 2).
    const t0 = Date.now();
    await page.waitForFunction(() => document.querySelector('.map-row, .intro .note, .failure, .error'), null, { timeout: 120_000, polling: 250 });
    console.log(`${tag} 4 the world list appeared after ${Date.now() - t0} ms`);
    await page.waitForTimeout(2500);
    const rows = await page.$$eval('.map-row', (els) => els.map((e) => e.textContent));
    const head = (await page.textContent('.intro')).replace(/\s+/g, ' ').slice(0, 300);
    check(`${tag} 4 Blood Meridian opens and lists its maps`, rows.length > 0, `${rows.length} rows ${JSON.stringify(rows.slice(0, 6))} | ${head}`);
    await snap('blood-meridian');
  });

  // 5. The element address the Waymark row will use.
  await section('5 element', async () => {
    await page.goto(`${BASE}/?world=${M}&type=location&element=${M_ELEMENT}`);
    await complete();
    await page.waitForTimeout(1000);
    const sc = await scene();
    const sel = await page.evaluate(() => window.__mapper.selection);
    const marked = await page.evaluate(() => window.__mapper.marked);
    const seen = await sight();
    const head = (await page.textContent('.element-head')).replace(/\s+/g, ' ').trim();
    const mark = await page.locator('.element-head .ow-waymark__mark, .ow-waymark__mark').count();
    check(`${tag} 5 the element view opens, the element marked and in sight`, sc.complete && sel.some((i) => i.startsWith('pin:')) && seen.length > 0 && seen.every((x) => x === 'visible'), JSON.stringify({ counts: sc.counts, sel, marked, seen, mark, peek: await page.evaluate(() => window.__mapper.peek) }));
    check(`${tag} 5 the head names the element and its maps`, /Puddleton/.test(head) && /on \d+ maps?/.test(head), head);
    await snap('element');
  });

  // 6. keel's CORS: the page's own requests from this origin.
  const bad = apiLog.filter(([s]) => s >= 400 && s !== 429);
  const noCors = apiLog.filter(([s, , o]) => s < 400 && o === '-');
  const byStatus = apiLog.reduce((a, [s]) => ((a[s] = (a[s] ?? 0) + 1), a), {});
  check(`${tag} 6 keel's CORS: the page's onlyworlds.com requests succeed`, apiLog.length > 0 && bad.length === 0 && noCors.length === 0, `${apiLog.length} requests, by status ${JSON.stringify(byStatus)}, allow-origin seen ${JSON.stringify([...new Set(apiLog.map((r) => r[2]))])}, methods ${JSON.stringify([...new Set(apiLog.map((r) => r[3]))])}, failed ${bad.length}`);
  for (const r of bad.slice(0, 10)) console.log(`  non-2xx: ${r.join(' ')}`);
  console.log(`${tag} 6 other https hosts: ${JSON.stringify(mediaLog.slice(0, 6))}${mediaLog.length > 6 ? ` ... ${mediaLog.length} in all` : ''}`);

  // 7. An unknown path answers 404.
  await section('7 404', async () => {
    let status = null;
    let how = 'navigation';
    try {
      status = (await page.goto(`${BASE}/nope`)).status();
    } catch (e) {
      // An empty 404 (Content-Length 0, no content type) can be refused by an engine's navigation
      // (Firefox: NS_ERROR_NET_EMPTY_RESPONSE): the status is then read by a same-origin fetch.
      how = `navigation refused (${String(e).split('\n')[0].slice(0, 80)}), so a same-origin fetch`;
      await page.goto(`${BASE}/`);
      status = await page.evaluate(() => fetch('/nope').then((r) => r.status));
    }
    check(`${tag} 7 /nope answers 404`, status === 404, `status ${status} by ${how}`);
    // The callback, on the flown host and before the sign-in client is used: the mapper's own page,
    // never cached, exactly one Referrer-Policy and it is no-referrer; the 404 page untouched. Read by a
    // same-origin fetch (redirect: manual), so no code is ever traded. A made-up code and state.
    if (vp === 'desk') {
      const cb = await page.evaluate(async () => {
        const r = await fetch('/signin/callback?code=x&state=y', { redirect: 'manual', cache: 'no-store' });
        const body = await r.text();
        return { status: r.status, cache: r.headers.get('cache-control'), referrer: r.headers.get('referrer-policy'), script: /<script type="module"[^>]*src="\/assets\//.test(body), app: body.includes('id="app"') };
      });
      check(`${tag} 7 /signin/callback is the mapper's page, no-store, one Referrer-Policy: no-referrer`, cb.status === 200 && cb.script && cb.app && cb.cache === 'no-store' && cb.referrer === 'no-referrer', JSON.stringify(cb));
      const plain = await page.evaluate(() => fetch('/nothing', { cache: 'no-store' }).then((r) => r.status));
      check(`${tag} 7 /nothing is still 404`, plain === 404, `status ${plain}`);
    }
  });

  // 8b. A map opened by its address, Back: the list.
  await section('8b back from a direct map', async () => {
    await page.goto(`${BASE}/?world=${M}&map=${M_MAP}`);
    await complete();
    await page.click('button.back');
    await page.waitForSelector('.map-row', { timeout: 30_000 });
    check(`${tag} 8 Back from a map opened by address returns to the list`, (await where()) === `?world=${M}`, await where());
  });

  // 1b. The console and CSP, over the whole visit.
  const csp = await page.evaluate(() => window.__csp ?? []).catch(() => ['(page gone)']);
  const real = errors.filter((e) => !/^Failed to load resource/.test(e));
  check(`${tag} 1 no console error, no CSP violation, no failed request`, real.length === 0 && csp.length === 0 && failed.filter((f) => !f.includes('/nope')).length === 0, JSON.stringify({ errors: errors.slice(0, 6), csp, failed: failed.slice(0, 4) }));
  await ctx.close();
}

clearTimeout(watchdog);
await browser.close();
console.log(failures ? `live ${which}: ${failures} FAILED` : `live ${which}: all passed`);
process.exit(failures ? 1 : 0);
