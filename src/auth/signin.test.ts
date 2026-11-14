import { afterEach, describe, expect, it, vi } from 'vitest';
import { revokeToken } from './account';
import {
  ALREADY_USED_LINE,
  NO_STORAGE_LINE,
  SIGN_IN_RECORD_KEY,
  SIGN_IN_REDIRECT_URI,
  STALE_RECORD_MS,
  STAMP_KEY,
  beginSignIn,
  canSignIn,
  isSignInCallback,
  resumeFrom,
  resumeOf,
  signInCallbackLine,
  startSignInCallback,
  sweepStaleRecord,
  type RecordStore,
} from './signin';

const W = '0695db52-5433-7332-8000-db7fe10da375';
const M = '069620b8-a566-7850-8000-2afcac2701e5';
const TOKEN = 'ow_a_secret_token_value';

/** A storage that keeps every write it was ever given, so a test can ask what reached it. */
function recordingStore(): RecordStore & { map: Map<string, string>; writes: [string, string][] } {
  const map = new Map<string, string>();
  const writes: [string, string][] = [];
  return {
    map,
    writes,
    get: (k) => map.get(k) ?? null,
    set: (k, v) => {
      writes.push([k, v]);
      map.set(k, v);
    },
    remove: (k) => void map.delete(k),
  };
}

async function begin(store: RecordStore, resume: string | null = null, now = Date.now()): Promise<URL> {
  let went = '';
  await beginSignIn(resume, { store, now, navigate: (u) => (went = u) });
  return new URL(went);
}

function tokenAnswer(body: unknown = { token: TOKEN, token_id: 'tok-1', token_type: 'bearer', expires_at: '2026-11-13T23:00:00Z', account: { id: 'acc-1', username: 'wren' } }, status = 200) {
  const seen: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { f, seen };
}

afterEach(() => vi.unstubAllGlobals());

describe('the round trip', () => {
  it('is offered only on the registered origin, and knows its callback', () => {
    expect(canSignIn('https://maps.onlyworlds.com')).toBe(true);
    for (const o of ['http://127.0.0.1:4187', 'http://localhost:5173', 'https://maps.onlyworlds.com.evil.example', 'http://maps.onlyworlds.com']) expect(canSignIn(o)).toBe(false);
    expect(isSignInCallback('/signin/callback')).toBe(true);
    expect(isSignInCallback('/signin/callback/')).toBe(true);
    expect(isSignInCallback('/')).toBe(false);
    expect(isSignInCallback('/signin/callbackx')).toBe(false);
  });

  it('stamps the press before the record, goes to keel as the maps client, and replaces the page by default', async () => {
    const store = recordingStore();
    const url = await begin(store, `/?world=${W}`, 1000);
    expect(store.writes[0]).toEqual([STAMP_KEY, '1000']);
    expect(store.writes.findIndex(([k]) => k === SIGN_IN_RECORD_KEY)).toBeGreaterThan(0);
    expect(url.origin + url.pathname).toBe('https://www.onlyworlds.com/signin/authorize');
    expect(url.searchParams.get('client_id')).toBe('maps');
    expect(url.searchParams.get('redirect_uri')).toBe(SIGN_IN_REDIRECT_URI);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // Maps only reads, so it asks OnlyWorlds for a read-only token.
    expect(url.searchParams.get('scope')).toBe('world:read');
    // The resume rides in the SDK's own record.
    expect(JSON.parse(store.map.get(SIGN_IN_RECORD_KEY)!).resume).toBe(`/?world=${W}`);

    const replaced: string[] = [];
    vi.stubGlobal('location', { replace: (u: string) => replaced.push(u), assign: () => { throw new Error('assign, not replace'); } });
    await beginSignIn('/', { store: recordingStore() });
    expect(replaced).toHaveLength(1);
  });

  it('with no storage, says so in its own words and goes nowhere', async () => {
    let went = '';
    await expect(beginSignIn('/', { store: null, navigate: (u) => (went = u) })).rejects.toThrow(NO_STORAGE_LINE);
    const throwing: RecordStore = { get: () => null, set: () => { throw new Error('quota'); }, remove: () => {} };
    await expect(beginSignIn('/', { store: throwing, navigate: (u) => (went = u) })).rejects.toThrow(NO_STORAGE_LINE);
    expect(went).toBe('');
  });

  it('comes back with the token in memory only: nothing written anywhere holds it, and the address is replaced at once', async () => {
    const store = recordingStore();
    const url = await begin(store, `/?world=${W}&map=${M}`);
    const back = `${SIGN_IN_REDIRECT_URI}?code=abc&state=${url.searchParams.get('state')}`;
    const writes: string[] = [];
    vi.stubGlobal('history', { replaceState: (_s: unknown, _t: string, u: string) => writes.push(u) });
    const { f, seen } = tokenAnswer();
    const pending = startSignInCallback(back, { store, fetchImpl: f });
    // Replaced before the exchange has answered: Back never returns to the code, a reload never replays it.
    expect(writes).toEqual(['/']);
    const out = await pending;
    expect(out).toMatchObject({ ok: true, token: TOKEN, tokenId: 'tok-1', username: 'wren', expiresAt: '2026-11-13T23:00:00Z', resume: `/?world=${W}&map=${M}` });
    expect(seen).toEqual(['https://www.onlyworlds.com/api/v2/auth/token']);
    expect(store.writes.some(([k, v]) => k.includes(TOKEN) || v.includes(TOKEN))).toBe(false);
    expect(store.map.size).toBe(0);
  });

  it('hands back only the mapper’s own addresses', () => {
    for (const good of ['/', `/?world=${W}`, `/?world=${W}&map=${M}`]) expect(resumeOf(good)).toBe(good);
    for (const bad of [`?world=${W}`, `/?world=${W}&element=${M}`, `/?map=${M}`, 'https://evil.example/', '//evil.example/', `/?world=${W}&map=x`, 'javascript:alert(1)', 42, null]) expect(resumeOf(bad)).toBeNull();
    expect(resumeFrom('/', `?world=${W}&map=${M}&at=1,2,3`)).toBe(`/?world=${W}&map=${M}`);
    expect(resumeFrom('/', `?world=${W}&type=location&element=${M}`)).toBe(`/?world=${W}`);
    expect(resumeFrom('/', '?world=nope')).toBe('/');
    expect(resumeFrom('/signin/callback', `?world=${W}`)).toBe('/');
  });

  it('on Cancel, says so, sends nothing, and leaves no record or stamp', async () => {
    const store = recordingStore();
    const url = await begin(store);
    const { f, seen } = tokenAnswer();
    const out = await startSignInCallback(`${SIGN_IN_REDIRECT_URI}?error=access_denied&state=${url.searchParams.get('state')}`, { store, fetchImpl: f });
    expect(out).toMatchObject({ ok: false, cancelled: true });
    expect(signInCallbackLine(out as { cancelled: boolean; error: unknown })).toBe('Sign-in cancelled: nothing changed.');
    expect(seen).toHaveLength(0);
    expect(store.map.size).toBe(0);
  });

  it('a return with no record waiting is a page revisited (Back into keel): nothing sent, no talk of another tab', async () => {
    const store = recordingStore();
    const { f, seen } = tokenAnswer();
    const out = await startSignInCallback(`${SIGN_IN_REDIRECT_URI}?code=abc&state=xyz`, { store, fetchImpl: f });
    expect(out.ok).toBe(false);
    expect(seen).toHaveLength(0);
    expect(signInCallbackLine(out as { cancelled: boolean; error: unknown })).toBe(ALREADY_USED_LINE);
  });

  it('a refused exchange is said in the mapper’s words, never keel’s, and the record goes', async () => {
    const store = recordingStore();
    const url = await begin(store);
    const { f } = tokenAnswer({ error: { code: 'invalid_grant', message: 'KEEL TEXT' } }, 400);
    const out = await startSignInCallback(`${SIGN_IN_REDIRECT_URI}?code=abc&state=${url.searchParams.get('state')}`, { store, fetchImpl: f });
    const line = signInCallbackLine(out as { cancelled: boolean; error: unknown });
    expect(line).toContain('did not take that sign-in');
    expect(line).not.toContain('KEEL');
    expect(store.map.size).toBe(0);
  });

  it('sweeps a record nobody came back for: none with no stamp, none older than an hour, a fresh one kept', () => {
    const now = 10 * STALE_RECORD_MS;
    const s1 = recordingStore();
    s1.map.set(SIGN_IN_RECORD_KEY, '{}');
    sweepStaleRecord(s1, now);
    expect(s1.map.size).toBe(0);
    const s2 = recordingStore();
    s2.map.set(SIGN_IN_RECORD_KEY, '{}');
    s2.map.set(STAMP_KEY, String(now - STALE_RECORD_MS - 1));
    sweepStaleRecord(s2, now);
    expect(s2.map.size).toBe(0);
    const s3 = recordingStore();
    s3.map.set(SIGN_IN_RECORD_KEY, '{}');
    s3.map.set(STAMP_KEY, String(now - 1000));
    sweepStaleRecord(s3, now);
    expect(s3.map.size).toBe(2);
    const s4 = recordingStore();
    s4.map.set(STAMP_KEY, String(now));
    sweepStaleRecord(s4, now);
    expect(s4.map.size).toBe(0);
  });
});

describe('the revoke', () => {
  const s = { token: TOKEN, tokenId: 'tok-1', username: 'wren', expiresAt: null };

  it('deletes the token by its id with itself as the bearer, keepalive, and once more without on refusal', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    let n = 0;
    const f = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      if (n++ === 0) throw new TypeError('keepalive refused');
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    expect(await revokeToken(s, { fetchImpl: f })).toBe('revoked');
    expect(sent.map((x) => [x.url, x.init.method, x.init.keepalive, (x.init.headers as Record<string, string>).Authorization])).toEqual([
      ['https://www.onlyworlds.com/api/v2/account/tokens/tok-1', 'DELETE', true, `Bearer ${TOKEN}`],
      ['https://www.onlyworlds.com/api/v2/account/tokens/tok-1', 'DELETE', false, `Bearer ${TOKEN}`],
    ]);
  });

  it('counts a 401 as removed and anything else as unconfirmed', async () => {
    const answer = (status: number) => (async () => new Response(null, { status })) as unknown as typeof fetch;
    expect(await revokeToken(s, { fetchImpl: answer(401) })).toBe('revoked');
    expect(await revokeToken(s, { fetchImpl: answer(404) })).toBe('unconfirmed');
    expect(await revokeToken(s, { fetchImpl: answer(503) })).toBe('unconfirmed');
    expect(await revokeToken({ ...s, tokenId: null }, { fetchImpl: answer(204) })).toBe('no-id');
  });
});
