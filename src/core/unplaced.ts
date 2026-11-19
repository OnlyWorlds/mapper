// What a saved `by-kind` layout map does not place (the default layouts page, `unplaced`): the
// count, its words and what it reads. Pure: the reads are the app's. The graph is `worldGraph`'s
// for this reader with no options, so it leaves out what that reader's graph leaves out (hidden,
// proposed and room elements, the reading aids); the words say "for you" and never "every element".
import { ELEMENT_TYPES, unplacedByKind, worldGraph, type OwLayoutGraph, type OwMapSpace } from '@onlyworlds/sdk';
import { readerFor, type ReaderRung } from './scene';
import type { Row } from './types';

/** The page: a tool that counts leaves Map, Pin and Marker out of its graph. A Zone stays. */
export const COUNT_TYPES: readonly string[] = ELEMENT_TYPES.filter((t) => t !== 'map' && t !== 'pin' && t !== 'marker');

/** Above this many served elements the mapper does not count (ten reads of a thousand rows). */
export const COUNT_CEILING = 10_000;

/** Only a Map laid out by `by-kind` is counted: an `around` Map's focus and steps are not in its mark. */
export function counted(layout: string | null): boolean {
  return layout === 'by-kind';
}

/** The ids the Map's Pins stand for: each `mapSpace` pin on this Map with an element. */
export function placedOn(mapId: string, pins: OwMapSpace['pins']): string[] {
  const out: string[] = [];
  for (const p of pins) if (p.map === mapId && typeof p.element_id === 'string' && p.element_id !== '') out.push(p.element_id);
  return out;
}

/**
 * The types to read and their served total, from keel's per-reader counts. A type keel counts as 0
 * is not read; with no counts served, every type is read and the total is unknown (null).
 */
export function countPlan(types: Record<string, unknown> | null | undefined): { types: string[]; total: number | null } {
  if (!types || typeof types !== 'object') return { types: [...COUNT_TYPES], total: null };
  const read: string[] = [];
  let total = 0;
  for (const t of COUNT_TYPES) {
    const n = types[t];
    if (typeof n === 'number' && Number.isFinite(n)) {
      if (n > 0) read.push(t);
      total += Math.max(0, n);
    } else read.push(t);
  }
  return { types: read, total };
}

/** The count over the rows read, each handed to `worldGraph` as a copy with its type. */
export function countUnplaced(rows: ReadonlyMap<string, readonly Row[]>, rung: ReaderRung, placed: readonly string[]): number {
  const elements: Row[] = [];
  for (const [type, list] of rows) for (const r of list) elements.push({ ...r, type });
  return unplacedCount(worldGraph({ elements }, readerFor(rung, elements)), placed);
}

/** The count over a graph already made: how many of what `by-kind` would place have no Pin here. */
export function unplacedCount(graph: OwLayoutGraph, placed: readonly string[]): number {
  return unplacedByKind(graph, placed).length;
}

export function unplacedWords(n: number): string {
  if (n === 0) return 'This map places every element this layout would draw for you.';
  const count = n.toLocaleString('en-US');
  return `Of the elements this layout would draw for you, ${count} ${n === 1 ? 'is' : 'are'} not placed on this map.`;
}

/** Above the ceiling: the served total is of the 19 types and this reader's, so the line names the ceiling, not a total. */
export function ceilingWords(): string {
  return `This world holds more than ${COUNT_CEILING.toLocaleString('en-US')} elements you can see, too many for the mapper to count what this map does not place.`;
}

export const COUNTING_WORDS = 'Counting what this map does not place.';
export const COUNT_FAILED_WORDS = 'What this map does not place could not be counted.';
export const COUNT_REFUSED_WORDS = 'What this map does not place could not be counted from what OnlyWorlds sent.';
