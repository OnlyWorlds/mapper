// Reads from OnlyWorlds through the SDK's client, one request at a time. Each request carries its
// own time limit (in the client's own fetch, so a walk of pages never shares one), and a 429 waits
// for the server's reset, says so, and reads again. Nothing here writes: the page only ever reads.
import { OwApiError, OwNetworkError, OwV2Client, type OwElement, type OwMe, type OwWorldMeta } from '@onlyworlds/sdk';
import type { Row } from '../core/types';

export const TIME_LIMIT_MS = 30_000;
export const BASE_URL = 'https://www.onlyworlds.com/api/v2';

class TimeLimitError extends Error {
  constructor(readonly ms: number) {
    super(`No answer within ${Math.round(ms / 1000)} s`);
  }
}

export type FailureKind = 'timeout' | 'network' | 'not-found' | 'refused' | 'server' | 'stopped';

export class ReadFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

/** The sentence a failed read is said with in place. */
export function failureWords(f: ReadFailure, what: string): string {
  switch (f.kind) {
    case 'timeout':
      return `The ${what} read did not finish in ${Math.round(TIME_LIMIT_MS / 1000)} s.`;
    case 'network':
      return `The ${what} read did not reach OnlyWorlds. Check the connection.`;
    case 'not-found':
      return `OnlyWorlds has no ${what} here for this reader.`;
    case 'refused':
      return `OnlyWorlds refused the ${what} read (${f.status}).`;
    case 'server':
      return `OnlyWorlds could not answer the ${what} read (${f.status}).`;
    case 'stopped':
      return `The ${what} read was stopped.`;
  }
}

export function asFailure(e: unknown): ReadFailure {
  if (e instanceof ReadFailure) return e;
  if (e instanceof OwApiError) {
    if (e.status === 404) return new ReadFailure('not-found', 404, e.message);
    if (e.status >= 500) return new ReadFailure('server', e.status, e.message);
    return new ReadFailure('refused', e.status, e.message);
  }
  if (e instanceof OwNetworkError) {
    const c = (e as OwNetworkError & { cause2?: unknown }).cause2;
    if (c instanceof TimeLimitError) return new ReadFailure('timeout', null, c.message);
    if (c instanceof DOMException && c.name === 'AbortError') return new ReadFailure('stopped', null, 'stopped');
    return new ReadFailure('network', null, e.message);
  }
  if (e instanceof TimeLimitError) return new ReadFailure('timeout', null, e.message);
  return new ReadFailure('network', null, e instanceof Error ? e.message : String(e));
}

export interface ApiOptions {
  /** The world, for a keyless read. */
  world: string | null;
  /** A pasted world key, held in this object only. */
  key: string | null;
  timeoutMs?: number;
  baseUrl?: string;
  /** Called while a 429 is waited out, with the seconds left (0 when reading again). */
  onWait?: (seconds: number) => void;
  fetch?: typeof globalThis.fetch;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      rej(new DOMException('stopped', 'AbortError'));
    }, { once: true });
  });

export class Api {
  readonly client: OwV2Client;
  private chain: Promise<unknown> = Promise.resolve();
  private stop = new AbortController();
  /** Requests sent, 429 retries included. */
  calls = 0;

  constructor(private o: ApiOptions) {
    const base = o.fetch ?? globalThis.fetch.bind(globalThis);
    const limit = o.timeoutMs ?? TIME_LIMIT_MS;
    const timed: typeof fetch = async (input, init) => {
      for (let attempt = 0; ; attempt++) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(new TimeLimitError(limit)), limit);
        const stopper = () => ctl.abort(new DOMException('stopped', 'AbortError'));
        this.stop.signal.addEventListener('abort', stopper, { once: true });
        init?.signal?.addEventListener('abort', stopper, { once: true });
        this.calls++;
        let res: Response;
        try {
          res = await base(input, { ...init, signal: ctl.signal });
        } catch (e) {
          throw ctl.signal.reason instanceof TimeLimitError ? ctl.signal.reason : e;
        } finally {
          clearTimeout(timer);
          this.stop.signal.removeEventListener('abort', stopper);
        }
        if (res.status !== 429 || attempt >= 3) return res;
        const reset = Number(res.headers.get('RateLimit-Reset') ?? res.headers.get('Retry-After') ?? '10');
        let left = Math.min(70, Math.max(1, Number.isFinite(reset) ? Math.ceil(reset) : 10));
        while (left > 0) {
          this.o.onWait?.(left);
          await sleep(1000, this.stop.signal);
          left--;
        }
        this.o.onWait?.(0);
      }
    };
    this.client = o.key
      ? new OwV2Client({ apiKey: o.key, pageSize: 1000, baseUrl: o.baseUrl ?? BASE_URL, fetch: timed, client: 'mapper' })
      : new OwV2Client({ world: o.world ?? undefined, pageSize: 1000, baseUrl: o.baseUrl ?? BASE_URL, fetch: timed, client: 'mapper' });
  }

  /** One request at a time: never a fan-out. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next.catch((e) => {
      throw asFailure(e);
    });
  }

  /** Stop every read this object runs; it reads nothing after. */
  close(): void {
    this.stop.abort();
  }

  world(): Promise<OwWorldMeta> {
    return this.run(() => this.client.getWorld());
  }

  me(): Promise<OwMe> {
    return this.run(() => this.client.me());
  }

  get(type: string, id: string): Promise<OwElement> {
    return this.run(() => this.client.get(type, id));
  }

  /** Every page of a list, each page its own request, `onPage` after each. */
  async all(type: string, filter: Record<string, string> | undefined, onPage?: (rows: Row[], page: number) => void, expand?: string[]): Promise<Row[]> {
    const rows: Row[] = [];
    let cursor: string | undefined;
    let page = 0;
    do {
      const p = await this.run(() => this.client.list(type, { limit: 1000, cursor, filter, expand }));
      const got = p.data as unknown as Row[];
      rows.push(...got);
      page++;
      onPage?.(got, page);
      cursor = p.has_more && p.next_cursor ? p.next_cursor : undefined;
    } while (cursor);
    return rows;
  }

  /** Bodies by id, in calls of at most 200 (one type a call). */
  async byIds(type: string, ids: readonly string[], onCall?: (rows: Row[]) => void): Promise<Row[]> {
    const out: Row[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200);
      const p = await this.run(() => this.client.list(type, { ids: part, limit: 1000 }));
      const got = p.data as unknown as Row[];
      out.push(...got);
      onCall?.(got);
    }
    return out;
  }
}
