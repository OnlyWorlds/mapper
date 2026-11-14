// The live home read: the FLOWN page at https://maps.onlyworlds.com/ as a stranger sees it, keyless,
// read only. Every demo picture card shows the media host's small copy (one width, 480, format=auto),
// each copy a small avif or webp, no picture read whole, nothing read from the OnlyWorlds API, and
// every card's box the same height in a row, at a desk and on a touch phone.
//   node walk/live-home.mjs [chromium|firefox]
// Its control is the same run on the build before the pictures (before the flight): it must fail there.
// LIVE_IP=<ip> pins the host, as in walk/live.mjs; LIVE_BASE reads another address. Screenshots go to
// .scratch/live/. Exits 1 on a failed check.
import { chromium, firefox } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const HOST = 'maps.onlyworlds.com';
const BASE = process.env.LIVE_BASE ?? `https://${HOST}`;
const SMALL = 'https://media.onlyworlds.com/cdn-cgi/image/width=480,format=auto/';
const PICTURE_CARDS = 8;
const which = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const IP = process.env.LIVE_IP;
mkdirSync('.scratch/live', { recursive: true });
const browser = await (which === 'chromium'
  ? chromium.launch({ args: IP ? [`--host-resolver-rules=MAP ${HOST} ${IP}`] : [] })
  : firefox.launch(IP ? { firefoxUserPrefs: { 'network.dns.forceResolve': IP } } : {}));
const watchdog = setTimeout(() => {
  console.error('live-home: watchdog, 300 s');
  process.exit(2);
}, 300_000);
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${which} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

for (const [vp, opts] of [
  ['desk', { viewport: { width: 1440, height: 900 } }],
  ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3, ...(which === 'chromium' ? { isMobile: true } : {}) }],
]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const media = [];
  const api = [];
  page.on('request', (r) => {
    if (r.url().startsWith('https://www.onlyworlds.com/api/')) api.push(r.url());
  });
  page.on('response', async (r) => {
    if (!r.url().startsWith('https://media.onlyworlds.com/')) return;
    const body = await r.body().catch(() => null);
    media.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] ?? '', bytes: body ? body.length : -1 });
  });
  await page.goto(`${BASE}/`, { timeout: 30_000 });
  await page.waitForSelector('.demos .world-row', { timeout: 30_000 });
  for (const row of await page.locator('.demos .cards').all()) await row.evaluate((el) => { el.scrollIntoView(); el.scrollLeft = el.scrollWidth; });
  await page.waitForFunction(() => [...document.querySelectorAll('.demos .card-pic img')].every((i) => i.complete), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const cards = await page.evaluate(() => [...document.querySelectorAll('.demos .map-card:not(.all)')].map((a) => {
    const i = a.querySelector('.card-pic img');
    return {
      row: a.closest('.world-row')?.getAttribute('data-world') ?? '',
      name: a.querySelector('.card-name')?.textContent ?? '',
      kind: a.querySelector('.card-kind')?.textContent ?? '',
      src: i?.getAttribute('src') ?? null,
      natural: i ? i.naturalWidth : null,
      big: !!a.querySelector('.card-pic .mark-big'),
      h: Math.round((a.querySelector('.card-pic')?.getBoundingClientRect().height ?? 0) * 10) / 10,
    };
  }));
  const pics = cards.filter((c) => c.kind === 'a picture');
  check(`${vp} every demo picture card shows its small copy, loaded, at most 480 wide`, pics.length === PICTURE_CARDS && pics.every((c) => c.src?.startsWith(SMALL) && c.natural > 0 && c.natural <= 480), pics.map((c) => `${c.name}:${c.natural}`).join(', '));
  check(`${vp} a layout or plan card shows its mark, never a picture`, cards.filter((c) => c.kind !== 'a picture').every((c) => c.src === null && c.big), cards.filter((c) => c.kind !== 'a picture').map((c) => `${c.name}:${c.big}`).join(', '));
  const rows = new Map();
  for (const c of cards) rows.set(c.row, [...(rows.get(c.row) ?? []), c.h]);
  check(`${vp} every card's box in a row is the same height`, [...rows.values()].every((hs) => hs[0] > 40 && hs.every((x) => Math.abs(x - hs[0]) < 1)), [...rows.values()].map((hs) => hs.join('/')).join(' · '));
  check(`${vp} each small copy is a 200 avif or webp under 100 KB`, media.length >= PICTURE_CARDS && media.every((m) => m.status === 200 && /^image\/(avif|webp)/.test(m.type) && m.bytes > 0 && m.bytes < 100_000), media.map((m) => `${m.status} ${m.type} ${m.bytes}`).join(', '));
  check(`${vp} the home reads only small copies from media, never a picture whole`, media.every((m) => m.url.startsWith(SMALL)), media.filter((m) => !m.url.startsWith(SMALL)).map((m) => m.url).join(', ') || `${media.length} reads`);
  check(`${vp} the stranger's home reads nothing from the OnlyWorlds API`, api.length === 0, api.join(', '));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `.scratch/live/live-home-${which}-${vp}.png`, fullPage: true });
  await ctx.close();
}

clearTimeout(watchdog);
await browser.close();
console.log(`live-home ${which}: ${failures ? `${failures} failed` : 'all ok'}`);
process.exit(failures ? 1 : 0);
