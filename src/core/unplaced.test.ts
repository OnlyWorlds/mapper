import { describe, expect, it } from 'vitest';
import { mapSpace } from '@onlyworlds/sdk';
import { ceilingWords, COUNT_TYPES, counted, countPlan, countUnplaced, placedOn, unplacedWords } from './unplaced';
import type { Row } from './types';

const M = '0199c3a1-0000-7000-8000-00000000000a';
const G = '0199c3a1-0000-7000-8000-00000000000b';
const id = (n: number) => `0199c3a1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const layoutMap = { id: M, type: 'map', name: 'Layout', width: 1000, height: 1000, x_layout: { method: 'by-kind' } };
const otherMap = { id: G, type: 'map', name: 'Ground', width: 1000, height: 1000 };
const pin = (n: number, el: number | null, map = M, x: unknown = 10, type = 'character') =>
  ({ id: id(900 + n), type: 'pin', map, x, y: 20, ...(el === null ? {} : { element_type: type, element_id: id(el) }) });

describe('which Maps are counted', () => {
  it('only a by-kind layout', () => {
    expect(counted('by-kind')).toBe(true);
    for (const w of ['around', 'hand', 'test', 'By-kind', '', null]) expect(counted(w as string | null)).toBe(false);
  });
});

describe('the types read', () => {
  it('leaves out Map, Pin and Marker and keeps Zone: 19 types', () => {
    expect(COUNT_TYPES).toHaveLength(19);
    expect(COUNT_TYPES).not.toContain('map');
    expect(COUNT_TYPES).not.toContain('pin');
    expect(COUNT_TYPES).not.toContain('marker');
    expect(COUNT_TYPES).toContain('zone');
  });
  it('skips a type keel counts as 0 and totals the rest', () => {
    const p = countPlan({ character: 3, location: 0, zone: 2, map: 40, pin: 900 });
    expect(p.types).toContain('character');
    expect(p.types).toContain('zone');
    expect(p.types).not.toContain('location');
    expect(p.types).not.toContain('map');
    expect(p.total).toBe(5);
  });
  it('reads every type, total unknown, when keel serves no counts', () => {
    expect(countPlan(undefined)).toEqual({ types: [...COUNT_TYPES], total: null });
    expect(countPlan(null).types).toHaveLength(19);
  });
});

describe('placed: the elements this Map\'s Pins stand for, from mapSpace', () => {
  it('this Map only; a Pin with no whole x or no element places nothing', () => {
    const ms = mapSpace([layoutMap, otherMap, pin(1, 1), pin(2, 2, G), pin(3, 3, M, 'ten'), pin(4, null)] as never);
    expect(placedOn(M, ms.pins)).toEqual([id(1)]);
  });
  it('a Pin with an element_id and no element_type places nothing (mapSpace reads both or neither)', () => {
    const half = { ...pin(5, 5), element_type: undefined };
    const ms = mapSpace([layoutMap, half] as never);
    expect(placedOn(M, ms.pins)).toEqual([]);
  });
});

describe('the count over this reader\'s graph', () => {
  const rows = new Map<string, Row[]>([
    ['character', [{ id: id(1), name: 'A' }, { id: id(2), name: 'B' }, { id: id(3), name: 'C', hidden: true }] as Row[]],
    ['zone', [{ id: id(4), name: 'Z' }] as Row[]],
  ]);
  it('counts what the graph holds and placed does not: a Zone counts, a hidden element does not', () => {
    expect(countUnplaced(rows, 'owner', [id(1)])).toBe(2);
    expect(countUnplaced(rows, 'owner', [id(1), id(2), id(4)])).toBe(0);
  });
  it('an id placed that is no node is no part of the answer', () => {
    expect(countUnplaced(rows, 'owner', [id(1), id(77)])).toBe(2);
  });
  it("a room element is out of the owner's graph, so out of the count", () => {
    const room = new Map<string, Row[]>([['narrative', [{ id: id(5), name: 'A line', supertype: 'Message', x_room_of: id(99) }, { id: id(6), name: 'A story' }] as Row[]]]);
    expect(countUnplaced(room, 'owner', [])).toBe(1);
  });
  it("a guest's known-of element is a node of the guest's graph, so it counts", () => {
    const g = new Map<string, Row[]>([['character', [{ id: id(7), name: 'Known' }, { id: id(8), name: 'Only known of', known_of: true }] as Row[]]]);
    expect(countUnplaced(g, 'guest', [id(7)])).toBe(1);
  });
  it('stamps the type on a copy, never on the row read', () => {
    countUnplaced(rows, 'owner', []);
    expect('type' in rows.get('character')![0]).toBe(false);
  });
});

describe('the words', () => {
  it('say for you, never every element of the world, never no Pin', () => {
    expect(unplacedWords(0)).toBe('This map places every element this layout would draw for you.');
    expect(unplacedWords(1)).toBe('Of the elements this layout would draw for you, 1 is not placed on this map.');
    expect(unplacedWords(1234)).toBe('Of the elements this layout would draw for you, 1,234 are not placed on this map.');
    expect(ceilingWords()).toBe('This world holds more than 10,000 elements you can see, too many for the mapper to count what this map does not place.');
    for (const s of [unplacedWords(0), unplacedWords(3), ceilingWords()]) {
      expect(s).not.toMatch(/—|no Pin|every element of this world/);
    }
  });
});
