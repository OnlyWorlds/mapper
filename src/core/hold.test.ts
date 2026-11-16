import { describe, expect, it } from 'vitest';
import { decodeHold, dropNonPublic, encodeHold, flatHold, HOLD_BUDGET, holdKey, isPublicKey, keepHold, keyHash12, readHold, unflatHold, type HoldBackend, type HoldValue } from './hold';

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

  it('sign-out drops every hold that is not the public one', async () => {
    const b = memory();
    const pub = holdKey(W, 'public', { reader: 'public' });
    const own = holdKey(W, 'owner', { reader: 'account', login: 'ana' });
    const guest = holdKey(W, 'guest', { reader: 'key', hash12: '0123456789ab' });
    for (const k of [pub, own, guest]) await keepHold(async () => b, encodeHold(k, ['a'], [1, 2, 3], 1));
    expect(await dropNonPublic(async () => b)).toBe(2);
    expect([...b.rows.keys()]).toEqual([pub]);
    expect(await dropNonPublic(async () => Promise.reject(new Error('x')))).toBe(0);
  });

  it('a delete that fails never keeps the others: one try per key', async () => {
    const b = memory();
    const keys = [holdKey(W, 'owner', { reader: 'account', login: 'a' }), holdKey(W, 'owner', { reader: 'account', login: 'b' }), holdKey(W, 'guest', { reader: 'key', hash12: '0123456789ab' })];
    for (const k of keys) await keepHold(async () => b, encodeHold(k, ['a'], [1, 2, 3], 1));
    const real = b.delete;
    let tries = 0;
    b.delete = async (k) => {
      tries++;
      if (k === keys[0]) throw new Error('refused');
      return real(k);
    };
    expect(await dropNonPublic(async () => b)).toBe(2);
    expect(tries).toBe(3);
    expect([...b.rows.keys()]).toEqual([keys[0]]);
  });

  it('a public key is the public rung and the public reader, part by part', () => {
    expect(isPublicKey(`${W}|public|public`)).toBe(true);
    expect(isPublicKey(`${W}|guest|public`)).toBe(false);
    expect(isPublicKey(`${W}|owner|account:x|public|public`)).toBe(false);
    expect(isPublicKey(`${W}|owner|account:public`)).toBe(false);
    expect(isPublicKey('public|public')).toBe(false);
  });
});
