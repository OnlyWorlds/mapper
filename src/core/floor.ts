// The floor beside the groups (OW Mapping's pick 2): what `layoutByLinks3d` does not place (its
// `unplaced`: linked to no other element and on no plate) the mapper stands beside the group where
// most elements of its kind stand, packed as a ball on that group's far side from the body; a kind no
// group holds is gathered as a ball of its own in a row under everything placed (a world with no link
// at all is only that row). Every floor point then stands clear (`clearOf`): at least `FLOOR_GAP`,
// the method's own least spacing, from every point the method placed and every floor point before
// it. The method's points are never moved, and the hold keeps only them. The same world gives the
// same floor whatever order its elements are handed in: every choice is by id or kind, in code point
// order, and every sum is taken in id order. The rule and its numbers are the OnlyWorlds dashboard's
// own (its 3D floor), so one world stands the same floor in both tools. Pure.
import { BY_LINKS_3D_REST, roundHalfEven } from '@onlyworlds/sdk';

export interface FloorInput {
  /** The placed elements' ids, in the answer's order. */
  ids: readonly string[];
  /** x, y, z of `ids[k]` at `3 * k`, as the method answered them. */
  points: ArrayLike<number>;
  /** The method's `group` for `ids[k]`: a centre's id, or null. */
  group: readonly (string | null)[];
  /** The ids the method left out. */
  unplaced: readonly string[];
  /** An element's kind (its type), or null when unknown. */
  typeOf: (id: string) => string | null;
}

export type Vec3 = [number, number, number];
const REST = BY_LINKS_3D_REST;
/** No floor point stands nearer than this to a placed point or another floor point: half a rest, the method's least spacing. */
export const FLOOR_GAP = REST / 2;
/** Each floor element's room in a ball: a cube two rests on a side, so the ball's own points mostly stand a gap apart. */
const ROOM = (2 * REST) ** 3;
/** The step a point is moved by while it is not clear. */
const STEP = REST / 4;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** The golden angle: each next element of a ball turned from the last. */
const TURN = Math.PI * (3 - Math.sqrt(5));
const PHI = 0.6180339887498949;
/** The radius of a ball that holds `n` elements, `ROOM` each. */
const ballOf = (n: number): number => Math.cbrt((3 * n * ROOM) / (4 * Math.PI));
/** The radius of the ball `n` elements are packed in: where its last one stands. */
const outer = (n: number): number => (n <= 1 ? 0 : ballOf(n - 1) + REST / 2);

/**
 * The clearance: `p` moved along the unit direction `dir`, `step` at a time, to the first place at
 * least `gap` from each of the first `count` points of `taken` (x, y, z at `3 * k`); `p` itself when
 * it is clear already. Pure.
 */
export function clearOf(p: Vec3, dir: Vec3, taken: ArrayLike<number>, count: number, gap: number, step: number): Vec3 {
  const g2 = gap * gap;
  let q: Vec3 = [p[0], p[1], p[2]];
  for (let tries = 0; tries < 100000; tries++) {
    let clear = true;
    for (let k = 0; k < count; k++) {
      const dx = q[0] - taken[3 * k];
      const dy = q[1] - taken[3 * k + 1];
      const dz = q[2] - taken[3 * k + 2];
      if (dx * dx + dy * dy + dz * dz < g2) {
        clear = false;
        break;
      }
    }
    if (clear) return q;
    q = add(q, scale(dir, step));
  }
  return q;
}

export interface Floor {
  /** x, y, z of `unplaced[k]` at `3 * k`, in the method's units (not rounded). */
  floor: Float64Array;
  /** Floor elements stood beside a group of their kind. */
  moved: number;
  /** Floor elements of a kind no group holds, gathered in the row by kind. */
  gathered: number;
  /** The kinds gathered so (each once, an unknown kind left out). */
  gatheredKinds: string[];
}

export function floorOf(input: FloorInput): Floor {
  const { ids, points, group, unplaced } = input;
  const typeOf = (id: string): string => input.typeOf(id) ?? '';
  const out = new Float64Array(3 * unplaced.length);
  if (!unplaced.length) return { floor: out, moved: 0, gathered: 0, gatheredKinds: [] };
  const at = (k: number): Vec3 => [points[3 * k], points[3 * k + 1], points[3 * k + 2]];
  const centreOf = (idx: readonly number[]): { c: Vec3; r: number } => {
    let c: Vec3 = [0, 0, 0];
    for (const k of idx) c = add(c, at(k));
    c = scale(c, 1 / idx.length);
    let r = 0;
    for (const k of idx) r = Math.max(r, len(sub(at(k), c)));
    return { c, r };
  };

  // The groups, by centre id; every sum taken in id order, so the order handed in moves no point.
  const byId = ids.map((_, k) => k).sort((a, b) => cmp(ids[a], ids[b]));
  const members = new Map<string, number[]>();
  for (const k of byId) {
    const g = group[k];
    if (g !== null && g !== undefined) (members.get(g) ?? members.set(g, []).get(g)!).push(k);
  }
  const groups = [...members.keys()].sort(cmp).map((g) => ({ g, ...centreOf(members.get(g)!) }));
  const body = byId.length ? centreOf(byId) : { c: [0, 0, 0] as Vec3, r: 0 };

  // Where each placed element stands: its group, or (an arm, a link: the method names none) the nearest centre.
  const standsIn = (k: number): string | null => {
    const g = group[k];
    if (g !== null && g !== undefined) return g;
    let best: { g: string; d: number } | null = null;
    for (const x of groups) {
      const d = len(sub(at(k), x.c));
      if (!best || d < best.d) best = { g: x.g, d };
    }
    return best ? best.g : null;
  };
  // Per kind, the group that holds most of it (a tie to the smaller centre id).
  const perKind = new Map<string, Map<string, number>>();
  for (const k of byId) {
    const g = standsIn(k);
    if (g === null) continue;
    const kind = typeOf(ids[k]);
    const m = perKind.get(kind) ?? perKind.set(kind, new Map()).get(kind)!;
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  const homeOf = (kind: string): string | null => {
    const m = perKind.get(kind);
    if (!m) return null;
    let best: string | null = null;
    for (const [g, c] of m) if (best === null || c > m.get(best)! || (c === m.get(best)! && g < best)) best = g;
    return best;
  };

  // The floor's elements by id, each beside its kind's home group, or gathered with its kind.
  const slot = new Map<string, number>();
  unplaced.forEach((id, k) => {
    if (!slot.has(id)) slot.set(id, k);
  });
  const order = [...slot.keys()].sort(cmp);
  const byHome = new Map<string, string[]>();
  const homeless = new Map<string, string[]>();
  for (const id of order) {
    const kind = typeOf(id);
    const home = homeOf(kind);
    if (home === null) (homeless.get(kind) ?? homeless.set(kind, []).get(kind)!).push(id);
    else (byHome.get(home) ?? byHome.set(home, []).get(home)!).push(id);
  }

  // Everything placed so far, the method's points first in id order: each floor point stands clear of all of it.
  const taken = new Float64Array(3 * (ids.length + slot.size));
  let count = 0;
  for (const k of byId) {
    taken[3 * count] = points[3 * k];
    taken[3 * count + 1] = points[3 * k + 1];
    taken[3 * count + 2] = points[3 * k + 2];
    count++;
  }
  // A ball: the first at its middle, each next at the radius that holds those before it, on a golden
  // sequence; each point then moved along `away` until it is clear.
  const ball = (list: readonly string[], centre: Vec3, away: Vec3): void => {
    list.forEach((id, k) => {
      const r = k === 0 ? 0 : ballOf(k) + REST / 2;
      const a = k * TURN;
      const cz = 1 - 2 * ((k * PHI) % 1);
      const s = Math.sqrt(Math.max(0, 1 - cz * cz));
      const p = clearOf(add(centre, scale([s * Math.cos(a), s * Math.sin(a), cz], r)), away, taken, count, FLOOR_GAP, STEP);
      const j = slot.get(id)!;
      out[3 * j] = p[0];
      out[3 * j + 1] = p[1];
      out[3 * j + 2] = p[2];
      taken[3 * count] = p[0];
      taken[3 * count + 1] = p[1];
      taken[3 * count + 2] = p[2];
      count++;
    });
  };
  let moved = 0;
  for (const x of groups) {
    const list = byHome.get(x.g);
    if (!list) continue;
    const d = sub(x.c, body.c);
    const l = len(d);
    const dir: Vec3 = l > 1e-9 ? scale(d, 1 / l) : [1, 0, 0];
    ball(list, add(x.c, scale(dir, x.r + REST + outer(list.length))), dir);
    moved += list.length;
  }
  // Kinds no group holds: a row of balls under everything placed (the method's points and the home
  // balls), by kind, centred under the body; a point not clear moves down.
  const kinds = [...homeless.keys()].sort(cmp);
  let gathered = 0;
  if (kinds.length) {
    const radii = kinds.map((k) => outer(homeless.get(k)!.length));
    const xs: number[] = [];
    let x = 0;
    radii.forEach((r, j) => {
      if (j) x += radii[j - 1] + REST + r;
      xs.push(x);
    });
    const mid = xs[xs.length - 1] / 2;
    const top = Math.max(...radii);
    let low = Infinity;
    for (let k = 0; k < count; k++) low = Math.min(low, taken[3 * k + 2]);
    const z = count ? low - REST - top : 0;
    kinds.forEach((k, j) => {
      ball(homeless.get(k)!, [body.c[0] + xs[j] - mid, body.c[1], z], [0, 0, -1]);
      gathered += homeless.get(k)!.length;
    });
  }
  return { floor: out, moved, gathered, gatheredKinds: kinds.filter((k) => k !== '') };
}

export interface FloorDrawn {
  /** Every element drawn: the placed, then the floor's (by id, each once). */
  ids: string[];
  /** x, y, z of `ids[i]` at `3 * i`, in whole units: the placed as the hold keeps them, the floor's rounded the same way. */
  points: Float64Array;
  moved: number;
  gathered: number;
  gatheredKinds: string[];
}

/**
 * The picture as the mapper draws it: the method's points rounded as the hold keeps them, then the
 * floor (`floorOf` over the method's own points, so it agrees with the dashboard's), rounded the
 * same way (half to even, as the SDK rounds). `rounded` is `points` rounded.
 */
export function floorBesideGroups(input: FloorInput & { rounded: ArrayLike<number> }): FloorDrawn {
  const placed = new Set(input.ids);
  const unplaced = [...new Set(input.unplaced)].filter((id) => !placed.has(id)).sort(cmp);
  const f = floorOf({ ...input, unplaced });
  const n = input.ids.length;
  const points = new Float64Array(3 * (n + unplaced.length));
  points.set(Array.from(input.rounded).slice(0, 3 * n));
  for (let i = 0; i < f.floor.length; i++) points[3 * n + i] = roundHalfEven(f.floor[i]) + 0;
  return { ids: [...input.ids, ...unplaced], points, moved: f.moved, gathered: f.gathered, gatheredKinds: f.gatheredKinds };
}
