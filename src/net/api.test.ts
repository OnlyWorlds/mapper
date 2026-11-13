import { describe, expect, it } from 'vitest';
import { Api, ReadFailure } from './api';

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
});
