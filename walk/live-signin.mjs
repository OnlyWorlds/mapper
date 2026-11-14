// Sign in with OnlyWorlds read live: the FLOWN mapper at https://maps.onlyworlds.com against real
// keel, one crew account, one engine and one viewport a run. The browser starts signed out of
// onlyworlds.com, so the first press meets keel's own sign-in page (the account's login, typed by the
// walk, never printed), then its consent page when asked, then /signin/callback and the home.
//   1. A stranger's home: the demo rows, Sign in offered, nobody signed in.
//   2. Sign in: keel's sign-in page, the consent page if asked, back on the callback, then the home at
//      `/`, the callback's address replaced (this document was loaded at the callback; no entry keeps it).
//   3. The signed-in home: the account's worlds first (each by id, with its role in words, owned before
//      joined), read against the account's list by API on the walk's own token, then the demo rows
//      below the line (`.mine + .demos`). The token is in no storage and not in the address.
//   4. One of the account's own worlds' maps opened from its card and read on the token, then Back to
//      the home. An account with no world holding a Map says so and skips: the walk never makes one.
//   5. Reload: signed out (Sign in offered again), and the token from before the reload reads back 401
//      (the page's pagehide revoke). Then Back from that home: never the callback, and nothing traded.
//   6. Sign in again (the site's session kept, so no sign-in page; the consent page not asked again),
//      then Sign out: it says the sign-in is removed, and that token reads back 401.
//   7. The account's tokens listed (GET /account/tokens, Bearer); every token this run minted and
//      recorded by id that is still live is revoked by its id and read back 401, the walk's own token
//      last. Never by a name, never by a list's answer: the list only says which recorded ids still live.
//      The same takes place on a throw and on the watchdog.
// Every request carries its own time limit. Credentials, tokens and the callback's code are never
// printed, and no screenshot is taken on keel's sign-in page. Screenshots go to .scratch/live-signin/.
// Claim the test account first, as the team's other walks do, so no two walks sign in on it at once.
//   CREW_WALK_ACCOUNTS=<file> node walk/live-signin.mjs <b|c|d> [chromium|firefox] [phone]
// MAPPER_URL=<origin> reads another host; keel returns a sign-in only to https://maps.onlyworlds.com,
// and the mapper offers Sign in only there, so another origin stops at step 1 with a FAIL.
// LIVE_IP=<ip> pins the host, as walk/live.mjs does. Exits 1 on any failed check, 2 on the watchdog.
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from '@playwright/test';
import { OwV2Client } from '@onlyworlds/sdk';

const args = process.argv.slice(2);
const which = args.includes('firefox') ? 'firefox' : 'chromium';
const phone = args.includes('phone');
const letter = args.map((a) => /^(crew-walk-)?([bcd])$/.exec(a)?.[2]).find(Boolean);
if (!letter) {
  console.error('usage: node walk/live-signin.mjs <b|c|d> [chromium|firefox] [phone]');
  process.exit(2);
}
const label = `crew-walk-${letter}`;
const BASE = (process.env.MAPPER_URL ?? 'https://maps.onlyworlds.com').replace(/\/+$/, '');
const HOST = new URL(BASE).hostname;
const API = 'https://www.onlyworlds.com/api/v2';
const KEEL = 'www.onlyworlds.com';
const SIGNED_OUT = 'Signed out, and the sign-in is removed from your OnlyWorlds account.';
const ALREADY = 'That sign-in is no longer waiting here';
const tag = `${which} ${phone ? 'phone' : 'desk'} ${letter}`;
const SHOTS = fileURLToPath(new URL('../.scratch/live-signin/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const shotName = (name) => `${SHOTS}${which}-${phone ? 'phone' : 'desk'}-${letter}-${name}.png`;

// The account, from the crew's file outside the repository (as the parlor's walk/accounts.mjs reads it).
if (!process.env.CREW_WALK_ACCOUNTS) {
  console.error("set CREW_WALK_ACCOUNTS to the crew's accounts file (outside the repo)");
  process.exit(2);
}
const row = readFileSync(process.env.CREW_WALK_ACCOUNTS, 'utf8').split(String.fromCharCode(10)).map((l) => l.trim()).find((l) => l.startsWith(`${label} `) && l.includes('@'));
if (!row) {
  console.error(`no account ${label} in CREW_WALK_ACCOUNTS`);
  process.exit(2);
}
const [, email, password] = row.split(/\s+/);

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`[${tag}] ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const note = (line) => console.log(`[${tag}] ${line}`);
// Each request makes its own limit; one signal made at the start would abort every later fetch.
const limited = (ms) => (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(ms) });
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const statusOf = async (token) => {
  try {
    return (await fetch(`${API}/account`, { headers: bearer(token), signal: AbortSignal.timeout(20_000) })).status;
  } catch (e) {
    return `no answer (${String(e?.name ?? e)})`;
  }
};
/** A token read back until it answers 401, for a revoke that may land a moment after the page moved on. */
const readsBack401 = async (token, ms = 8000) => {
  const end = Date.now() + ms;
  let s = await statusOf(token);
  while (s !== 401 && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 500));
    s = await statusOf(token);
  }
  return s;
};
const waitUntil = async (pred, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pred();
};

// 0. The walk's own token: minted first and recorded, for the account's lists and the take-back.
const walk = await new OwV2Client({ client: 'mapper-walk', fetch: limited(20_000) }).signInWithPassword({ email, password, tokenName: 'mapper live sign-in walk' });
const acct = async (method, path) => {
  const r = await fetch(`${API}${path}`, { method, headers: bearer(walk.token), signal: AbortSignal.timeout(20_000) });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
};
/** The account's token ids before the browser opens: only to name a stray at the end, never to revoke one. */
let tokensBefore = null;

/** Every token the mapper received in this run, read off the exchange's answer: the value stays in memory, unprinted. */
const exchanged = [];
let browser = null;
let cleaned = false;
const cleanup = async () => {
  if (cleaned) return;
  cleaned = true;
  await browser?.close().catch(() => {});
  // 7. The list says which recorded ids are still live; only those ids are revoked, each read back.
  let listed = null;
  try {
    const got = await acct('GET', '/account/tokens');
    listed = got.status === 200 && Array.isArray(got.body?.data) ? got.body.data : null;
    if (!listed) note(`the token list answered ${got.status}: every recorded id is revoked by its id`);
  } catch (e) {
    note(`the token list did not answer (${String(e?.name ?? e)}): every recorded id is revoked by its id`);
  }
  const now = Date.now();
  const live = (t) => t && !t.revoked && !(t.expires_at && Date.parse(t.expires_at) <= now);
  let taken = 0;
  for (const x of exchanged) {
    const onList = listed?.find((t) => t.id === x.id);
    if (listed && !onList) {
      note(`token ${x.n} (sign-in ${x.n}) is not on the account's list: nothing sent`);
      continue;
    }
    if (listed && !live(onList)) continue;
    let del = 'no answer';
    try {
      del = (await acct('DELETE', `/account/tokens/${encodeURIComponent(x.id)}`)).status;
    } catch { /* read back below */ }
    taken++;
    check(`cleanup: sign-in ${x.n}'s token, still live, revoked by its id and read back 401`, (await readsBack401(x.token)) === 401, `DELETE ${del}`);
  }
  note(`cleanup: ${exchanged.length} token(s) recorded, ${taken} still live and taken back by id`);
  // A token new since the start that this run did not record is named, never revoked: only a recorded id is.
  if (listed && tokensBefore) {
    const stray = listed.filter((t) => !tokensBefore.has(t.id) && t.id !== walk.id && !exchanged.some((x) => x.id === t.id) && live(t));
    check('every token new since the start was recorded by this run', stray.length === 0, stray.map((t) => `${t.name} ...${t.last4}, left live: check it by hand`).join(', '));
  }
  let del = 'no answer';
  try {
    del = (await acct('DELETE', `/account/tokens/${encodeURIComponent(walk.id)}`)).status;
  } catch { /* read back below */ }
  check("cleanup: the walk's own token revoked by its id and read back 401", (await readsBack401(walk.token)) === 401, `DELETE ${del}`);
};
const abort = async (e) => {
  console.log(`[${tag}] aborted: ${String(e?.message ?? e).split(String.fromCharCode(10))[0]}`);
  await cleanup();
  process.exit(1);
};
process.on('uncaughtException', abort);
process.on('unhandledRejection', abort);
const watchdog = setTimeout(async () => {
  console.log(`[${tag}] aborted: the watchdog, past 8 minutes`);
  await cleanup();
  process.exit(2);
}, 480_000);
const finish = async () => {
  clearTimeout(watchdog);
  await cleanup();
  console.log(failures ? `[${tag}] ${failures} FAILED` : `[${tag}] all ok`);
  process.exit(failures ? 1 : 0);
};

const startList = await acct('GET', '/account/tokens').catch(() => null);
if (startList?.status === 200 && Array.isArray(startList.body?.data)) tokensBefore = new Set(startList.body.data.map((t) => t.id));

// The account's worlds, read by API on the walk's token: what the signed-in home must show.
const listedWorlds = await acct('GET', '/account/worlds');
if (listedWorlds.status !== 200 || !Array.isArray(listedWorlds.body?.data)) throw new Error(`the account's worlds answered ${listedWorlds.status}`);
const worlds = listedWorlds.body.data;
const roleWords = (w) => {
  if (w.role === 'owner') return 'yours';
  const r = typeof w.member_role === 'string' ? w.member_role.replace(/_/g, '-') : '';
  return r ? `a member (${r})` : 'a member';
};
note(`${label} has ${worlds.length} world(s): ${worlds.map((w) => `${w.name} (${roleWords(w)})`).join(', ') || 'none'}`);

const IP = process.env.LIVE_IP;
browser = await (which === 'chromium'
  ? chromium.launch({ args: IP ? [`--host-resolver-rules=MAP ${HOST} ${IP}`] : [] })
  : firefox.launch(IP ? { firefoxUserPrefs: { 'network.dns.forceResolve': IP } } : {}));
const ctx = await browser.newContext(phone
  ? { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3, ...(which === 'chromium' ? { isMobile: true } : {}) }
  : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => {
  if (new URL(page.url()).hostname === HOST) errors.push(String(e?.message ?? e).split(String.fromCharCode(10))[0]);
});
page.on('response', async (r) => {
  if (r.url().split('?')[0] !== `${API}/auth/token` || r.request().method() !== 'POST') return;
  const b = await r.json().catch(() => null);
  if (typeof b?.token_id === 'string' && typeof b?.token === 'string') exchanged.push({ n: exchanged.length + 1, id: b.token_id, token: b.token, expiresAt: b.expires_at ?? null, scope: b.scope ?? null });
});
/** The reads the page sends to OnlyWorlds for a world, and whether each carried the token: never the token itself. */
const reads = [];
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith(`${API}/`) || r.method() !== 'GET') return;
  const auth = r.headers()['authorization'] ?? null;
  const last = exchanged[exchanged.length - 1];
  reads.push({ path: new URL(u).pathname, world: new URL(u).searchParams.get('world'), onToken: !!last && auth === `Bearer ${last.token}` });
});
/** The main frame's addresses as they commit, host and path only (never a query: the callback's holds the code). */
const navs = [];
page.on('framenavigated', (f) => {
  if (f === page.mainFrame()) navs.push(`${new URL(f.url()).hostname}${new URL(f.url()).pathname}`);
});
const shot = (name) => page.screenshot({ path: shotName(name) }).catch(() => {});
const signedIn = () => page.evaluate(() => window.__mapper?.signedIn ?? null);
const signInButtons = () => page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).count();
const home = () => page.waitForSelector('.demos .world-row, .ways', { timeout: 30_000 });
/** Marks the document in hand, so a wait can tell the next one from it. */
const mark = () => page.evaluate(() => { window.__old = true; }).catch(() => {});

/**
 * Press Sign in and follow the round trip to its end: keel's sign-in page (typed into), its consent
 * page (Continue), each when it comes, until the mapper has settled on its own address again.
 */
async function signIn(n) {
  const seen = { signInPage: 0, consent: 0, consentReadsOnly: null };
  const before = exchanged.length;
  await mark();
  await page.getByRole('button', { name: 'Sign in with OnlyWorlds' }).first().click();
  let back = false;
  for (let hop = 0; hop < 6 && !back; hop++) {
    const where = await page.waitForFunction((host) => {
      if (window.__old) return null;
      if (location.hostname === 'www.onlyworlds.com') {
        if (document.querySelector('input[name="login"]') && document.querySelector('input[name="password"]')) return 'signin';
        if (document.querySelector('button[name="decision"][value="continue"]')) return 'consent';
        return null;
      }
      if (location.hostname === host && window.__mapper && !location.pathname.startsWith('/signin') && !document.body.innerText.includes('Signing in…')) return 'mapper';
      return null;
    }, HOST, { timeout: 45_000 }).then((h) => h.jsonValue()).catch(async () => {
      const u = new URL(page.url());
      const head = await page.locator('h1').first().textContent({ timeout: 2000 }).catch(() => '');
      throw new Error(`sign-in ${n}: stuck at ${u.hostname}${u.pathname} ("${(head ?? '').trim().slice(0, 80)}")`);
    });
    if (where === 'mapper') {
      back = true;
      break;
    }
    if (where === 'signin') {
      if (++seen.signInPage > 1) throw new Error(`sign-in ${n}: keel's sign-in page came back after the login (refused, or its budget spent)`);
      await page.fill('input[name="login"]', email);
      await page.fill('input[name="password"]', password);
      await mark();
      await page.locator('form button[type="submit"]').first().click();
      continue;
    }
    if (where === 'consent') {
      if (++seen.consent > 1) throw new Error(`sign-in ${n}: keel's consent page came back after Continue`);
      await shot(`${n}-consent`);
      seen.consentReadsOnly = (await page.locator('body').innerText()).includes('This sign-in reads only');
      await mark();
      await page.locator('button[name="decision"][value="continue"]').click();
    }
  }
  if (!back) throw new Error(`sign-in ${n}: not back on the mapper after six pages`);
  const landed = await waitUntil(() => exchanged.length > before, 10_000);
  note(`sign-in ${n}: keel's sign-in page ${seen.signInPage ? 'shown, the login typed' : 'not shown'}; consent page ${seen.consent ? 'shown, Continue pressed' : 'not shown'}`);
  return { ...seen, exchanged: landed ? exchanged.length - before : 0 };
}

// 1. A stranger's home.
await page.goto(`${BASE}/`, { timeout: 45_000 });
await home();
const strangerDemos = await page.locator('.demos .world-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-world')));
check('a stranger\'s home shows the demo worlds in rows', strangerDemos.length > 0 && (await page.locator('#demos-h').textContent()) === 'Public worlds to try', `${strangerDemos.length} rows`);
check('nobody is signed in, and no worlds of anyone\'s are listed', (await signedIn()) === false && (await page.locator('.mine').count()) === 0);
const offered = await signInButtons();
check('Sign in with OnlyWorlds is offered', offered === 1, `${offered} button(s) on ${BASE}`);
await shot('1-stranger');
if (offered !== 1) {
  check('no page error', errors.length === 0, errors.slice(0, 2).join(' | '));
  await finish();
}

// 2. The first sign-in: keel's sign-in page (the browser is signed out of onlyworlds.com), consent if asked, the return.
const n0 = navs.length;
const first = await signIn(1);
check('the first sign-in meets keel\'s own sign-in page', first.signInPage === 1);
check('one exchange, its token recorded by id', first.exchanged === 1 && exchanged.length === 1, `${exchanged.length} recorded`);
if (!exchanged.length) {
  check('no page error on the mapper', errors.length === 0, errors.slice(0, 2).join(' | '));
  await finish();
}
// The callback's own entry is replaced by `/`; that Back never returns to it is read in step 5.
const via = navs.slice(n0);
const at = await page.evaluate(() => location.pathname + location.search + location.hash);
check('the return came through /signin/callback and the home stands at /', via.includes('maps.onlyworlds.com/signin/callback') && via[via.length - 1] === 'maps.onlyworlds.com/' && at === '/', `${via.join(' > ')}; at ${at}`);
check('signed in', (await signedIn()) === true);
const t1 = exchanged[0];
// Maps asks for a read-only token (scope world:read): the token answer names the scope, the account's
// list carries it on that token's row, and the consent page, when shown, says the sign-in reads only.
check('the token answer says the token is read-only', t1?.scope === 'world:read', String(t1?.scope));
if (first.consent) check('the consent page says the sign-in reads only', first.consentReadsOnly === true);
else note('the consent page was not shown (an earlier consent covers a read-only sign-in): its sentence not read');
{
  const got = await acct('GET', '/account/tokens').catch(() => null);
  const rows = Array.isArray(got?.body?.data) ? got.body.data : [];
  const row = rows.find((r) => r?.id === t1?.id);
  check('the account\'s token list marks it read-only', row?.scope === 'world:read', row ? String(row.scope) : 'row not listed');
  // A write by the read-only token is refused: a key mint on one of the account's worlds. Should keel take
  // it, the key it made is recorded and revoked by its id at once, on the walk's own token, and the check fails.
  const worlds = await acct('GET', '/account/worlds').catch(() => null);
  const wid = (Array.isArray(worlds?.body?.data) ? worlds.body.data : Array.isArray(worlds?.body) ? worlds.body : [])[0]?.id;
  if (!wid || !t1?.token) note('no world on the account to try a write on: the 403 not read');
  else {
    const r = await fetch(`${API}/account/worlds/${encodeURIComponent(wid)}/keys`, {
      method: 'POST', headers: { ...bearer(t1.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'maps read-only walk: must be refused' }), signal: AbortSignal.timeout(20_000),
    });
    const b = await r.json().catch(() => null);
    const made = b?.id ?? b?.key_id ?? null;
    if (r.ok && made) {
      const del = await fetch(`${API}/account/worlds/${encodeURIComponent(wid)}/keys/${encodeURIComponent(made)}`, { method: 'DELETE', headers: bearer(walk.token), signal: AbortSignal.timeout(20_000) });
      note(`keel took the write: key ${made} revoked by id (${del.status})`);
    }
    const said = JSON.stringify(b ?? {});
    check('a write by the read-only token is refused 403 permission_error', r.status === 403 && said.includes('permission_error'), `${r.status} ${said.slice(0, 160)}`);
  }
}
if (t1?.expiresAt) {
  const hours = (Date.parse(t1.expiresAt) - Date.now()) / 3_600_000;
  check('the token ends by itself in six hours', hours > 5.9 && hours <= 6.01, `${hours.toFixed(3)} h`);
}

// 3. The signed-in home: the account's worlds first, the demo rows below the line.
await page.waitForSelector('.mine', { timeout: 30_000 });
await page.waitForFunction(() => document.querySelector('.mine .world-row, .mine .failure') || document.querySelector('.mine')?.textContent.includes('This account has no worlds yet.'), null, { timeout: 30_000 });
const who = ((await page.locator('.mine .who strong').textContent()) ?? '').trim();
check('the home says who is signed in, offers Sign out and no second Sign in', who.length > 0 && (await page.getByRole('button', { name: 'Sign out' }).count()) === 1 && (await signInButtons()) === 0);
const shown = await page.locator('.mine .world-row').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-world'), name: e.querySelector('.world-title-name')?.textContent ?? '', role: e.querySelector('.world-role')?.textContent ?? '' })));
if (worlds.length === 0) {
  check('an account with no worlds is told so', ((await page.locator('.mine').textContent()) ?? '').includes('This account has no worlds yet.'));
} else {
  const byId = new Map(worlds.map((w) => [w.id, w]));
  check('every world on the account\'s list is listed, once, and nothing else', shown.length === worlds.length && new Set(shown.map((s) => s.id)).size === shown.length && shown.every((s) => byId.has(s.id)), `${shown.length} rows, ${worlds.length} on the list`);
  const wrong = shown.filter((s) => byId.get(s.id) && (s.name !== (byId.get(s.id).name || 'A world with no name') || s.role !== roleWords(byId.get(s.id))));
  check('each row has its world\'s name and the role in words', wrong.length === 0, wrong.map((s) => `${s.name}: "${s.role}"`).join(', '));
  const ranks = shown.map((s) => (byId.get(s.id)?.role === 'owner' ? 0 : 1));
  check('the worlds owned come before the worlds joined', ranks.every((r, i) => i === 0 || ranks[i - 1] <= r), shown.map((s) => s.role).join(' | '));
}
const below = await page.evaluate(() => {
  const d = document.querySelector('.mine + .demos');
  return d ? { hidden: d.hidden, line: getComputedStyle(d).borderTopWidth, heading: d.querySelector('h2')?.textContent ?? '', ids: [...d.querySelectorAll('.world-row')].map((e) => e.getAttribute('data-world')) } : null;
});
const expectDemos = strangerDemos.filter((id) => !worlds.some((w) => w.id === id));
check('the demo rows come after the account\'s worlds, below a line', !!below && parseFloat(below.line) > 0 && (expectDemos.length === 0 ? below.hidden : !below.hidden && below.heading === 'Public demo worlds'), JSON.stringify(below && { line: below.line, heading: below.heading, rows: below.ids.length }));
check('a demo world the account holds is shown once, in its own rows', !!below && below.ids.join('|') === expectDemos.join('|'), `${below?.ids.length} demo rows, ${expectDemos.length} expected`);
const kept = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, href: location.href }));
check('the token is in no storage and not in the address', !!t1 && !JSON.stringify(kept).includes(t1.token));
check('the round trip\'s record and its stamp are gone', Object.keys(kept.local).every((k) => !k.startsWith('ow_signin') && !k.startsWith('mapper.signin')), Object.keys(kept.local).join(','));
await shot('3-signed-in-home');

// 4. One of the account's own worlds' maps, from its card, then Back to the home.
const ordered = [...worlds].sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1));
let withMap = null;
for (const w of ordered) {
  const page1 = await new OwV2Client({ client: 'mapper-walk', apiKey: walk.token, world: w.id, fetch: limited(20_000) }).list('map', { limit: 1 }).catch((e) => {
    note(`the maps of ${w.name} could not be read by API (${String(e?.message ?? e).slice(0, 80)})`);
    return null;
  });
  if (page1?.data?.length) {
    withMap = w;
    break;
  }
}
if (!withMap) {
  note(`step 4 skipped: none of ${label}'s worlds holds a Map (the walk makes none)`);
} else {
  if (withMap.role !== 'owner') note(`no world ${label} owns holds a Map: opening ${withMap.name}, which it joined`);
  const rowEl = page.locator(`.mine .world-row[data-world="${withMap.id}"]`);
  await rowEl.scrollIntoViewIfNeeded();
  const card = rowEl.locator('.map-card:not(.all)').first();
  await card.waitFor({ timeout: 45_000 });
  const cardName = ((await card.locator('.card-name').textContent()) ?? '').trim();
  const h0 = reads.length;
  await card.click();
  await page.waitForFunction(() => window.__mapper?.scene?.complete, null, { timeout: 60_000 });
  const search = await page.evaluate(() => location.search);
  check(`${withMap.name}'s card "${cardName}" opens its map`, search.startsWith(`?world=${withMap.id}&map=`) && ((await page.textContent('.map-name')) ?? '').trim() === cardName, `${search.replace(/=[0-9a-f-]{36}/g, '=<id>')}`);
  const mine = reads.slice(h0).filter((r) => r.world === withMap.id);
  check('the map is read on the token', mine.length > 0 && mine.every((r) => r.onToken), `${mine.length} reads, ${mine.filter((r) => !r.onToken).length} without the token`);
  await shot('4-map');
  await page.goBack();
  await page.waitForSelector('.mine .world-row', { timeout: 30_000 });
  check('Back returns to the signed-in home', (await page.evaluate(() => location.pathname + location.search)) === '/' && (await signedIn()) === true);
}

// 5. A reload asks again, and the token from before it is revoked as the page goes (pagehide).
await page.reload({ waitUntil: 'commit' });
await home();
await page.waitForFunction(() => window.__mapper && !document.body.innerText.includes('Signing in…'), null, { timeout: 30_000 });
check('after a reload the home is a stranger\'s, Sign in offered again', (await signedIn()) === false && (await page.locator('.mine').count()) === 0 && (await signInButtons()) === 1);
check('the token from before the reload reads back 401', (await readsBack401(t1.token)) === 401);
await shot('5-after-reload');
const traded = exchanged.length;
await mark();
await page.goBack({ waitUntil: 'commit', timeout: 30_000 }).catch(() => null);
await page.waitForTimeout(4000);
const back = new URL(page.url());
let backSaid = '';
if (back.hostname === HOST) backSaid = ((await page.locator('.said').first().textContent({ timeout: 5000 }).catch(() => '')) ?? '').trim();
note(`Back from the reloaded home went to ${back.hostname}${back.pathname}${backSaid ? ` ("${backSaid.slice(0, 60)}")` : ''}`);
check('Back never lands on the callback, and trades nothing', !(back.hostname === HOST && back.pathname.startsWith('/signin')) && exchanged.length === traded && (back.hostname !== HOST || backSaid === '' || backSaid.startsWith(ALREADY)), `${exchanged.length - traded} new exchange(s)`);
if (back.hostname === HOST) check('and the mapper is signed out there', (await signedIn()) === false);

// 6. Sign in again (the site's session kept), then Sign out.
await page.goto(`${BASE}/`, { timeout: 45_000 });
await home();
const second = await signIn(2);
check('the second sign-in goes through without keel\'s sign-in page (the site\'s session kept)', second.signInPage === 0);
check('the second sign-in asks no consent again (consent outlives the last token)', second.consent === 0);
check('a second exchange, its token recorded by id', second.exchanged === 1 && exchanged.length === 2, `${exchanged.length} recorded`);
await page.waitForSelector('.mine', { timeout: 30_000 });
check('signed in again', (await signedIn()) === true && (await page.evaluate(() => location.pathname + location.search)) === '/');
const t2 = exchanged.length === 2 ? exchanged[1] : null;
await page.getByRole('button', { name: 'Sign out' }).click();
await page.waitForSelector('.said:has-text("Signed out")', { timeout: 20_000 });
const said = ((await page.textContent('.said')) ?? '').trim();
check('Sign out says the sign-in is removed', said.startsWith(SIGNED_OUT), said.slice(0, 120));
check('the home is a stranger\'s again', (await signedIn()) === false && (await page.locator('.mine').count()) === 0 && (await signInButtons()) === 1);
check('the signed-out token reads back 401', !!t2 && (await readsBack401(t2.token)) === 401, t2 ? '' : 'no second token recorded');
await shot('6-signed-out');

check('no page error on the mapper', errors.length === 0, errors.slice(0, 2).join(' | '));
// 7. The take-back of every recorded token still live, then the walk's own: in cleanup.
await finish();
