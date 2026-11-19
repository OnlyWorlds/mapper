import { describe, expect, it } from 'vitest';
import { BY_LINKS_3D_REST } from '@onlyworlds/sdk';
import { floorBesideGroups, type FloorInput } from './floor';
import { layOut } from './layout3d';
import { roundPoints } from './links3d';
import type { Row } from './types';

const id = (n: number) => `0199c3a1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const el = (type: string, n: number, links: number[] = []) => ({ id: id(n), type, name: `${type} ${n}`, friends: links.map(id) });

// A body of Characters round two hubs, a Location hanging off one hub, and three elements linked to
// nothing: a Character and a Location (kinds the body holds) and an Object (a kind it does not).
const rows: Row[] = [
  el('character', 1, [2, 3, 4, 5, 6, 7]), el('character', 2, [3]), el('character', 3), el('character', 4), el('character', 5), el('character', 6), el('character', 7, [8]),
  el('character', 8, [9, 10, 11, 12, 13]), el('character', 9), el('character', 10), el('character', 11), el('character', 12), el('character', 13, [1]),
  { id: id(20), type: 'location', name: 'Port', friends: [] }, { ...el('character', 14, [8]), birthplace: id(20) },
  el('character', 30), { id: id(31), type: 'location', name: 'Cairn' }, { id: id(32), type: 'object', name: 'Cup' },
];
const typeOf = (x: string) => (rows.find((r) => r.id === x)?.type as string) ?? null;

function input(): FloorInput {
  const a = layOut({ rows, space: [], rung: 'public', held: null });
  return { ids: a.ids, points: roundPoints(a.points), group: a.group, unplaced: a.unplaced, typeOf };
}
const at = (p: ArrayLike<number>, i: number): [number, number, number] => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('the floor beside the groups', () => {
  it('keeps every placed point as answered and adds the unplaced after them, by id, in whole numbers', () => {
    const inp = input();
    expect(inp.unplaced).toEqual([id(30), id(31), id(32)]);
    const f = floorBesideGroups(inp);
    expect(f.ids).toEqual([...inp.ids, id(30), id(31), id(32)]);
    expect([...f.points.subarray(0, 3 * inp.ids.length)]).toEqual(Array.from(inp.points));
    for (const v of f.points.subarray(3 * inp.ids.length)) expect(Number.isInteger(v) && !Object.is(v, -0)).toBe(true);
    expect(f.moved).toBe(2);
    expect(f.gathered).toBe(1);
    expect(f.gatheredKinds).toEqual(['object']);
  });

  it('stands a kind the body holds beside a group of that kind, on its far side, never on top of a placed element', () => {
    const inp = input();
    const f = floorBesideGroups(inp);
    const n = inp.ids.length;
    const body = [0, 1, 2].map((k) => inp.ids.reduce((s, _, i) => s + inp.points[3 * i + k], 0) / n);
    for (const j of [0, 1]) {
      const p = at(f.points, n + j);
      // On the far side of the group nearest it: farther from the body's centre than that group's.
      const groups = [...new Set(inp.group.filter((g): g is string => g !== null))].map((g) => {
        const idx = inp.ids.flatMap((_, i) => (inp.group[i] === g ? [i] : []));
        return [0, 1, 2].map((k) => idx.reduce((s, i) => s + inp.points[3 * i + k], 0) / idx.length);
      });
      const near = groups.reduce((a, c) => (dist(c, p) < dist(a, p) ? c : a));
      expect(dist(p, body)).toBeGreaterThan(dist(near, body));
      // Never on top of a placed element (an arm may hang out past its group, so half a rest).
      expect(Math.min(...inp.ids.map((_, i) => dist(at(inp.points, i), p)))).toBeGreaterThanOrEqual(BY_LINKS_3D_REST / 2);
    }
  });

  it('gathers a kind no placed element holds just below the picture', () => {
    const inp = input();
    const f = floorBesideGroups(inp);
    const n = inp.ids.length;
    const zMin = Math.min(...inp.ids.map((_, i) => inp.points[3 * i + 2]));
    expect(f.points[3 * (n + 2) + 2]).toBeLessThanOrEqual(zMin - BY_LINKS_3D_REST);
  });

  it('draws the same floor for the same answer, whatever order the unplaced come in', () => {
    const inp = input();
    const a = floorBesideGroups(inp);
    const b = floorBesideGroups({ ...inp, unplaced: [...inp.unplaced].reverse() });
    expect(b.ids).toEqual(a.ids);
    expect([...b.points]).toEqual([...a.points]);
  });

  it('packs many of one kind as a ball, no two on one point', () => {
    const many = Array.from({ length: 40 }, (_, k) => id(500 + k));
    const inp = { ...input(), unplaced: many, typeOf: (x: string) => (many.includes(x) ? 'character' : typeOf(x)) };
    const f = floorBesideGroups(inp);
    const n = inp.ids.length;
    const pts = many.map((_, j) => at(f.points, n + j).join(','));
    expect(new Set(pts).size).toBe(40);
    expect(f.moved).toBe(40);
  });

  it('with nothing placed, every element stands on the floor, by kind', () => {
    const f = floorBesideGroups({ ids: [], points: [], group: [], unplaced: [id(32), id(30), id(31)], typeOf });
    expect(f.ids).toEqual([id(30), id(31), id(32)]);
    expect(f.gathered).toBe(3);
    expect(f.gatheredKinds).toEqual(['character', 'location', 'object']);
    expect(new Set([0, 1, 2].map((j) => at(f.points, j).join(','))).size).toBe(3);
  });

  it('an id the method placed is never put on the floor too', () => {
    const inp = input();
    const f = floorBesideGroups({ ...inp, unplaced: [...inp.unplaced, inp.ids[0]] });
    expect(f.ids.filter((x) => x === inp.ids[0])).toHaveLength(1);
  });
});
