import { describe, expect, it } from 'vitest';
import { decodeHold, encodeHold, flatHold, HOLD_BUDGET, holdKey, holdsFor, isPublicKey, keepHold, keyHash12, pageHolds, readHold, unflatHold, type HoldBackend, type HoldValue } from './hold';

const W = '0199c3a1-0000-7000-8000-00000000000a';

/** A plain backend in memory; `fail` makes one call throw as a refusing or full storage does. */
function memory(fail: Partial<Record<'get' | 'put' | 'list' | 'delete', unknown>> = {}) {
  const rows = new Map<string, HoldValue>();
  const b: HoldBackend & { rows: Map<string, HoldValue> } = {
    rows,
    async get(key) {
      if (fail.get) throw fail.get;
      return rows.get(key);
    },
    async put(key, value) {
      if (fail.put) throw fail.put;
      rows.set(key, structuredClone(value));
    },
    async list() {
      if (fail.list) throw fail.list;
      return [...rows].map(([key, v]) => ({ key, at: v.at }));
    },
    async delete(key) {
      if (fail.delete) throw fail.delete;
      rows.delete(key);
    },
  };
  return b;
}

describe('the hold key', () => {
  it('is the world, the rung and who reads', () => {
    expect(holdKey(W, 'public', { reader: 'public' })).toBe(`${W}|public|public`);
    expect(holdKey(W, 'owner', { reader: 'account', login: 'ana' })).toBe(`${W}|owner|account:ana`);
    expect(holdKey(W, 'guest', { reader: 'key', hash12: 'abcdef012345' })).toBe(`${W}|guest|key:abcdef012345`);
  });

  it('two keys never share a hold, and the key itself is never in it', async () => {
    const a = await keyHash12('ow_r_one');
    const b = await keyHash12('ow_r_two');
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(await keyHash12('ow_r_one')).toBe(a);
    expect(holdKey(W, 'guest', { reader: 'key', hash12: a })).not.toContain('ow_r_');
  });
});

describe('encode and decode', () => {
  const key = holdKey(W, 'public', { reader: 'public' });
  it('round trips to a Map from id to its point', () => {
    const v = encodeHold(key, ['a', 'b'], [1, -2, 3, 0, 0, 46080], 5);
    const back = decodeHold(structuredClone(v), key);
    expect(back).toBeInstanceOf(Map);
    expect([...back!.keys()]).toEqual(['a', 'b']);
    expect([...back!.get('b')!]).toEqual([0, 0, 46080]);
    // An id like __proto__ is only a key of the Map.
    const odd = decodeHold(encodeHold(key, ['__proto__'], [1, 2, 3], 0), key);
    expect([...odd!.get('__proto__')!]).toEqual([1, 2, 3]);
  });

  it('reads a corrupt, foreign or other key value as none', () => {
    const good = encodeHold(key, ['a'], [1, 2, 3], 0);
    expect(decodeHold(good, `${W}|owner|account:ana`)).toBeNull();
    for (const bad of [
      null, undefined, 'x', 42, [], {},
      { ...good, v: 2 },
      { ...good, ids: 'a' },
      { ...good, xyz: [1, 2, 3] },
      { ...good, xyz: new Float64Array([1, 2]) },
      { ...good, xyz: new Float64Array([1.5, 2, 3]) },
      { ...good, xyz: new Float64Array([Number.NaN, 2, 3]) },
      { ...good, ids: [''] },
      { ...good, ids: [7] },
      { ...good, ids: ['a', 'a'], xyz: new Float64Array(6) },
    ]) expect(decodeHold(bad, key)).toBeNull();
  });

  it('crosses to the worker flat and back', () => {
    const m = new Map([['a', new Float64Array([1, 2, 3])], ['b', new Float64Array([4, 5, 6])]]);
    const f = flatHold(m);
    expect(f.ids).toEqual(['a', 'b']);
    expect([...f.xyz]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...unflatHold(f).get('b')!]).toEqual([4, 5, 6]);
  });
});

describe('keeping and reading', () => {
  const key = (n: number) => holdKey(`${W.slice(0, -1)}${n}`, 'public', { reader: 'public' });
  it('reads what it kept; none when there is none', async () => {
    const b = memory();
    expect(await readHold(async () => b, key(1))).toEqual({ state: 'none' });
    expect(await keepHold(async () => b, encodeHold(key(1), ['a'], [1, 2, 3], 1))).toBe(true);
    const r = await readHold(async () => b, key(1));
    expect(r.state).toBe('held');
  });

  it('a value it cannot use, a read that throws, or no storage is said, never thrown', async () => {
    const b = memory();
    b.rows.set(key(1), { v: 1, key: key(1), at: 0, ids: ['a'], xyz: new Float64Array([1]) });
    expect((await readHold(async () => b, key(1))).state).toBe('lost');
    expect((await readHold(async () => memory({ get: new DOMException('x', 'UnknownError') }), key(1))).state).toBe('lost');
    expect((await readHold(async () => Promise.reject(new Error('no storage')), key(1))).state).toBe('no-store');
  });

  it('a write the storage refuses (full) answers false', async () => {
    const full = memory({ put: new DOMException('full', 'QuotaExceededError') });
    expect(await keepHold(async () => full, encodeHold(key(1), ['a'], [1, 2, 3], 1))).toBe(false);
    expect(await keepHold(async () => Promise.reject(new Error('no storage')), encodeHold(key(1), ['a'], [1, 2, 3], 1))).toBe(false);
    // A budget step that fails after the write still kept it.
    expect(await keepHold(async () => memory({ list: new Error('x') }), encodeHold(key(1), ['a'], [1, 2, 3], 1))).toBe(true);
  });

  it(`keeps at most ${HOLD_BUDGET}, the least recently written dropped first`, async () => {
    const b = memory();
    for (let i = 1; i <= 6; i++) await keepHold(async () => b, encodeHold(key(i), ['a'], [i, 0, 0], i * 10));
    expect([...b.rows.keys()].sort()).toEqual([key(3), key(4), key(5), key(6)].sort());
    // Writing an old one again makes it the newest.
    await keepHold(async () => b, encodeHold(key(3), ['a'], [3, 0, 0], 100));
    await keepHold(async () => b, encodeHold(key(7), ['a'], [7, 0, 0], 110));
    expect([...b.rows.keys()].sort()).toEqual([key(3), key(5), key(6), key(7)].sort());
  });

  it('only the public hold goes to the device; an account’s or a key’s stays in the page’s memory', async () => {
    const device = memory();
    const page = pageHolds();
    const pub = holdKey(W, 'public', { reader: 'public' });
    const own = holdKey(W, 'owner', { reader: 'account', login: 'ana' });
    const guest = holdKey(W, 'guest', { reader: 'key', hash12: '0123456789ab' });
    for (const k of [pub, own, guest]) expect(await keepHold(holdsFor(k, async () => device, page), encodeHold(k, ['a'], [1, 2, 3], 1))).toBe(true);
    expect([...device.rows.keys()]).toEqual([pub]);
    for (const k of [own, guest]) expect((await readHold(holdsFor(k, async () => device, page), k)).state).toBe('held');
    // A sign-out clears the page's holds; the device's public one stays.
    page.clear();
    for (const k of [own, guest]) expect((await readHold(holdsFor(k, async () => device, page), k)).state).toBe('none');
    expect((await readHold(holdsFor(pub, async () => device, page), pub)).state).toBe('held');
    // A new page (a reload, another tab) starts with none of them.
    expect((await readHold(pageHolds().open, own)).state).toBe('none');
  });

  it('the page’s holds keep the same budget, the least recently written dropped first', async () => {
    const page = pageHolds();
    const key = (i: number) => holdKey(W, 'owner', { reader: 'account', login: `a${i}` });
    for (let i = 1; i <= HOLD_BUDGET + 2; i++) await keepHold(page.open, encodeHold(key(i), ['a'], [i, 0, 0], i * 10));
    const b = await page.open();
    expect((await b.list()).map((h) => h.key).sort()).toEqual([key(3), key(4), key(5), key(6)].sort());
  });

  it('a storage that never answers holds a read no longer than its wait, said as a hold that could not be read', async () => {
    const never = () => new Promise<HoldBackend>(() => {});
    const k = holdKey(W, 'public', { reader: 'public' });
    const t0 = Date.now();
    expect((await readHold(never, k, undefined, 50)).state).toBe('lost');
    expect(Date.now() - t0).toBeLessThan(1000);
    // An open that answers but a get that never does.
    const stuck: HoldBackend = { ...memory(), get: () => new Promise(() => {}) };
    expect((await readHold(async () => stuck, k, undefined, 50)).state).toBe('lost');
  });

  it('a Cancel ends a hold read at once', async () => {
    const never = () => new Promise<HoldBackend>(() => {});
    const k = holdKey(W, 'public', { reader: 'public' });
    const c = new AbortController();
    const read = readHold(never, k, c.signal, 60_000);
    setTimeout(() => c.abort(), 10);
    const t0 = Date.now();
    expect((await read).state).toBe('lost');
    expect(Date.now() - t0).toBeLessThan(1000);
    // Already stopped: answers at once.
    expect((await readHold(never, k, c.signal, 60_000)).state).toBe('lost');
  });

  it('a keep that never answers is not kept, within its wait', async () => {
    const k = holdKey(W, 'public', { reader: 'public' });
    const t0 = Date.now();
    expect(await keepHold(() => new Promise<HoldBackend>(() => {}), encodeHold(k, ['a'], [1, 2, 3], 1), 50)).toBe(false);
    const stuck: HoldBackend = { ...memory(), put: () => new Promise(() => {}) };
    expect(await keepHold(async () => stuck, encodeHold(k, ['a'], [1, 2, 3], 1), 50)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('a public key is the public rung and the public reader, part by part', () => {
    expect(isPublicKey(`${W}|public|public`)).toBe(true);
    expect(isPublicKey(`${W}|guest|public`)).toBe(false);
    expect(isPublicKey(`${W}|owner|account:x|public|public`)).toBe(false);
    expect(isPublicKey(`${W}|owner|account:public`)).toBe(false);
    expect(isPublicKey('public|public')).toBe(false);
  });
});
