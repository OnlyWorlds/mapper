// Sign in with OnlyWorlds, as the other OnlyWorlds tools do it: the SDK's `signInWithOnlyWorlds`
// sends the browser to onlyworlds.com with a PKCE challenge, and `completeSignIn` trades the code on
// /signin/callback. Only the round trip's record is stored (in localStorage, with a stamp beside it),
// only across the redirect, and it is removed at the return whatever the outcome. The token lives in
// the page's memory and nowhere else.
import { OwSignInError, OwV2Client } from '@onlyworlds/sdk';
import { BASE_URL } from '../net/api';

/** keel's registry lists the mapper's client under this id with exactly this return address. */
export const SIGN_IN_CLIENT_ID = 'maps';
export const SIGN_IN_REDIRECT_URI = 'https://maps.onlyworlds.com/signin/callback';
export const SIGN_IN_CALLBACK_PATH = '/signin/callback';
const SIGN_IN_ORIGIN = new URL(SIGN_IN_REDIRECT_URI).origin;
export const CLIENT_NAME = 'mapper';
/** The exchange's time limit, its answer's body included. */
export const SIGN_IN_EXCHANGE_LIMIT_MS = 20_000;
/** The SDK's record (`ow_signin:` and the client id), and the press time kept beside it. */
export const SIGN_IN_RECORD_KEY = `ow_signin:${SIGN_IN_CLIENT_ID}`;
export const STAMP_KEY = 'mapper.signin.at';
/**
 * A record older than this, or one with no stamp, is a round trip nobody came back from (they left
 * at the consent page). An hour, since a sign-up that waits on a confirmation mail comes back in
 * another tab, later. Never applied on the callback, where the SDK consumes the record.
 */
export const STALE_RECORD_MS = 60 * 60 * 1000;

/** Offered only on the registered origin: anywhere else the return lands on another origin's storage. */
export function canSignIn(origin: string = globalThis.location?.origin ?? ''): boolean {
  return origin === SIGN_IN_ORIGIN;
}

export function isSignInCallback(pathname: string = globalThis.location?.pathname ?? ''): boolean {
  return pathname.replace(/\/$/, '') === SIGN_IN_CALLBACK_PATH;
}

export type RecordStore = { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void };

/** The record lives in localStorage: the round trip leaves the tab through another origin. */
export function recordStore(): RecordStore | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    return { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v), remove: (k) => ls.removeItem(k) };
  } catch {
    return null;
  }
}

/** Every key of the round trip gone: the SDK's record and the stamp. */
export function dropSignInRecord(store: RecordStore | null = recordStore()): void {
  try {
    store?.remove(SIGN_IN_RECORD_KEY);
    store?.remove(STAMP_KEY);
  } catch {
    /* no storage, no record */
  }
}

/** On a load that is not the callback: a record nobody came back for is dropped. */
export function sweepStaleRecord(store: RecordStore | null = recordStore(), now: number = Date.now()): void {
  if (!store) return;
  try {
    if (store.get(SIGN_IN_RECORD_KEY) === null) {
      store.remove(STAMP_KEY);
      return;
    }
    const at = Number(store.get(STAMP_KEY));
    if (!Number.isFinite(at) || at <= 0 || now - at > STALE_RECORD_MS || at > now + 60_000) dropSignInRecord(store);
  } catch {
    /* no storage, no record */
  }
}

const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RESUME = new RegExp(`^/(\\?world=${ID}(&map=${ID})?)?$`, 'i');

/** Only the mapper's own addresses come back from a round trip: the home, a world, a map in a world. */
export function resumeOf(raw: unknown): string | null {
  return typeof raw === 'string' && RESUME.test(raw) ? raw : null;
}

/** The address a sign-in started here should come back to, from the page's own path and query. */
export function resumeFrom(pathname: string, search: string): string {
  const q = new URLSearchParams(search);
  const world = q.get('world');
  const map = q.get('map');
  const want = pathname === '/' && world ? `/?world=${world}${map ? `&map=${map}` : ''}` : '/';
  return resumeOf(want) ?? '/';
}

export const NEEDS_CONNECTION_LINE = 'Signing in needs a connection. Check yours and try again.';
export const NO_STORAGE_LINE = 'This browser keeps no storage for the mapper, so the sign-in could not come back here. Open the mapper in a normal window and try again.';

/**
 * Send the browser to onlyworlds.com, replacing this page's entry: with consent already given,
 * keel answers at once, so Back from the signed-in page leaves the mapper instead of bouncing
 * through keel. Throws, in the mapper's words, when it cannot leave.
 */
export async function beginSignIn(resume: string | null, opts: { navigate?: (url: string) => void; store?: RecordStore | null; now?: number } = {}): Promise<void> {
  if (globalThis.navigator?.onLine === false) throw new Error(NEEDS_CONNECTION_LINE);
  const storage = opts.store === undefined ? recordStore() : opts.store;
  if (!storage) throw new Error(NO_STORAGE_LINE);
  try {
    // The stamp goes first, so a record never exists without one.
    storage.set(STAMP_KEY, String(opts.now ?? Date.now()));
  } catch {
    throw new Error(NO_STORAGE_LINE);
  }
  await new OwV2Client({ baseUrl: BASE_URL, client: CLIENT_NAME }).signInWithOnlyWorlds({
    clientId: SIGN_IN_CLIENT_ID,
    redirectUri: SIGN_IN_REDIRECT_URI,
    // Maps only reads a world, so the token it is given can read and nothing more:
    // every write it could make is refused, revoking itself aside.
    scope: 'world:read',
    storage,
    resume: resumeOf(resume),
    navigate: opts.navigate ?? ((url) => globalThis.location.replace(url)),
  });
}

export type SignInOutcome =
  | { ok: true; token: string; tokenId: string | null; username: string; expiresAt: string | null; resume: string | null }
  | { ok: false; cancelled: boolean; error: unknown };

class NoStorage extends Error {}
/** A return with no round trip waiting here: a page revisited (Back into keel), not a refusal. */
export class AlreadyUsed extends Error {}
export const ALREADY_USED_LINE = 'That sign-in is no longer waiting here: it was used, or a newer one took its place. Press Sign in with OnlyWorlds to sign in again.';

/**
 * On /signin/callback, at module load, before any other request to OnlyWorlds: the code and state
 * are read from `href`, and the address is replaced by `/` before this returns, so Back never
 * returns to the callback, a reload never replays the code, and the router never reads it. The
 * record and its stamp go on every return, whatever the outcome.
 */
export function startSignInCallback(href: string = location.href, opts: { fetchImpl?: typeof fetch; store?: RecordStore | null } = {}): Promise<SignInOutcome> {
  const cancelled = new URL(href).searchParams.get('error') === 'access_denied';
  const storage = opts.store === undefined ? recordStore() : opts.store;
  // Whether a round trip is waiting at all: with none, this is a return already used (Back into
  // keel's authorize page sends a fresh code to a record long consumed), not another tab's.
  let waiting = false;
  try {
    waiting = (storage?.get(SIGN_IN_RECORD_KEY) ?? null) !== null;
  } catch {
    /* no storage: NoStorage below */
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SIGN_IN_EXCHANGE_LIMIT_MS);
  const limited: typeof fetch = (input, init) => (opts.fetchImpl ?? fetch)(input, { ...init, credentials: 'omit', signal: ctl.signal });
  const client = new OwV2Client({ baseUrl: BASE_URL, client: CLIENT_NAME, fetch: limited });
  const pending = (storage ? client.completeSignIn({ clientId: SIGN_IN_CLIENT_ID, url: href, storage }) : Promise.reject(new NoStorage('no storage'))).finally(() => {
    clearTimeout(timer);
    dropSignInRecord(storage);
  });
  try {
    globalThis.history?.replaceState(null, '', '/');
  } catch {
    /* the address stays; the router waits for the outcome anyway */
  }
  return pending.then(
    (r): SignInOutcome => ({ ok: true, token: r.token, tokenId: r.tokenId, username: r.account.username, expiresAt: r.expiresAt ?? null, resume: resumeOf(r.resume) }),
    (error: unknown): SignInOutcome => ({
      ok: false,
      cancelled,
      error: storage && !waiting && !cancelled && error instanceof OwSignInError && error.reason === 'state_mismatch' ? new AlreadyUsed('no record waiting') : error,
    }),
  );
}

/** What to tell the person when the round trip did not sign them in. Never keel's text. */
export function signInCallbackLine(outcome: { cancelled: boolean; error: unknown }): string {
  if (outcome.cancelled) return 'Sign-in cancelled: nothing changed.';
  const err = outcome.error;
  if (err instanceof NoStorage) return NO_STORAGE_LINE;
  if (err instanceof AlreadyUsed) return ALREADY_USED_LINE;
  if (err instanceof OwSignInError) {
    switch (err.reason) {
      case 'state_mismatch':
        return 'The mapper could not match that sign-in to one waiting here (another tab may have started one). Press Sign in with OnlyWorlds again.';
      case 'invalid_grant':
        return 'OnlyWorlds did not take that sign-in: it may have waited too long. Press Sign in with OnlyWorlds again.';
      case 'rate_limited':
        return 'Too many sign-ins from this network in a short time: OnlyWorlds counts every sign-in from one address together. Try again in a few minutes.';
      case 'offline':
        return 'OnlyWorlds could not be reached, so the sign-in did not finish. Check your connection and try again.';
      default:
        break;
    }
  }
  return 'Signing in with OnlyWorlds did not work. Try again in a moment.';
}
