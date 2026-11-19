import { describe, expect, it } from 'vitest';
import { BY_LINKS_3D_REST } from '@onlyworlds/sdk';
import { clearOf, FLOOR_GAP, floorBesideGroups, floorOf } from './floor';
import { layOut, layOutGraph } from './layout3d';
import { roundPoints } from './links3d';
import type { Row } from './types';

const REST = BY_LINKS_3D_REST;
type N = { id: string; type: string };
const edge = (source: string, target: string, field = 'f') => ({ source, target, field, index: 0 });
const dist = (p: ArrayLike<number>, i: number, q: readonly number[]) => Math.hypot(p[3 * i] - q[0], p[3 * i + 1] - q[1], p[3 * i + 2] - q[2]);

/** The method's answer for a graph, as the layout's worker answers it (no plate, no hold). */
const lay = (g: { nodes: N[]; edges: ReturnType<typeof edge>[] }) => layOutGraph(g, [], null);
/** The floor for that answer, over the method's own points. */
function floored(g: { nodes: N[]; edges: ReturnType<typeof edge>[] }) {
  const a = lay(g);
  const kind = new Map(g.nodes.map((x) => [x.id, x.type]));
  return { a, f: floorOf({ ids: a.ids, points: a.points, group: a.group, unplaced: a.unplaced, typeOf: (id) => kind.get(id) ?? null }) };
}

// The cases below are the OnlyWorlds dashboard's own floor cases (its 3D floor, the same rule and the
// same numbers), run here through the mapper's call site: the same world must stand the same floor.

/** Two groups (centres c1 and l1): eight Characters, eight Locations, joined twice; a lone Character, a lone Location, a lone Species. */
function world(): { nodes: N[]; edges: ReturnType<typeof edge>[] } {
  const nodes: N[] = [];
  const edges: ReturnType<typeof edge>[] = [];
  for (const k of ['c', 'l']) {
    for (let i = 0; i < 8; i++) nodes.push({ id: `${k}${i}`, type: k === 'c' ? 'character' : 'location' });
    for (let i = 1; i < 8; i++) edges.push(edge(`${k}0`, `${k}${i}`));
    edges.push(edge(`${k}1`, `${k}2`), edge(`${k}3`, `${k}4`), edge(`${k}5`, `${k}6`), edge(`${k}7`, `${k}1`));
  }
  edges.push(edge('c1', 'l1'), edge('c2', 'l2'));
  nodes.push({ id: 'zc', type: 'character' }, { id: 'zl', type: 'location' }, { id: 'zs', type: 'species' });
  return { nodes, edges };
}

/** The dashboard's sweep: a seeded world of n elements of some kinds, a share of them linked round some hubs. */
let seed = 99;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const KINDS = ['character', 'location', 'object', 'species', 'family', 'event', 'law', 'creature', 'trait', 'ability'];
function synth(n: number, kinds: string[], linkedFrac: number, clusters: number): { nodes: N[]; edges: ReturnType<typeof edge>[] } {
  const nodes: N[] = [];
  const edges: ReturnType<typeof edge>[] = [];
  for (let i = 0; i < n; i++) nodes.push({ id: `e${String(i).padStart(4, '0')}`, type: kinds[Math.floor(rnd() * kinds.length)] });
  const linked = nodes.filter(() => rnd() < linkedFrac);
  const hubs = linked.slice(0, clusters);
  for (const x of linked) {
    if (hubs.includes(x)) continue;
    edges.push(edge(x.id, hubs[Math.floor(rnd() * hubs.length)].id));
    if (rnd() < 0.3) {
      const y = linked[Math.floor(rnd() * linked.length)];
      if (y !== x) edges.push(edge(x.id, y.id, 'g'));
    }
  }
  for (let i = 1; i < hubs.length; i++) if (rnd() < 0.7) edges.push(edge(hubs[i].id, hubs[i - 1].id));
  return { nodes, edges };
}
/** The least distance from a floor point to a placed point, and between two floor points. */
function least(points: ArrayLike<number>, placed: number, f: ArrayLike<number>, floor: number): { placed: number; floor: number } {
  let p = Infinity;
  let q = Infinity;
  for (let i = 0; i < floor; i++) {
    for (let j = 0; j < placed; j++) p = Math.min(p, Math.hypot(f[3 * i] - points[3 * j], f[3 * i + 1] - points[3 * j + 1], f[3 * i + 2] - points[3 * j + 2]));
    for (let j = i + 1; j < floor; j++) q = Math.min(q, Math.hypot(f[3 * i] - f[3 * j], f[3 * i + 1] - f[3 * j + 1], f[3 * i + 2] - f[3 * j + 2]));
  }
  return { placed: p, floor: q };
}
function shuffled<T>(xs: readonly T[], s0: number): T[] {
  let s = s0;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('the floor', () => {
  it('stands every element the method left out, beside the group where most of its kind stand, on its far side, clear', () => {
    const { a, f } = floored(world());
    expect(a.unplaced).toEqual(['zc', 'zl', 'zs']);
    expect(f.floor.length).toBe(9);
    expect([f.moved, f.gathered, f.gatheredKinds]).toEqual([2, 1, ['species']]);
    const at = (id: string) => { const k = a.ids.indexOf(id); return [a.points[3 * k], a.points[3 * k + 1], a.points[3 * k + 2]]; };
    const groupOf = (id: string) => a.group[a.ids.indexOf(id)];
    const centre = (g0: string) => {
      const ks = a.ids.filter((id) => groupOf(id) === g0).map(at);
      return [0, 1, 2].map((c) => ks.reduce((s, p) => s + p[c], 0) / ks.length);
    };
    expect([groupOf('c2'), groupOf('l2')]).toEqual(['c1', 'l1']);
    const cc = centre('c1');
    const lc = centre('l1');
    const body = [0, 1, 2].map((c) => a.ids.reduce((s, _, k) => s + a.points[3 * k + c], 0) / a.ids.length);
    expect(dist(f.floor, 0, body)).toBeGreaterThan(Math.hypot(cc[0] - body[0], cc[1] - body[1], cc[2] - body[2]));
    expect(dist(f.floor, 0, cc)).toBeLessThan(dist(f.floor, 0, lc));
    expect(dist(f.floor, 1, lc)).toBeLessThan(dist(f.floor, 1, cc));
    for (let k = 0; k < 3; k++) for (let i = 0; i < a.ids.length; i++) expect(dist(f.floor, k, at(a.ids[i]))).toBeGreaterThanOrEqual(FLOOR_GAP);
    // A kind no group holds is gathered under the body.
    let low = Infinity;
    for (let k = 0; k < a.ids.length; k++) low = Math.min(low, a.points[3 * k + 2]);
    expect(f.floor[3 * 2 + 2]).toBeLessThan(low);
  });

  it('the same world gives the same floor in any order it is handed in', () => {
    const g = world();
    const one = floored(g);
    const two = floored({ nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() });
    expect(two.a.unplaced).toEqual(one.a.unplaced);
    expect([...two.f.floor]).toEqual([...one.f.floor]);
    const ab = floorOf({ ids: [], points: [], group: [], unplaced: ['a', 'b'], typeOf: () => 'x' }).floor;
    expect([...floorOf({ ids: [], points: [], group: [], unplaced: ['b', 'a'], typeOf: () => 'x' }).floor]).toEqual([...ab].slice(3).concat([...ab].slice(0, 3)));
  });

  it('a world with no link at all: every element on the floor, a ball for each kind, none on another', () => {
    const nodes: N[] = [];
    for (let i = 0; i < 600; i++) nodes.push({ id: `n${String(i).padStart(3, '0')}`, type: i % 3 ? 'character' : 'location' });
    const { a, f } = floored({ nodes, edges: [] });
    expect([a.ids.length, a.unplaced.length, f.gathered]).toEqual([0, 600, 600]);
    expect(least([], 0, f.floor, 600).floor).toBeGreaterThanOrEqual(FLOOR_GAP);
    const mid = (keep: (i: number) => boolean) => [0, 1, 2].map((c) => { let s = 0; let n = 0; for (let i = 0; i < 600; i++) if (keep(i)) { s += f.floor[3 * i + c]; n++; } return s / n; });
    const loc = mid((i) => i % 3 === 0);
    const chr = mid((i) => i % 3 !== 0);
    for (let i = 0; i < 600; i += 3) expect(dist(f.floor, i, loc)).toBeLessThan(dist(f.floor, i, chr));
  });

  it('nothing left out: no floor', () => {
    expect(FLOOR_GAP).toBe(REST / 2);
    expect(floorOf({ ids: ['a'], points: [0, 0, 0], group: ['a'], unplaced: [], typeOf: () => 'x' }).floor.length).toBe(0);
  });

  it('a kind held equally by two groups stands beside the one with the smaller centre id', () => {
    const typeOf = (id: string) => (id === 'a1' || id === 'b1' || id === 'z' ? 'location' : 'character');
    const f = floorOf({ ids: ['a', 'a1', 'b', 'b1'], points: [-300, 0, 0, -300, 60, 0, 300, 0, 0, 300, 60, 0], group: ['a', 'a', 'b', 'b'], unplaced: ['z'], typeOf }).floor;
    expect(f[0]).toBeLessThan(-300);
    const g = floorOf({ ids: ['a', 'a1', 'b', 'b1'], points: [300, 0, 0, 300, 60, 0, -300, 0, 0, -300, 60, 0], group: ['a', 'a', 'b', 'b'], unplaced: ['z'], typeOf }).floor;
    expect(g[0]).toBeGreaterThan(300);
  });
});

describe('the clearance', () => {
  it('moves a point along its direction to the first place a gap from every point taken', () => {
    const taken = [0, 0, 0, 100, 0, 0];
    expect(clearOf([10, 0, 0], [1, 0, 0], taken, 2, 30, 15)).toEqual([40, 0, 0]);
    expect(clearOf([50, 0, 0], [1, 0, 0], taken, 2, 30, 15)).toEqual([50, 0, 0]);
    expect(clearOf([95, 0, 0], [0, 0, -1], taken, 1, 30, 15)).toEqual([95, 0, 0]);
    expect(clearOf([95, 0, 0], [0, 0, -1], taken, 2, 30, 15)).toEqual([95, 0, -30]);
  });

  it('over the dashboard sweep of 120 worlds, the same least distances: 30.011 to a placed point, 30.857 between floor points', () => {
    seed = 99;
    let worlds = 0;
    let placed = Infinity;
    let floor = Infinity;
    let drawnPlaced = Infinity;
    let drawnFloor = Infinity;
    for (let w = 0; w < 120; w++) {
      const n = 100 + Math.floor(rnd() * 500);
      const k = 2 + Math.floor(rnd() * 8);
      const frac = 0.5 + rnd() * 0.45;
      const hubs = 2 + Math.floor(rnd() * 18);
      const g = synth(n, KINDS.slice(0, k), frac, hubs);
      const { a, f } = floored(g);
      if (!a.unplaced.length) continue;
      worlds++;
      const m = least(a.points, a.ids.length, f.floor, a.unplaced.length);
      placed = Math.min(placed, m.placed);
      floor = Math.min(floor, m.floor);
      // As the mapper draws them: every point in whole units.
      const kind = new Map(g.nodes.map((x) => [x.id, x.type]));
      const d = floorBesideGroups({ ids: a.ids, points: a.points, rounded: roundPoints(a.points), group: a.group, unplaced: a.unplaced, typeOf: (id) => kind.get(id) ?? null });
      const dm = least(d.points, a.ids.length, d.points.subarray(3 * a.ids.length), a.unplaced.length);
      drawnPlaced = Math.min(drawnPlaced, dm.placed);
      drawnFloor = Math.min(drawnFloor, dm.floor);
    }
    expect(worlds).toBe(120);
    expect(placed).toBeGreaterThanOrEqual(FLOOR_GAP);
    expect(floor).toBeGreaterThanOrEqual(FLOOR_GAP);
    expect(Math.round(placed * 1000) / 1000).toBe(30.011);
    expect(Math.round(floor * 1000) / 1000).toBe(30.857);
    // Rounded to whole units each point moves at most half a unit on each axis.
    expect(drawnPlaced).toBeGreaterThanOrEqual(FLOOR_GAP - Math.sqrt(3));
    expect(drawnFloor).toBeGreaterThanOrEqual(FLOOR_GAP - Math.sqrt(3));
  }, 120000);

  it('the row of kinds no group holds stands under everything placed, the home balls too', () => {
    seed = 7;
    let rows = 0;
    for (let w = 0; w < 30; w++) {
      const g = synth(150 + Math.floor(rnd() * 300), KINDS.slice(0, 4), 0.6, 2 + Math.floor(rnd() * 6));
      const extra = 3 + Math.floor(rnd() * 20);
      for (let i = 0; i < extra; i++) g.nodes.push({ id: `z${String(i).padStart(3, '0')}`, type: i % 2 ? 'zone' : 'marker' });
      const { a, f } = floored(g);
      const kind = new Map(g.nodes.map((x) => [x.id, x.type]));
      const homed = new Set(a.ids.map((id) => kind.get(id)));
      let low = Infinity;
      for (let k = 0; k < a.ids.length; k++) low = Math.min(low, a.points[3 * k + 2]);
      a.unplaced.forEach((id, k) => { if (homed.has(kind.get(id))) low = Math.min(low, f.floor[3 * k + 2]); });
      a.unplaced.forEach((id, k) => {
        if (homed.has(kind.get(id))) return;
        rows++;
        expect(f.floor[3 * k + 2]).toBeLessThanOrEqual(low - REST);
      });
    }
    expect(rows).toBeGreaterThan(0);
  }, 60000);

  it('the same floor in any order, over several shuffles of several worlds', () => {
    seed = 1234;
    for (let w = 0; w < 4; w++) {
      const g = synth(200 + 100 * w, KINDS.slice(0, 3 + w), 0.7, 3 + w);
      const byId = (x: ReturnType<typeof floored>) => new Map(x.a.unplaced.map((id, k) => [id, [x.f.floor[3 * k], x.f.floor[3 * k + 1], x.f.floor[3 * k + 2]]]));
      const want = byId(floored(g));
      for (let s = 1; s <= 4; s++) expect(byId(floored({ nodes: shuffled(g.nodes, 31 * w + s), edges: shuffled(g.edges, 97 * w + s) }))).toEqual(want);
    }
  }, 60000);
});

describe('the floor as the mapper draws it', () => {
  // A body of Characters round two hubs, a Location hanging off one, and three elements linked to nothing.
  const id = (n: number) => `0199c3a1-0000-7000-8000-${String(n).padStart(12, '0')}`;
  const el = (type: string, n: number, links: number[] = []) => ({ id: id(n), type, name: `${type} ${n}`, friends: links.map(id) });
  const rows: Row[] = [
    el('character', 1, [2, 3, 4, 5, 6, 7]), el('character', 2, [3]), el('character', 3), el('character', 4), el('character', 5), el('character', 6), el('character', 7, [8]),
    el('character', 8, [9, 10, 11, 12, 13]), el('character', 9), el('character', 10), el('character', 11), el('character', 12), el('character', 13, [1]),
    { id: id(20), type: 'location', name: 'Port' }, { ...el('character', 14, [8]), birthplace: id(20) },
    el('character', 30), { id: id(31), type: 'location', name: 'Cairn' }, { id: id(32), type: 'object', name: 'Cup' },
  ];
  const typeOf = (x: string) => (rows.find((r) => r.id === x)?.type as string) ?? null;

  it('keeps the placed as the hold keeps them and the floor after them, by id, in whole units', () => {
    const a = layOut({ rows, space: [], rung: 'public', held: null });
    expect(a.unplaced).toEqual([id(30), id(31), id(32)]);
    const d = floorBesideGroups({ ids: a.ids, points: a.points, rounded: roundPoints(a.points), group: a.group, unplaced: [...a.unplaced].reverse(), typeOf });
    expect(d.ids).toEqual([...a.ids, id(30), id(31), id(32)]);
    expect([...d.points.subarray(0, 3 * a.ids.length)]).toEqual([...roundPoints(a.points)]);
    const f = floorOf({ ids: a.ids, points: a.points, group: a.group, unplaced: a.unplaced, typeOf });
    expect([...d.points.subarray(3 * a.ids.length)]).toEqual([...roundPoints(f.floor)]);
    expect([d.moved, d.gathered, d.gatheredKinds]).toEqual([2, 1, ['object']]);
  });

  it('an id the method placed is never put on the floor too', () => {
    const a = layOut({ rows, space: [], rung: 'public', held: null });
    const d = floorBesideGroups({ ids: a.ids, points: a.points, rounded: roundPoints(a.points), group: a.group, unplaced: [...a.unplaced, a.ids[0]], typeOf });
    expect(d.ids.filter((x) => x === a.ids[0])).toHaveLength(1);
  });
});
