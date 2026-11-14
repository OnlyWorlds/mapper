// The live 3D read: the FLOWN page at https://maps.onlyworlds.com/ against the real OnlyWorlds,
// keyless, read only. The three demo worlds' layouts open in 3D at a desk and on a touch phone, with
// their ground drawn and a Pin that answers a press; the 3D code blocked on the flown host draws flat
// with its line; the page's first script holds no three.js and the 3D chunk does.
//   node walk/live3d.mjs [chromium|firefox]
// Its control is the same run on the build before 3D (before the flight): every check must fail there.
// LIVE_IP=<ip> pins the host, as in walk/live.mjs. Screenshots go to .scratch/live/. Exits 1 on a failed check.
import { chromium, firefox } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { MOPPETOPIA as M, SIKELIA as S, M_LAYOUT, S_LAYOUT } from './worlds.mjs';

const HOST = 'maps.onlyworlds.com';
const BASE = process.env.LIVE_BASE ?? `https://${HOST}`;
const BLOOD_MERIDIAN = '721d154b-43f3-4cc1-b7b4-7ea2b83c401e';
const B_LAYOUT = '01a1ccc5-cd05-7983-82ab-970256e9ecdc';
const which = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const IP = process.env.LIVE_IP;
mkdirSync('.scratch/live', { recursive: true });
const browser = await (which === 'chromium'
  ? chromium.launch({ args: IP ? [`--host-resolver-rules=MAP ${HOST} ${IP}`] : [] })
  : firefox.launch(IP ? { firefoxUserPrefs: { 'network.dns.forceResolve': IP } } : {}));
const watchdog = setTimeout(() => {
  console.error('live3d: watchdog, 900 s');
  process.exit(2);
}, 900_000);
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${which} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

// The first script holds no three.js; the 3D chunk does (its renderer names itself "three.js r186").
{
  const html = await (await fetch(`${BASE}/`, { signal: AbortSignal.timeout(20_000) })).text();
  const entry = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
  const js = entry ? await (await fetch(new URL(entry, BASE), { signal: AbortSignal.timeout(20_000) })).text() : '';
  const chunk = /assets\/three3d-[\w-]+\.js/.exec(js)?.[0];
  const three = chunk ? await (await fetch(`${BASE}/${chunk}`, { signal: AbortSignal.timeout(30_000) })).text() : '';
  check('the first script names the 3D chunk and holds no three.js; the chunk holds it', !!chunk && !js.includes('three.js r1') && three.includes('three.js r1'), `${entry} -> ${chunk}`);
}

for (const [vp, opts] of [
  ['desk', { viewport: { width: 1440, height: 900 } }],
  ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3, ...(which === 'chromium' ? { isMobile: true } : {}) }],
]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const [name, world, map] of [['Moppetopia', M, M_LAYOUT], ['Sikelia', S, S_LAYOUT], ['Blood Meridian', BLOOD_MERIDIAN, B_LAYOUT]]) {
    await page.goto(`${BASE}/?world=${world}&map=${map}`);
    const on = await page.waitForFunction(() => window.__mapper?.view3d?.state === 'on', null, { timeout: 60_000 }).then(() => true, () => false);
    await page.waitForFunction(() => window.__mapper.scene?.complete, null, { timeout: 120_000 }).catch(() => {});
    const pic = await page.waitForFunction(() => window.__mapper.view3d?.picture, null, { timeout: 60_000 }).then(() => true, () => false);
    await page.waitForTimeout(500);
    check(`${vp} ${name}: the layout opens in 3D with its ground drawn`, on && pic, JSON.stringify(await page.evaluate(() => window.__mapper.view3d)));
    // A Pin on the map, clear of the bar and the buttons, pressed.
    const vw = page.viewportSize();
    const pins = await page.evaluate(() => window.__mapper.pins());
    let hit = null;
    for (const p of pins.slice(0, 400)) {
      const pt = await page.evaluate((id) => window.__mapper.screenOf(id), p.id);
      if (!pt || pt.x < 40 || pt.x > vw.width * 0.6 || pt.y < vw.height * 0.4 || pt.y > vw.height * 0.8) continue;
      const cls = String(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className ?? '', [pt.x, pt.y]));
      if (cls.includes('surface-3d')) {
        hit = { ...p, ...pt };
        break;
      }
    }
    if (hit) {
      if (vp === 'phone') await page.touchscreen.tap(hit.x, hit.y);
      else await page.mouse.click(hit.x, hit.y);
      await page.waitForTimeout(300);
    }
    const sel = await page.evaluate(() => window.__mapper.selection);
    check(`${vp} ${name}: a press on a Pin in 3D selects it`, !!hit && sel.includes(hit.id), `${hit?.id} -> ${sel}`);
    await page.screenshot({ path: `.scratch/live/live3d-${which}-${vp}-${name.replace(/\W+/g, '-')}.png` });
  }
  check(`${vp} no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// The 3D code blocked on the flown host: flat, said, the flat canvas drawn.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route('**/assets/three3d-*.js', (r) => r.abort('failed'));
  await page.goto(`${BASE}/?world=${M}&map=${M_LAYOUT}`);
  const failed = await page.waitForFunction(() => window.__mapper?.view3d?.state === 'failed', null, { timeout: 60_000 }).then(() => true, () => false);
  const line = failed ? await page.textContent('.line3d') : '';
  check('the 3D code blocked: drawn flat with its line', failed && line.includes('The 3D view did not load; drawn flat.'), line);
  await page.screenshot({ path: `.scratch/live/live3d-${which}-blocked.png` });
  await ctx.close();
}

clearTimeout(watchdog);
await browser.close();
console.log(`live3d ${which}: ${failures ? `${failures} failed` : 'all ok'}`);
process.exit(failures ? 1 : 0);
