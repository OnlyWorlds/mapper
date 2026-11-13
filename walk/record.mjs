// Record the played walk's fixtures: the built page, driven along the played walk's paths against
// the real OnlyWorlds (keyless reads of two public worlds, nothing written), with every answer to
// www.onlyworlds.com/api/v2 and every picture from media.onlyworlds.com saved. The page's own reader
// keeps to one request at a time and waits out a 429, so the recording is as polite as the page.
//   npm run build && node walk/record.mjs [a word of the steps to run, e.g. Moppetopia]
// Answers already recorded are kept; a run adds to them.
// Writes .scratch/fixtures/api.json and .scratch/fixtures/media/ (not in the repository: they hold
// the worlds' own rows and pictures, and are recorded again whenever wanted).
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { serve } from './serve.mjs';
import { keyOf, MOPPETOPIA as M, SIKELIA as S, M_MAP, M_SPACE, M_LAYOUT, S_BIG, S_LAYOUT, M_ELEMENT, S_ELEMENT, AT } from './worlds.mjs';

const OUT = '.scratch/fixtures';
mkdirSync(`${OUT}/media`, { recursive: true });
const held = existsSync(`${OUT}/api.json`) ? JSON.parse(readFileSync(`${OUT}/api.json`, 'utf8')) : { api: {}, media: {} };
const api = held.api;
const media = held.media;
const only = process.argv[2] ?? '';
const site = await serve('dist', 4187);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('https://www.onlyworlds.com/**', async (route) => {
  const res = await route.fetch();
  const body = await res.text();
  if (res.status() !== 429) {
    api[keyOf(route.request().url())] = { status: res.status(), type: res.headers()['content-type'] ?? 'application/json', body };
  }
  await route.fulfill({ response: res, body });
});
await ctx.route('https://media.onlyworlds.com/**', async (route) => {
  const res = await route.fetch();
  const buf = await res.body();
  const file = createHash('sha1').update(route.request().url()).digest('hex').slice(0, 16);
  writeFileSync(`${OUT}/media/${file}`, buf);
  media[route.request().url()] = { file, type: res.headers()['content-type'] ?? 'image/webp', status: res.status() };
  await route.fulfill({ response: res, body: buf });
});
const page = await ctx.newPage();
const complete = () => page.waitForFunction(() => window.__mapper.scene?.complete, null, { timeout: 300_000 });
const step = async (label, fn) => {
  if (only && !label.includes(only)) return;
  const t = Date.now();
  await fn();
  console.log(`${label}: ${((Date.now() - t) / 1000).toFixed(1)} s, ${Object.keys(api).length} answers held`);
};

await step('Moppetopia list and its maps', async () => {
  await page.goto(`${site.url}/?world=${M}`);
  await page.waitForSelector('.map-row');
  await page.waitForFunction(() => !document.body.textContent.includes('Counting each map'));
  await page.click(`text=MoppetopiaMap`);
  await complete();
  await page.click('button.back');
  await page.click(`text=Moppetopia: layout`);
  await complete();
});
await step('Moppetopia element view', async () => {
  await page.goto(`${site.url}/?world=${M}&type=location&element=${M_ELEMENT}`);
  await complete();
  await page.click(`.element-head .chip:has-text("Moppetopia: layout")`);
  await complete();
  await page.goto(`${site.url}/?world=${M}&element=${M_ELEMENT}`);
  await complete();
});
await step('Moppetopia map by address', async () => {
  await page.goto(`${site.url}/?world=${M}&map=${M_SPACE}&at=${AT}`);
  await complete();
});
await step('Sikelia list and its two largest maps', async () => {
  await page.goto(`${site.url}/?world=${S}`);
  await page.waitForSelector('.map-row');
  await page.click(`.map-row:has(.row-name:text-is("Sikelia"))`);
  await complete();
  await page.click('button.back');
  await page.click(`.map-row:has(.row-name:text-is("Sikelia: layout"))`);
  await complete();
});
await step('Sikelia element view', async () => {
  await page.goto(`${site.url}/?world=${S}&type=location&element=${S_ELEMENT}`);
  await complete();
});
await step('Sikelia map by address, measured', async () => {
  await page.goto(`${site.url}/?world=${S}&map=${S_BIG}&measure=1`);
  await complete();
  await page.waitForTimeout(3000);
});
void M_MAP; void M_LAYOUT; void S_LAYOUT;
writeFileSync(`${OUT}/api.json`, JSON.stringify({ recorded: new Date().toISOString(), api, media }));
console.log(`recorded ${Object.keys(api).length} answers and ${Object.keys(media).length} pictures`);
await browser.close();
await site.close();
