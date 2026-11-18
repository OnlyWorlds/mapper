import { describe, expect, it } from 'vitest';
import { floorBesideGroups, shelfPieces } from './floor';

// Two groups far apart: A holds characters, B holds locations; a shelf below them.
const ids = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 's1', 's2', 's3', 's4'];
const types: Record<string, string> = { a1: 'character', a2: 'character', a3: 'location', b1: 'location', b2: 'location', b3: 'object', s1: 'character', s2: 'location', s3: 'location', s4: 'creature' };
const points = Float64Array.from([
  0, 0, 0, 60, 0, 0, 0, 60, 0, // A
  1000, 0, 0, 1060, 0, 0, 1000, 60, 0, // B
  0, -2000, 0, 300, -2000, 0, 360, -2000, 0, 600, -2000, 0, // the shelf
]);
const group = ['a1', 'a1', 'a1', 'b1', 'b1', 'b1', null, null, null, null];
const part = [null, null, null, null, null, null, 'no-link', 'no-link', 'no-link', 'no-link'];
// s2 and s3 are linked to each other: one piece.
const edges = [{ source: 's2', target: 's3' }, { source: 'a1', target: 'a2' }];
const piece = shelfPieces(ids, part, edges);
const input = { ids, points, group, part, piece, typeOf: (id: string) => types[id] ?? null };
const at = (p: ArrayLike<number>, i: number) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const centreA = [20, 20, 0];
const centreB = [1020, 20, 0];

describe('the floor drawn beside the groups', () => {
  it('finds the shelf pieces by the links between shelf elements only', () => {
    expect([...piece]).toEqual([-1, -1, -1, -1, -1, -1, 6, 7, 7, 9]);
  });

  it('draws a shelf element beside the group where most of its kind stand, the rest as answered', () => {
    const d = floorBesideGroups(input);
    // A character goes to A, the location piece to B (B holds two of the three locations).
    expect(dist(at(d.points, 6), centreA)).toBeLessThan(dist(at(d.points, 6), centreB));
    expect(dist(at(d.points, 7), centreB)).toBeLessThan(dist(at(d.points, 7), centreA));
    // Out of the group's own sphere, not inside it, and not far off.
    expect(dist(at(d.points, 6), centreA)).toBeGreaterThan(60);
    expect(dist(at(d.points, 6), centreA)).toBeLessThan(400);
    for (let i = 0; i < 6; i++) expect(at(d.points, i)).toEqual(at(points, i));
    expect(d.moved).toBe(3);
  });

  it('moves a piece as one block', () => {
    const d = floorBesideGroups(input);
    const before = at(points, 8).map((v, k) => v - at(points, 7)[k]);
    const after = at(d.points, 8).map((v, k) => v - at(d.points, 7)[k]);
    expect(after).toEqual(before);
  });

  it('a kind no group holds gathers where it stood: one block stays put, and is counted', () => {
    const d = floorBesideGroups(input);
    expect(at(d.points, 9)).toEqual(at(points, 9));
    expect(d.gathered).toBe(1);
    expect(d.gatheredKinds).toEqual(['creature']);
  });

  it('blocks of a kind no group holds gather as a cluster of their own, closer than the shelf had them', () => {
    const ids3 = [...ids, 'z1', 'z2', 'z3'];
    const p3 = Float64Array.from([...points, -1500, -2000, 0, 1500, -2000, 0, 2500, -2000, 0]);
    const part3 = [...part, 'no-link', 'no-link', 'no-link'];
    const t3: Record<string, string> = { ...types, z1: 'zone', z2: 'zone', z3: 'zone' };
    const d = floorBesideGroups({ ids: ids3, points: p3, group: [...group, null, null, null], part: part3, piece: shelfPieces(ids3, part3, edges), typeOf: (id) => t3[id] ?? null });
    const span = (p: ArrayLike<number>) => Math.max(dist(at(p, 10), at(p, 11)), dist(at(p, 11), at(p, 12)), dist(at(p, 10), at(p, 12)));
    expect(span(d.points)).toBeLessThan(span(p3) / 4);
    expect(d.gatheredKinds).toEqual(['creature', 'zone']);
    expect(d.gathered).toBe(4);
  });

  it('never changes the answer it reads, draws whole numbers, and draws the same twice', () => {
    const copy = Float64Array.from(points);
    const d1 = floorBesideGroups(input);
    const d2 = floorBesideGroups(input);
    expect([...points]).toEqual([...copy]);
    expect([...d1.points]).toEqual([...d2.points]);
    expect([...d1.points].every(Number.isInteger)).toBe(true);
  });

  it('with no groups, or no shelf, draws the answer as it is', () => {
    const none = floorBesideGroups({ ...input, group: ids.map(() => null) });
    expect([...none.points]).toEqual([...points]);
    const noShelf = floorBesideGroups({ ...input, part: ids.map(() => null) });
    expect([...noShelf.points]).toEqual([...points]);
    expect(noShelf.moved + noShelf.gathered).toBe(0);
  });

  it('a kind that only hangs off the body (no group named) goes beside the group nearest it', () => {
    const ids2 = [...ids, 'arm1'];
    const p2 = Float64Array.from([...points, 1100, 100, 0]); // an arm beside B
    const t2: Record<string, string> = { ...types, arm1: 'creature' };
    const part2 = [...part, 'one-link'];
    const d = floorBesideGroups({ ids: ids2, points: p2, group: [...group, null], part: part2, piece: shelfPieces(ids2, part2, edges), typeOf: (id) => t2[id] ?? null });
    // s4, the shelf's creature, now has a home: B, where the creature arm stands.
    expect(dist(at(d.points, 9), centreB)).toBeLessThan(dist(at(d.points, 9), centreA));
    expect(d.gathered).toBe(0);
    expect(at(d.points, 10)).toEqual(at(p2, 10));
  });

  it('three hundred shelf elements make a ball near their group, not a ring wider than the world', () => {
    const n = 300;
    const ids4 = ['a1', 'a2', ...Array.from({ length: n }, (_, i) => `s${i}`)];
    const p4 = Float64Array.from([0, 0, 0, 60, 0, 0, ...Array.from({ length: n }, (_, i) => [i * 60, -3000, 0]).flat()]);
    const part4 = [null, null, ...ids4.slice(2).map(() => 'no-link')];
    const d = floorBesideGroups({ ids: ids4, points: p4, group: ['a1', 'a1', ...ids4.slice(2).map(() => null)], part: part4, piece: shelfPieces(ids4, part4, []), typeOf: () => 'location' });
    let far = 0;
    let near = Infinity;
    for (let i = 2; i < ids4.length; i++) {
      far = Math.max(far, dist(at(d.points, i), [30, 0, 0]));
      for (let j = i + 1; j < ids4.length; j++) near = Math.min(near, dist(at(d.points, i), at(d.points, j)));
    }
    // The shelf ran 18,000 wide; the ball stays within a few rests of the group, and no two stand nearer
    // than a quarter rest (measured 0.32; the dots are drawn 0.197 of a rest apart at their nearest).
    expect(far).toBeLessThan(60 * 12);
    expect(near).toBeGreaterThan(15);
  });

  it('two blocks beside one group never land on one spot', () => {
    const many = ['a1', 'a2', 'x1', 'x2', 'x3'];
    const p = Float64Array.from([0, 0, 0, 60, 0, 0, 0, -900, 0, 100, -900, 0, 200, -900, 0]);
    const part2 = [null, null, 'no-link', 'no-link', 'no-link'];
    const d = floorBesideGroups({ ids: many, points: p, group: ['a1', 'a1', null, null, null], part: part2, piece: shelfPieces(many, part2, []), typeOf: () => 'character' });
    const spots = [2, 3, 4].map((i) => at(d.points, i).join(','));
    expect(new Set(spots).size).toBe(3);
    for (let i = 2; i < 5; i++) for (let j = i + 1; j < 5; j++) expect(dist(at(d.points, i), at(d.points, j))).toBeGreaterThanOrEqual(59);
  });
});
