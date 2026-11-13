// The live look: the built page against the real OnlyWorlds, keyless, read only. Moppetopia's maps
// and Sikelia's two largest, at a desk and at 390, with the measure readout on Sikelia's map
// "Sikelia". One page per size, moving inside the app so the world is read once a size; the page
// keeps to one request at a time and waits out a 429 itself.
//   npm run build && node walk/look.mjs [chromium|firefox]
// Screenshots go to .scratch/look/.
import { chromium, firefox } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';
import { MOPPETOPIA as M, SIKELIA as S, M_ELEMENT, S_BIG } from './worlds.mjs';

const which = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
const engine = which === 'firefox' ? firefox : chromium;
mkdirSync('.scratch/look', { recursive: true });
const site = await serve('dist', 4187);
const browser = await engine.launch();
const watchdog = setTimeout(() => {
  console.error('look: watchdog, 900 s');
  process.exit(2);
}, 900_000);
let failures = 0;

for (const [vp, opts] of [
  ['desk', { viewport: { width: 1440, height: 900 } }],
  ['390', { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3, ...(which === 'chromium' ? { isMobile: true } : {}) }],
]) {
  const page = await browser.newPage(opts);
  const errors = [];
  let reads = 0;
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => r.url().startsWith('https://www.onlyworlds.com/api/') && reads++);
  const snap = (name) => page.screenshot({ path: `.scratch/look/${which}-${vp}-${name}.png` });
  const complete = () => page.waitForFunction(() => window.__mapper.scene?.complete && !document.querySelector('.status')?.textContent.includes('is being'), null, { timeout: 300_000 });
  const go = (search) => page.evaluate((s) => { history.pushState(null, '', s); dispatchEvent(new PopStateEvent('popstate')); }, search);
  const line = async (label) => {
    const s = await page.evaluate(() => window.__mapper.scene);
    console.log(`${which} ${vp} ${label}: ${JSON.stringify(s?.counts)} out ${JSON.stringify(s?.out)} derive ${s?.ms?.toFixed(1)} ms, ${reads} reads so far`);
  };

  await page.goto(`${site.url}/?world=${M}`);
  await page.waitForSelector('.map-row');
  await page.waitForTimeout(1500);
  await snap('moppetopia-maps');
  for (const name of ['MoppetopiaMap', 'Moppetopia Space Map', 'Moppetopia: layout']) {
    await page.click(`.map-row:has(.row-name:text-is("${name}"))`);
    await complete();
    await page.waitForTimeout(600);
    await line(name);
    await snap(`moppetopia-${name.replace(/\W+/g, '-').toLowerCase()}`);
    await page.click('button.back');
    await page.waitForSelector('.map-row');
  }
  await go(`?world=${M}&type=location&element=${M_ELEMENT}`);
  await complete();
  await page.waitForTimeout(600);
  await snap('moppetopia-element');

  await go(`?world=${S}&map=${S_BIG}&measure=1`);
  await complete();
  await page.waitForTimeout(800);
  await line('Sikelia');
  await snap('sikelia');
  if (vp === 'desk') {
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
    await page.waitForTimeout(400);
    console.log(`${which} desk measure, live: ${await page.textContent('.readout')}`);
    await snap('sikelia-measured');
  }
  await go(`?world=${S}`);
  await page.waitForSelector('.map-row');
  await page.click('.map-row:has(.row-name:text-is("Sikelia: layout"))');
  await complete();
  await page.waitForTimeout(800);
  await line('Sikelia: layout');
  await snap('sikelia-layout');
  const real = errors.filter((e) => !/^Failed to load resource/.test(e));
  console.log(`${which} ${vp}: ${reads} reads, ${real.length} console errors`);
  for (const e of real) console.log(`  error: ${e}`);
  failures += real.length;
  await page.close();
}
clearTimeout(watchdog);
await browser.close();
await site.close();
process.exit(failures ? 1 : 0);
