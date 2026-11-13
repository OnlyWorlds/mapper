import { describe, expect, it } from 'vitest';
import { Api, asFailure, failureWords, ReadFailure } from './api';

const W = '0695db52-5433-7332-8000-db7fe10da375';
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('reads', () => {
  it('waits out a 429 by its reset, says so, and reads again', async () => {
    const waits: number[] = [];
    let n = 0;
    const fetch = (async () => {
      n++;
      if (n === 1) return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'slow down' } }), { status: 429, headers: { 'RateLimit-Reset': '1', 'content-type': 'application/json' } });
      return ok({ id: W, name: 'Moppetopia' });
    }) as typeof globalThis.fetch;
    const api = new Api({ world: W, key: null, fetch, onWait: (s) => waits.push(s) });
    const meta = await api.world();
    expect(meta.name).toBe('Moppetopia');
    expect(waits).toEqual([1, 0]);
    expect(api.calls).toBe(2);
  });

  it('gives every request its own time limit, and says it timed out', async () => {
    const fetch = ((_u: unknown, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)))) as typeof globalThis.fetch;
    const api = new Api({ world: W, key: null, fetch, timeoutMs: 50 });
    const err = await api.world().catch((e) => e);
    expect(err).toBeInstanceOf(ReadFailure);
    expect((err as ReadFailure).kind).toBe('timeout');
  });

  it('runs one request at a time', async () => {
    let open = 0;
    let most = 0;
    const fetch = (async () => {
      open++;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 10));
      open--;
      return ok({ data: [], has_more: false, next_cursor: null });
    }) as typeof globalThis.fetch;
    const api = new Api({ world: W, key: null, fetch });
    await Promise.all([api.all('pin', undefined), api.all('marker', undefined), api.byIds('zone', ['a'])]);
    expect(most).toBe(1);
  });

  it('says a 404 as not found, and splits ids in calls of 200', async () => {
    const urls: string[] = [];
    const fetch = (async (u: unknown) => {
      urls.push(String(u));
      if (String(u).includes('/world/')) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'World not found.' } }), { status: 404, headers: { 'content-type': 'application/json' } });
      return ok({ data: [], has_more: false, next_cursor: null });
    }) as typeof globalThis.fetch;
    const api = new Api({ world: W, key: null, fetch });
    const err = await api.world().catch((e) => e);
    expect((err as ReadFailure).kind).toBe('not-found');
    await api.byIds('location', Array.from({ length: 450 }, (_, i) => `id${i}`));
    expect(urls.filter((u) => u.includes('/location/'))).toHaveLength(3);
  });

  it('holds the time limit over the body: a body that stalls after its headers ends in a timeout, and the next read runs', async () => {
    let n = 0;
    const fetch = ((_u: unknown, init?: RequestInit) => {
      n++;
      if (n > 1) return Promise.resolve(ok({ id: W, name: 'Moppetopia' }));
      // Headers at once; the body sends a little and then waits, until an abort errors it.
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"data":['));
          init?.signal?.addEventListener('abort', () => c.error(init.signal!.reason));
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
    }) as typeof globalThis.fetch;
    const api = new Api({ world: W, key: null, fetch, timeoutMs: 80 });
    const first = api.all('map', undefined).catch((e) => e);
    const second = api.world();
    const err = await first;
    expect(err).toBeInstanceOf(ReadFailure);
    expect((err as ReadFailure).kind).toBe('timeout');
    expect((await second).name).toBe('Moppetopia');
  });

  it('starts no queued read once its signal aborts, and stops the one in flight', async () => {
    const urls: string[] = [];
    const fetch = ((u: unknown, init?: RequestInit) => {
      urls.push(String(u));
      return new Promise((res, rej) => {
        const t = setTimeout(() => res(ok({ data: [], has_more: false, next_cursor: null })), 30);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          rej(init.signal!.reason);
        });
      });
    }) as typeof globalThis.fetch;
    const api = new Api({ world: W, key: null, fetch });
    const leave = new AbortController();
    const reads = [api.all('pin', undefined, undefined, undefined, leave.signal), api.all('marker', undefined, undefined, undefined, leave.signal), api.byIds('zone', ['a', 'b'], undefined, leave.signal)].map((p) => p.catch((e) => e));
    await new Promise((r) => setTimeout(r, 5));
    leave.abort();
    const got = await Promise.all(reads);
    expect(got.every((e) => e instanceof ReadFailure && e.kind === 'stopped')).toBe(true);
    expect(urls).toHaveLength(1);
    // The next page's read is not held up behind them.
    const meta = api.world();
    await expect(meta).resolves.toBeDefined();
  });

  it('reads nothing after close, a request started after it included', async () => {
    let n = 0;
    const fetch = (async () => {
      n++;
      return ok({ id: W, name: 'Moppetopia' });
    }) as typeof globalThis.fetch;
    const api = new Api({ world: W, key: null, fetch });
    api.close();
    const err = await api.world().catch((e) => e);
    expect((err as ReadFailure).kind).toBe('stopped');
    expect(n).toBe(0);
  });

  it('never blames the connection for an error that is not the network', () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      const drawn = asFailure(new RangeError('Map maximum size exceeded'));
      expect(drawn.kind).toBe('page');
      expect(failureWords(drawn, 'elements')).not.toMatch(/connection/i);
      const garbled = asFailure(new SyntaxError('Unexpected end of JSON input'));
      expect(garbled.kind).toBe('unreadable');
      expect(failureWords(garbled, 'Pins')).not.toMatch(/connection/i);
    } finally {
      console.error = quiet;
    }
  });

  it('says a deleted element (410) as not there', async () => {
    const fetch = (async () => new Response(JSON.stringify({ error: { code: 'gone', message: 'Deleted.' } }), { status: 410, headers: { 'content-type': 'application/json' } })) as typeof globalThis.fetch;
    const api = new Api({ world: W, key: null, fetch });
    const err = await api.get('location', W).catch((e) => e);
    expect((err as ReadFailure).kind).toBe('not-found');
  });
});
