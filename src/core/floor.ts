// The floor beside the groups (OW Mapping's pick 2): what `layoutByLinks3d` does not place (its
// `unplaced`: linked to no other element and on no plate) is drawn by the mapper beside the group
// where most elements of its kind stand, each kind's elements packed as a ball on the far side of
// that group from the body. A kind no placed element holds gathers in a ball of its own just below
// the picture. The method's points are never changed: the floor is made after the layout from its
// answer alone, so the same answer draws the same floor, and the hold keeps only what the method
// placed. Pure.
import { BY_LINKS_3D_REST } from '@onlyworlds/sdk';

/** What the floor reads from the layout's answer. */
export interface FloorInput {
  /** The placed elements, in the answer's order. */
  ids: readonly string[];
  /** x, y, z of `ids[i]` at `3 * i` (rounded). */
  points: ArrayLike<number>;
  /** The method's `group` for `ids[i]`: the centre it stands with, or null. */
  group: readonly (string | null)[];
  /** The elements the method does not place, by id. */
  unplaced: readonly string[];
  /** The element's type, or null when unknown. */
  typeOf: (id: string) => string | null;
}

export interface FloorDrawn {
  /** Every element drawn: the placed, then the floor's. */
  ids: string[];
  /** x, y, z of `ids[i]` at `3 * i`: the placed as answered, the floor's whole numbers after them. */
  points: Float64Array;
  /** Floor elements put beside a group of their kind. */
  moved: number;
  /** Floor elements of a kind no group holds, gathered below the picture by kind. */
  gathered: number;
  /** The kinds gathered so (each once). */
  gatheredKinds: string[];
}

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a: V): V | null => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : null;
};

/** The golden angle: each next element turned from the last. */
const TURN = Math.PI * (3 - Math.sqrt(5));
/** The room one floor element takes: a cube a rest across. */
const ROOM = BY_LINKS_3D_REST ** 3;
/** The radius of a ball that holds `n` elements' room. */
const ballOf = (n: number): number => Math.cbrt((3 * n * ROOM) / (4 * Math.PI));

function centreOf(idx: readonly number[], p: ArrayLike<number>): { c: V; r: number } {
  let c: V = [0, 0, 0];
  for (const i of idx) c = add(c, [p[3 * i], p[3 * i + 1], p[3 * i + 2]]);
  c = scale(c, 1 / idx.length);
  let r = 0;
  for (const i of idx) r = Math.max(r, len(sub([p[3 * i], p[3 * i + 1], p[3 * i + 2]], c)));
  return { c, r };
}

/** Code point order, so the same ids pack the same in every runtime. */
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function floorBesideGroups(input: FloorInput): FloorDrawn {
  const { ids, points, group, unplaced, typeOf } = input;
  const n = ids.length;
  const placed = new Set(ids);
  const floorIds = [...new Set(unplaced)].filter((id) => !placed.has(id)).sort(byId);
  const out = new Float64Array(3 * (n + floorIds.length));
  out.set(Array.from(points).slice(0, 3 * n));

  // The groups: their members, and where each placed element stands (its group, or for an arm, a
  // link or a pinned element, which the method names no group, the group whose centre is nearest).
  const members = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const g = group[i];
    if (g !== null && g !== undefined) (members.get(g) ?? members.set(g, []).get(g)!).push(i);
  }
  const centres = [...members].map(([g, idx]) => ({ g, ...centreOf(idx, points) }));
  const standsIn = (i: number): string | null => {
    const g = group[i];
    if (g !== null && g !== undefined) return g;
    if (!centres.length) return null;
    const p: V = [points[3 * i], points[3 * i + 1], points[3 * i + 2]];
    let best = centres[0];
    for (const c of centres) if (len(sub(p, c.c)) < len(sub(p, best.c))) best = c;
    return best.g;
  };
  // Per kind, the group that holds most of it (a tie to the smaller id).
  const perKind = new Map<string, Map<string, number>>();
  for (let i = 0; i < n; i++) {
    const k = typeOf(ids[i]);
    const g = k === null ? null : standsIn(i);
    if (k === null || g === null) continue;
    const m = perKind.get(k) ?? perKind.set(k, new Map()).get(k)!;
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  const homeOf = (k: string | null): string | null => {
    const m = k === null ? undefined : perKind.get(k);
    if (!m) return null;
    let best: string | null = null;
    for (const [g, c] of m) if (best === null || c > m.get(best)! || (c === m.get(best)! && g < best)) best = g;
    return best;
  };

  const byHome = new Map<string, number[]>();
  const homeless = new Map<string, number[]>();
  floorIds.forEach((id, j) => {
    const k = typeOf(id);
    const home = homeOf(k);
    const at = n + j;
    if (home === null) (homeless.get(k ?? '') ?? homeless.set(k ?? '', []).get(k ?? '')!).push(at);
    else (byHome.get(home) ?? byHome.set(home, []).get(home)!).push(at);
  });

  // A ball of elements round `ball`: the first at its middle, each next at the radius that holds the
  // room of those before it, its direction the next of a golden sequence over the sphere.
  const pack = (list: number[], ball: V): void => {
    list.forEach((at, k) => {
      const r = k === 0 ? 0 : ballOf(k) + BY_LINKS_3D_REST / 2;
      const a = k * TURN;
      const cz = 1 - 2 * ((k * 0.6180339887498949) % 1);
      const s = Math.sqrt(Math.max(0, 1 - cz * cz));
      const p = add(ball, scale([s * Math.cos(a), s * Math.sin(a), cz], r));
      for (let d = 0; d < 3; d++) out[3 * at + d] = Math.round(p[d]) + 0;
    });
  };
  const outer = (count: number): number => (count <= 1 ? 0 : ballOf(count - 1) + BY_LINKS_3D_REST / 2);

  // The body's centre: each group's ball goes on its far side from it.
  const all = Array.from({ length: n }, (_, i) => i);
  const body: V = n ? centreOf(all, points).c : [0, 0, 0];
  let moved = 0;
  for (const home of [...byHome.keys()].sort(byId)) {
    const list = byHome.get(home)!;
    const g = centres.find((c) => c.g === home)!;
    const dir = norm(sub(g.c, body)) ?? [1, 0, 0];
    pack(list, add(g.c, scale(dir, g.r + BY_LINKS_3D_REST + outer(list.length))));
    moved += list.length;
  }

  // A kind no placed element holds: a ball of its own, the balls side by side just below the picture.
  const gatheredKinds = [...homeless.keys()].sort(byId);
  let zMin = 0;
  if (n) {
    zMin = Infinity;
    for (let i = 0; i < n; i++) zMin = Math.min(zMin, points[3 * i + 2]);
  }
  const radii = gatheredKinds.map((k) => outer(homeless.get(k)!.length));
  const width = radii.reduce((s, r) => s + 2 * r, 0) + BY_LINKS_3D_REST * Math.max(0, radii.length - 1);
  let x = body[0] - width / 2;
  let gathered = 0;
  gatheredKinds.forEach((k, j) => {
    const r = radii[j];
    const list = homeless.get(k)!;
    pack(list, [x + r, body[1], (n ? zMin - BY_LINKS_3D_REST : 0) - r]);
    x += 2 * r + BY_LINKS_3D_REST;
    gathered += list.length;
  });

  return { ids: [...ids, ...floorIds], points: out, moved, gathered, gatheredKinds: gatheredKinds.filter((k) => k !== '') };
}
