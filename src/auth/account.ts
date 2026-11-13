// What a sign-in holds: one account token, in this page's memory only. The mapper never makes a
// key, never writes, and removes the token when it is done with it: on Sign out, when the page is
// left, and when a page comes back from the back/forward cache.
import { BASE_URL } from '../net/api';

export interface SignedIn {
  readonly token: string;
  /** The token's id, for its revoke; null from a keel that did not send one. */
  readonly tokenId: string | null;
  readonly username: string;
  /** When keel ends the token by itself (ISO 8601), or null. */
  readonly expiresAt: string | null;
}

export const REVOKE_LIMIT_MS = 8_000;

/**
 * `revoked`: keel took it back (2xx), or it works no more (401). `unconfirmed`: anything else, a 404,
 * a 5xx, no answer or a time-out, so it may still be live. `no-id`: nothing to send.
 */
export type RevokeOutcome = 'revoked' | 'unconfirmed' | 'no-id';

/**
 * `DELETE /account/tokens/{id}` with the token itself as the bearer, keepalive (so it can outlive a
 * page that is leaving) and a time limit. This is the one account call the mapper makes besides its
 * reads, and its answer is the only read-back: a token list would be a second call.
 */
export async function revokeToken(s: SignedIn, opts: { fetchImpl?: typeof fetch; limitMs?: number } = {}): Promise<RevokeOutcome> {
  if (!s.tokenId) return 'no-id';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.limitMs ?? REVOKE_LIMIT_MS);
  const send = (keepalive: boolean) =>
    (opts.fetchImpl ?? fetch)(`${BASE_URL}/account/tokens/${encodeURIComponent(s.tokenId!)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${s.token}` },
      credentials: 'omit',
      keepalive,
      signal: ctl.signal,
    });
  try {
    let res: Response;
    try {
      res = await send(true);
    } catch (err) {
      // A browser may refuse a keepalive request that needs a preflight: once more without it.
      if (ctl.signal.aborted) throw err;
      res = await send(false);
    }
    if (res.ok || res.status === 401) return 'revoked';
    return 'unconfirmed';
  } catch {
    return 'unconfirmed';
  } finally {
    clearTimeout(timer);
  }
}
