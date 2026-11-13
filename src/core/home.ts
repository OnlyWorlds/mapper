// The home's pure part: which of a world's maps its row shows, in what order, and what a world on
// the account's list is to the person. No pictures in this version: a card is the map's name, its
// kind in words and a small mark for the kind.
import { simpleCaseFold, type OwAccountWorld } from '@onlyworlds/sdk';
import { readMap, type MapKind } from './kinds';
import { byName, isId, linkId, whole } from './rows';
import type { Row } from './types';
import type { ReaderRung } from './scene';

/** At most this many map cards on a world's row; then one "All N maps" card. */
export const HOME_CARDS = 6;

export interface MapCard {
  id: string;
  name: string;
  kind: MapKind;
  /** The kind in words, as the maps page says it. */
  words: string;
}

export interface HomeRow {
  cards: MapCard[];
  /** Every map the reader can see in the world. */
  total: number;
}

/**
 * The home's order of a world's maps: the top maps first (no `parent_map`, or one that names a Map
 * this reader is not served), then by `hierarchy` (a whole number, smaller first; none last), then
 * by name, then by id.
 */
export function homeOrder(maps: readonly Row[]): Row[] {
  const ids = new Set(maps.map((m) => m.id));
  const top = (m: Row) => {
    const p = linkId(m.parent_map);
    return !p || !ids.has(p) ? 0 : 1;
  };
  const tier = (m: Row) => whole(m.hierarchy) ?? Number.POSITIVE_INFINITY;
  const name = (m: Row) => (typeof m.name === 'string' ? m.name : '');
  return [...maps].sort((a, b) => top(a) - top(b) || tier(a) - tier(b) || byName(name(a), name(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A world's row: its first HOME_CARDS maps in the home's order, each named and worded by its kind. */
export function homeRow(maps: readonly Row[], limit = HOME_CARDS): HomeRow {
  const served = maps.filter((m) => m && isId(m.id));
  const cards = homeOrder(served)
    .slice(0, limit)
    .map((m) => {
      const r = readMap(m, served);
      return { id: r.id, name: r.name, kind: r.kind, words: r.words };
    });
  return { cards, total: served.length };
}

/** The role in words, as a world's row says it. */
export function roleWords(w: Pick<OwAccountWorld, 'role' | 'member_role'>): string {
  if (w.role === 'owner') return 'yours';
  const r = typeof w.member_role === 'string' ? w.member_role.replace(/_/g, '-') : '';
  return r ? `a member (${r})` : 'a member';
}

/**
 * How a world on the account's list is read: the owner reads the whole world, a member reads what
 * the server serves the member (the guest rung over the served bodies, as a pasted key's reading).
 * Never asked of `/me`, which an account token cannot call.
 */
export function rungOf(w: Pick<OwAccountWorld, 'role'>): ReaderRung {
  return w.role === 'owner' ? 'owner' : 'guest';
}

/** Owned, then joined; each A to Z by the folded name, then the id. */
export function accountOrder<T extends Pick<OwAccountWorld, 'id' | 'name' | 'role'>>(worlds: readonly T[]): T[] {
  const key = (w: T) => simpleCaseFold(w.name ?? '');
  const rank = (w: T) => (w.role === 'owner' ? 0 : 1);
  return [...worlds].sort((a, b) => rank(a) - rank(b) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
