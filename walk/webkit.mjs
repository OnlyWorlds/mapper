// The WebKit walk (the iPhone's engine), played like walk/played.mjs: the picture draws from its
// copies, and a held arrow key stays far under WebKit's limit of 100 history writes in 10 s.
//   npm run build && npx playwright install webkit && node walk/webkit.mjs
// Exits 1 on any failed check. MAPPER_DIST serves another build, MAPPER_PORT another port.
import { webkit } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { serve } from './serve.mjs';
import { keyOf, MOPPETOPIA as M, M_MAP } from './worlds.mjs';

const FX = '.scratch/fixtures/api.json';
if (!existsSync(FX)) {
  console.error('No fixtures: run `node walk/record.mjs` after a build first.');
  process.exit(2);
}
const fx = JSON.parse(readFileSync(FX, 'utf8'));
mkdirSync('.scratch/shots', { recursive: true });
const site = await serve(process.env.MAPPER_DIST ?? 'dist', Number(process.env.MAPPER_PORT ?? 4189));
const browser = await webkit.launch().catch((e) => {
  const none = /Executable doesn't exist/.test(String(e?.message));
  console.error(none ? 'No WebKit for Playwright here: run "npx playwright install webkit" first.' : String(e?.message ?? e));
  process.exit(2);
});
const watchdog = setTimeout(() => {
  console.error('webkit: watchdog, 300 s');
  process.exit(2);
}, 300_000);

let checks = 0;
const fails = [];
const check = (label, ok, detail = '') => {
  checks++;
  if (!ok) fails.push(`webkit ${label}${detail ? `: ${detail}` : ''}`);
};

const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.route('https://www.onlyworlds.com/**', (r) => {
  const hit = fx.api[keyOf(r.request().url())];
  return hit ? r.fulfill({ status: hit.status, contentType: hit.type, headers: { 'access-control-allow-origin': '*' }, body: hit.body }) : r.fulfill({ status: 599, body: '{}' });
});
await ctx.route('https://media.onlyworlds.com/**', (r) => {
  const m = fx.media[r.request().url()];
  return m ? r.fulfill({ status: 200, contentType: m.type, headers: { 'access-control-allow-origin': '*' }, body: readFileSync(`.scratch/fixtures/media/${m.file}`) }) : r.fulfill({ status: 404, body: '' });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

try {
  await page.goto(`${site.url}/?world=${M}&map=${M_MAP}&measure=1`);
  await page.waitForFunction(() => window.__mapper.scene?.complete, null, { timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('.status')?.textContent.includes('is being'), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('.readout')?.dataset.firstDraw !== 'none', null, { timeout: 30_000 }).catch(() => {});
  const status = await page.textContent('.status');
  check('the picture draws from its copies', !status.includes('did not load') && (await page.evaluate(() => document.querySelector('.readout').dataset.firstDraw)) !== 'none', status);
  await page.screenshot({ path: '.scratch/shots/webkit-map.png' });

  await page.focus('canvas.surface');
  const w0 = await page.evaluate(() => window.__mapper.writes.length);
  for (let i = 0; i < 160; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);
  const w1 = await page.evaluate(() => window.__mapper.writes.length);
  const cam = await page.evaluate(() => window.__mapper.camera);
  const at = new URLSearchParams(await page.evaluate(() => location.search)).get('at')?.split(',').map(Number) ?? [];
  check('160 arrow presses write at only at their end, and the address follows the camera', w1 - w0 <= 3 && Math.abs(at[0] - cam.cx) <= 1, `${w1 - w0} writes, at ${at}, camera ${JSON.stringify(cam)}`);
  // Then a run of zoom-button presses, each its own gesture: a refused write would be a page error.
  for (let i = 0; i < 60; i++) await page.click(i % 2 ? 'button[aria-label="Zoom out"]' : 'button[aria-label="Zoom in"]');
  await page.waitForTimeout(700);
} catch (e) {
  check('the walk ran to its end', false, String(e?.message ?? e).split('\n')[0]);
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

clearTimeout(watchdog);
await browser.close();
await site.close();
console.log(`webkit: ${checks - fails.length} of ${checks} checks passed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
