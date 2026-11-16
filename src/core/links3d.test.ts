import { describe, expect, it } from 'vitest';
import { BY_LINKS_3D_REST, layoutByLinks3d, layoutOf, mapSpace, worldGraph } from '@onlyworlds/sdk';
import { flatHold } from './hold';
import { readMap } from './kinds';
import { layOut, type Links3dInput } from './layout3d';
import {
  ceilingWords3d, CHANGE_LINE, EMPTY_LINE, FAILED_LINE, FRESH_LINE, HEAD, keptWords, KIND_WORDS, layingWords, LOST_LINE, MADE_UP_MAP, madeUp, newCount,
  NO_PLATE_LINE, NO_STORE_LINE, NOT_KEPT_LINE, OFFER_WORDS, pictureFrom, readAtWords, readingWords, roundPoints, STOPPED_LINE, UNSAVED_LINE,
} from './links3d';
import { holdRefusal } from './refusal';
import { build, GraphCache } from './scene';
import type { Slice } from './slice';
import type { Row } from './types';

const id = (n: number) => `0199c3a1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PLAIN = id(1);
const ch = (n: number, links: number[] = []) => ({ id: id(100 + n), type: 'character', name: `C${n}`, friends: links.map((l) => id(100 + l)) });
const pin = (n: number, el: number, x: number, y: number) => ({ id: id(900 + n), type: 'pin', map: PLAIN, element_type: 'character', element_id: id(100 + el), x, y });
// Eight Characters linked in a ring with a spoke, three of them pinned on a plain Map (the plate).
const rows: Row[] = [ch(1, [2, 5]), ch(2, [3]), ch(3, [4]), ch(4, [1]), ch(5, [6]), ch(6, [7]), ch(7, [8]), ch(8, [5])];
const space: Row[] = [{ id: PLAIN, type: 'map', name: 'Coast', width: 1000, height: 800 }, pin(1, 1, 100, 100), pin(2, 2, 400, 120), pin(3, 3, 260, 500)];
const input = (over: Partial<Links3dInput> = {}): Links3dInput => ({ rows, space, rung: 'public', held: null, ...over });

describe('the answer as a Map and Pins', () => {
  it('rounds half to even, moves to the origin, keeps ids, one Pin per node', () => {
    const ids = ['a', 'b', 'c'];
    const raw = new Float64Array([0.5, 1.5, -2.5, 10.4, -3.6, 2.5, -0.5, 7, 0]);
    const r = roundPoints(raw);
    expect([...r]).toEqual([0, 2, -2, 10, -4, 2, 0, 7, 0]);
    expect(Object.is(r[6], -0)).toBe(false);
    const { map, pins } = madeUp(ids, r, (x) => (x === 'c' ? null : 'character'));
    expect(pins.map((p) => p.element_id)).toEqual(ids);
    expect(pins.map((p) => [p.x, p.y, p.z])).toEqual([[0, 6, 0], [10, 0, 4], [0, 11, 2]]);
    expect(pins.every((p) => p.map === MADE_UP_MAP && p.type === 'pin')).toBe(true);
    expect(pins[2].element_type).toBeNull();
    expect(new Set(pins.map((p) => p.id)).size).toBe(3);
    expect(map).toMatchObject({ id: MADE_UP_MAP, type: 'map', name: HEAD, width: 10, height: 11, depth: 4, x_layout: { method: 'by-links-3d' } });
  });

  it('an extent of 0 is 1, so one or two elements are still a layout with a depth', () => {
    const one = madeUp(['a'], new Float64Array([5, 5, 5]), () => 'character');
    expect([one.map.width, one.map.height, one.map.depth]).toEqual([1, 1, 1]);
    const two = madeUp(['a', 'b'], new Float64Array([0, 3, 0, 60, 3, 0]), () => 'character');
    expect([two.map.width, two.map.height, two.map.depth]).toEqual([60, 1, 1]);
    const m = readMap(two.map, [two.map]);
    expect(m.kind).toBe('layout3d');
    expect(m.layout).toBe('by-links-3d');
    expect(m.ground).toBeNull();
    expect(layoutOf(two.map, [two.map], two.pins).layout).toBe('by-links-3d');
  });

  it('every Pin is whole and inside the Map, and the builder draws one Pin item each with the links', () => {
    const a = layOut(input());
    const r = roundPoints(a.points);
    const typeOf = new Map(rows.map((x) => [x.id, x.type as string]));
    const { map, pins } = madeUp(a.ids, r, (x) => typeOf.get(x) ?? null);
    for (const p of pins) {
      for (const k of ['x', 'y', 'z'] as const) expect(Number.isInteger(p[k])).toBe(true);
      expect(p.x as number).toBeGreaterThanOrEqual(0);
      expect(p.x as number).toBeLessThanOrEqual(map.width as number);
      expect(p.z as number).toBeLessThanOrEqual(map.depth as number);
    }
    const ms = mapSpace([map, ...pins]);
    expect(ms.pins).toHaveLength(a.ids.length);
    const maps = [...space.filter((x) => x.type === 'map'), map];
    const reading = { ...readMap(map, maps), words: KIND_WORDS };
    const slice: Slice = { mapId: MADE_UP_MAP, groundId: null, maps, pins, markers: [], zones: [], bodies: rows, pinned: [...a.ids] };
    const scene = build({ slice, reading, ground: null, rung: 'public', complete: true, pictureSize: null, versionOf: () => 1 }, new GraphCache());
    expect(scene.counts.pins).toBe(8);
    expect(scene.counts.lines).toBe(9);
    expect(scene.frame).toEqual({ w: map.width, h: map.height, from: 'written' });
  });
});

describe('the new count', () => {
  it('counts the ids not in the hold, never the method held false', () => {
    expect(newCount(['a', 'b', 'c'], null)).toBe(3);
    expect(newCount(['a', 'b', 'c'], new Set(['a', 'c', 'z']))).toBe(1);
    expect(newCount([], new Set(['a']))).toBe(0);
  });

  it('a pinned element is never new when it was held, though the method says it is not held', () => {
    const first = layOut(input());
    expect(first.heldUsed).toBe(false);
    expect(first.fresh).toBe(8);
    const r = roundPoints(first.points);
    const held = new Map(first.ids.map((x, i) => [x, r.subarray(3 * i, 3 * i + 3)]));
    // A ninth element arrives, linked to the fourth.
    const more = [...rows, ch(9, [4])];
    const second = layOut(input({ rows: more, held: flatHold(held) }));
    expect(second.heldUsed).toBe(true);
    expect(second.fresh).toBe(1);
    // The plate's three are pinned: the method's own `held` is false for them, so counting it says 4.
    const raw = layoutByLinks3d(worldGraph({ elements: more }, { rung: 'public' }), space, { held, heldUnit: 1 });
    expect(raw.held.filter((x) => !x).length).toBe(4);
    expect(raw.how.filter((x) => x === 'map').length).toBe(3);
    // Every kept element stands where the hold had it, in the answer's own frame.
    const r2 = roundPoints(second.points);
    for (let i = 0; i < second.ids.length; i++) {
      const h = held.get(second.ids[i]);
      if (h) expect([...r2.subarray(3 * i, 3 * i + 3)]).toEqual([...h]);
    }
  });
});

describe('which picture a press drew', () => {
  const ids = ['a', 'b', 'c'];
  it('kept only when the hold kept something', () => {
    expect(pictureFrom({ heldUsed: true, fresh: 0, ids, refused: null }, 'held')).toBe('kept');
    expect(pictureFrom({ heldUsed: true, fresh: 2, ids, refused: null }, 'held')).toBe('kept');
    expect(pictureFrom({ heldUsed: true, fresh: 3, ids, refused: null }, 'held')).toBe('nothing');
    expect(pictureFrom({ heldUsed: false, fresh: 3, ids, refused: null }, 'none')).toBe('nothing');
    expect(pictureFrom({ heldUsed: false, fresh: 3, ids, refused: 'held-box' }, 'held')).toBe('lost');
    expect(pictureFrom({ heldUsed: false, fresh: 3, ids, refused: null }, 'lost')).toBe('lost');
    expect(pictureFrom({ heldUsed: false, fresh: 3, ids, refused: null }, 'no-store')).toBe('nothing');
  });
});

describe('the hold refused', () => {
  it('reads the four codes and nothing else', () => {
    for (const code of ['held-not-object', 'held-not-point', 'held-box', 'held-unit']) expect(holdRefusal(Object.assign(new TypeError('x'), { code }))).toBe(code);
    expect(holdRefusal(new TypeError('worldGraph: no'))).toBeNull();
    expect(holdRefusal(Object.assign(new Error('x'), { code: 'other' }))).toBeNull();
    expect(holdRefusal(null)).toBeNull();
    expect(holdRefusal('held-box')).toBeNull();
  });

  it('a hold wider than the method takes is dropped, and the press lays out from nothing', () => {
    const far = BY_LINKS_3D_REST * 800;
    const a = layOut(input({ held: { ids: [id(101), id(102)], xyz: new Float64Array([0, 0, 0, far, 0, 0]) } }));
    expect(a.refused).toBe('held-box');
    expect(a.heldUsed).toBe(false);
    expect(a.fresh).toBe(a.ids.length);
    const b = layOut(input({ held: { ids: [id(101)], xyz: new Float64Array([Number.NaN, 0, 0]) } }));
    expect(b.refused).toBe('held-not-point');
  });

  it('a layout error that is not the hold is thrown', () => {
    expect(() => layOut(input({ space: 'not a list' as unknown as Row[] }))).toThrow();
    // With a good hold beside it, the error is still the layout's, never read as a hold refusal.
    expect(() => layOut(input({ space: 'not a list' as unknown as Row[], held: { ids: [id(101)], xyz: new Float64Array([0, 0, 0]) } }))).toThrow();
  });
});

describe('the words', () => {
  it('say each state plainly, with no dash', () => {
    expect(FRESH_LINE).toBe('Laid out from nothing.');
    expect(keptWords(0)).toBe('Kept the picture you last saw here; 0 placed new.');
    expect(keptWords(1234)).toBe('Kept the picture you last saw here; 1,234 placed new.');
    expect(readAtWords(new Date(2026, 10, 16, 9, 4))).toBe('From the world as read at 09:04; a reload reads it again.');
    expect(readingWords(1, 0)).toBe('Reading what you can see of the world: 1 element so far, 0 s.');
    expect(layingWords(2500, 3)).toBe('Laying out the 2,500 elements read, 3 s so far.');
    expect(ceilingWords3d()).toBe('This world holds more than 10,000 elements you can see, too many for the mapper to lay out here.');
    expect(HEAD).toBe('By links, in 3D (not saved)');
    expect(KIND_WORDS).toBe('a layout · 3D · not saved');
    const all = [FRESH_LINE, keptWords(3), LOST_LINE, NO_STORE_LINE, NOT_KEPT_LINE, NO_PLATE_LINE, EMPTY_LINE, FAILED_LINE, STOPPED_LINE, UNSAVED_LINE, CHANGE_LINE, OFFER_WORDS, ceilingWords3d(), HEAD];
    for (const w of all) {
      expect(w).not.toMatch(/[—–]/);
      expect(w).not.toMatch(/every element/i);
    }
    expect(EMPTY_LINE).toBe('Nothing to lay out for you here.');
    expect(UNSAVED_LINE).toMatch(/Atlas saves a layout/);
    expect(CHANGE_LINE).toMatch(/later version/);
  });
});
