// The hold: the last picture's points, kept on this device so the next press keeps it still. Per
// world, reader rung and who reads (the account's login, a pasted key's short hash, or the public),
// in the answer's own frame, rounded to whole units. Pure: the storage is a backend handed in
// (IndexedDB in the page, net/holds.ts; a plain one in the tests). A hold that cannot be read, or
// whose value is not one this page wrote, is none.
import type { ReaderRung } from './scene';

/** At most this many holds on a device, the least recently written dropped first. */
export const HOLD_BUDGET = 4;

/** What one hold stores: a version, its key, when it was written, and the points by id. */
export interface HoldValue {
  v: 1;
  key: string;
  at: number;
  ids: string[];
  /** x, y, z of `ids[i]` at `3 * i`: whole numbers in the answer's frame. */
  xyz: Float64Array;
}

/** The storage the hold is kept in. Each call may throw (no storage, refused, full). */
export interface HoldBackend {
  get(key: string): Promise<unknown>;
  /** Writes the value and its time together. */
  put(key: string, value: HoldValue): Promise<void>;
  /** Every hold's key and when it was written. */
  list(): Promise<{ key: string; at: number }[]>;
  delete(key: string): Promise<void>;
}

/** Who reads, for the key: the public, an account by its login, a pasted key by its hash's start. */
export type Who = { reader: 'public' } | { reader: 'account'; login: string } | { reader: 'key'; hash12: string };

export function holdKey(world: string, rung: ReaderRung, who: Who): string {
  const w = who.reader === 'public' ? 'public' : who.reader === 'account' ? `account:${who.login}` : `key:${who.hash12}`;
  return `${world}|${rung}|${w}`;
}

/** A key's reader part is the public's: kept across a sign-out. */
export function isPublicKey(key: string): boolean {
  return key.endsWith('|public|public');
}

/** The first 12 hex of the SHA-256 of a pasted key: two keys never share a hold, and the key is never stored. */
export async function keyHash12(key: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(d)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function encodeHold(key: string, ids: readonly string[], rounded: ArrayLike<number>, at: number): HoldValue {
  return { v: 1, key, at, ids: [...ids], xyz: Float64Array.from(rounded) };
}

/**
 * A stored value read back as the hold for `key`: a Map from id to its point (never an object keyed
 * by ids), or null for a value this page did not write for this key (corrupt, foreign, another key's).
 */
export function decodeHold(raw: unknown, key: string): Map<string, Float64Array> | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<HoldValue>;
  if (v.v !== 1 || v.key !== key || !Array.isArray(v.ids) || !(v.xyz instanceof Float64Array)) return null;
  const { ids, xyz } = v;
  if (xyz.length !== ids.length * 3) return null;
  const out = new Map<string, Float64Array>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (typeof id !== 'string' || id === '' || out.has(id)) return null;
    const p = xyz.subarray(3 * i, 3 * i + 3);
    if (!p.every((n) => Number.isInteger(n))) return null;
    out.set(id, p);
  }
  return out;
}

/** The hold as it crosses to the worker: ids and one array (transferred), never a Map of thousands. */
export function flatHold(held: ReadonlyMap<string, ArrayLike<number>>): { ids: string[]; xyz: Float64Array } {
  const ids = [...held.keys()];
  const xyz = new Float64Array(ids.length * 3);
  ids.forEach((id, i) => xyz.set(held.get(id)!, 3 * i));
  return { ids, xyz };
}

export function unflatHold(flat: { ids: readonly string[]; xyz: Float64Array }): Map<string, Float64Array> {
  const m = new Map<string, Float64Array>();
  flat.ids.forEach((id, i) => m.set(id, flat.xyz.subarray(3 * i, 3 * i + 3)));
  return m;
}

/** What reading a hold found: one, none, or something that could not be read (said in one line). */
export type HoldRead = { state: 'held'; held: Map<string, Float64Array> } | { state: 'none' } | { state: 'lost' } | { state: 'no-store' };

export async function readHold(open: () => Promise<HoldBackend>, key: string): Promise<HoldRead> {
  let b: HoldBackend;
  try {
    b = await open();
  } catch {
    return { state: 'no-store' };
  }
  let raw: unknown;
  try {
    raw = await b.get(key);
  } catch {
    return { state: 'lost' };
  }
  if (raw === undefined || raw === null) return { state: 'none' };
  const held = decodeHold(raw, key);
  return held ? { state: 'held', held } : { state: 'lost' };
}

/**
 * Keep a hold, then drop the least recently written past the budget (never the one just written).
 * False when it could not be kept (no storage, refused, full): the picture stays, and one line says so.
 */
export async function keepHold(open: () => Promise<HoldBackend>, value: HoldValue): Promise<boolean> {
  let b: HoldBackend;
  try {
    b = await open();
    await b.put(value.key, value);
  } catch {
    return false;
  }
  try {
    const all = await b.list();
    const old = all.filter((h) => h.key !== value.key).sort((x, y) => x.at - y.at);
    const over = all.length - HOLD_BUDGET;
    for (const h of old.slice(0, Math.max(0, over))) await b.delete(h.key);
  } catch {
    /* kept; the budget is tried again at the next write */
  }
  return true;
}

/** Sign-out: every hold that is not the public's is dropped (they name what an account or key read). */
export async function dropNonPublic(open: () => Promise<HoldBackend>): Promise<number> {
  try {
    const b = await open();
    const all = await b.list();
    let n = 0;
    for (const h of all) {
      if (isPublicKey(h.key)) continue;
      await b.delete(h.key);
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}
