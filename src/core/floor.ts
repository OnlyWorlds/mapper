// The floor drawn beside the groups (a try, OW Mapping's pick 2): what `layoutByLinks3d` puts on its
// shelf (`part` 'no-link': nothing links it to the main piece) is drawn beside the group where most
// elements of its kind stand, a piece of shelf elements linked to each other moved as one block.
// The method's points are never changed: this is the mapper's drawing of them, so the hold keeps
// what the method answered and the next press hands that back. Pure.
import { BY_LINKS_3D_REST } from '@onlyworlds/sdk';

/** What the drawing reads from the layout's answer, one entry per element, in the answer's order. */
export interface FloorInput {
  ids: readonly string[];
  /** x, y, z of `ids[i]` at `3 * i` (rounded). */
  points: ArrayLike<number>;
  /** The method's `group`: the centre the element stands with, or null. */
  group: readonly (string | null)[];
  /** The method's `part`: 'no-link' for a shelf element. */
  part: readonly (string | null)[];
  /** The shelf piece an element belongs to (shelf elements linked to each other share one), else -1. */
  piece: ArrayLike<number>;
  /** The element's type, or null when unknown. */
  typeOf: (id: string) => string | null;
}

export interface FloorDrawn {
  /** The points to draw: a copy, the shelf pieces moved, everything else as answered. */
  points: Float64Array;
  /** Shelf elements moved beside a group. */
  moved: number;
  /** Shelf elements whose kind stands in no group, gathered as a cluster of their kind where they stood. */
  gathered: number;
  /** The kinds gathered so (each once). */
  gatheredKinds: string[];
}

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a: V): V | null => { const l = len(a); return l > 1e-9 ? scale(a, 1 / l) : null; };

/** The golden angle: each next block turned from the last. */
const TURN = Math.PI * (3 - Math.sqrt(5));

/** The kind most of these ids hold (a tie to the kind first in code point order); null for none. */
function mostOf(kinds: Iterable<string | null>): string | null {
  const n = new Map<string, number>();
  for (const k of kinds) if (k !== null) n.set(k, (n.get(k) ?? 0) + 1);
  let best: string | null = null;
  for (const [k, c] of n) if (best === null || c > n.get(best)! || (c === n.get(best)! && k < best)) best = k;
  return best;
}

function centreOf(idx: readonly number[], p: ArrayLike<number>): { c: V; r: number } {
  let c: V = [0, 0, 0];
  for (const i of idx) c = add(c, [p[3 * i], p[3 * i + 1], p[3 * i + 2]]);
  c = scale(c, 1 / idx.length);
  let r = 0;
  for (const i of idx) r = Math.max(r, len(sub([p[3 * i], p[3 * i + 1], p[3 * i + 2]], c)));
  return { c, r };
}

export function floorBesideGroups(input: FloorInput): FloorDrawn {
  const { ids, points, group, part, piece, typeOf } = input;
  const out = Float64Array.from(points);
  const kind = ids.map((id) => typeOf(id));

  // The groups: their members, and per kind the group that holds most of it (a tie to the smaller id).
  const members = new Map<string, number[]>();
  for (let i = 0; i < ids.length; i++) {
    const g = group[i];
    if (g !== null) (members.get(g) ?? members.set(g, []).get(g)!).push(i);
  }
  // Where each body element stands: its group, or (an arm, a link, a pinned element: the method
  // names no group for them) the group whose centre is nearest, so a kind that hangs off the body
  // still has a home.
  const centres = [...members].map(([g, idx]) => ({ g, c: centreOf(idx, points).c }));
  const standsIn = (i: number): string | null => {
    if (group[i] !== null) return group[i];
    if (part[i] === 'no-link' || !centres.length) return null;
    const p: V = [points[3 * i], points[3 * i + 1], points[3 * i + 2]];
    let best = centres[0];
    for (const c of centres) if (len(sub(p, c.c)) < len(sub(p, best.c))) best = c;
    return best.g;
  };
  const perKind = new Map<string, Map<string, number>>();
  for (let i = 0; i < ids.length; i++) {
    const k = kind[i];
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

  // The shelf's blocks: each piece whole, its kind the one most of it holds.
  const blocks = new Map<number, number[]>();
  for (let i = 0; i < ids.length; i++) {
    if (part[i] !== 'no-link') continue;
    const b = piece[i] >= 0 ? piece[i] : -1 - i; // a lone element is a block of its own
    (blocks.get(b) ?? blocks.set(b, []).get(b)!).push(i);
  }
  const byHome = new Map<string, number[][]>();
  const homeless = new Map<string, number[][]>();
  for (const idx of blocks.values()) {
    const k = mostOf(idx.map((i) => kind[i])) ?? '';
    const home = homeOf(k || null);
    if (home === null) (homeless.get(k) ?? homeless.set(k, []).get(k)!).push(idx);
    else (byHome.get(home) ?? byHome.set(home, []).get(home)!).push(idx);
  }

  // Equal pieces by their first id, so a press draws the same; each block moved whole, by whole units.
  // Blocks packed as a ball by their own sizes: the largest at the middle, each next one at the
  // radius that holds the volume of those before it, its direction the next of a golden sequence
  // over the sphere. `centre` is handed the ball's radius, to stand it clear of its group.
  const place = (list: number[][], centre: (radius: number) => V): number => {
    list.sort((a, b) => b.length - a.length || (ids[a[0]] < ids[b[0]] ? -1 : 1));
    const sizes = list.map((idx) => centreOf(idx, points));
    const room = sizes.map((s) => (2 * s.r + BY_LINKS_3D_REST) ** 3);
    const ballOf = (volume: number) => Math.cbrt((3 * volume) / (4 * Math.PI));
    const ball = centre(ballOf(room.reduce((a, b) => a + b, 0)));
    let before = 0;
    let n = 0;
    list.forEach((idx, k) => {
      const r = k === 0 ? 0 : ballOf(before) + sizes[k].r + BY_LINKS_3D_REST / 2;
      before += room[k];
      const a = k * TURN;
      const cz = 1 - 2 * ((k * 0.6180339887498949) % 1);
      const s = Math.sqrt(Math.max(0, 1 - cz * cz));
      const at = add(ball, scale([s * Math.cos(a), s * Math.sin(a), cz], r));
      const shift = sub(at, sizes[k].c).map(Math.round) as V;
      for (const i of idx) for (let d = 0; d < 3; d++) out[3 * i + d] = points[3 * i + d] + shift[d] + 0;
      n += idx.length;
    });
    return n;
  };

  // The body's centre: each group's blocks go on its far side from it.
  const grouped = [...members.values()].flat();
  const body: V = grouped.length ? centreOf(grouped, points).c : [0, 0, 0];
  let moved = 0;
  for (const home of [...byHome.keys()].sort()) {
    const g = centreOf(members.get(home)!, points);
    const dir = norm(sub(g.c, body)) ?? [1, 0, 0];
    moved += place(byHome.get(home)!, (radius) => add(g.c, scale(dir, g.r + BY_LINKS_3D_REST + radius)));
  }
  // A kind no element of the body holds: its blocks gathered round where they stood on the shelf.
  let gathered = 0;
  const gatheredKinds = [...homeless.keys()].sort();
  for (const k of gatheredKinds) {
    const list = homeless.get(k)!;
    const here = centreOf(list.flat(), points).c;
    gathered += place(list, () => here);
  }
  return { points: out, moved, gathered, gatheredKinds: gatheredKinds.filter((k) => k !== '') };
}

/** Shelf pieces: shelf elements joined by a link to each other share an index; every other element -1. */
export function shelfPieces(ids: readonly string[], part: readonly (string | null)[], edges: readonly { source: string; target: string }[]): Int32Array {
  const at = new Map<string, number>();
  ids.forEach((id, i) => { if (part[i] === 'no-link') at.set(id, i); });
  const up = new Int32Array(ids.length).map((_, i) => i);
  const find = (i: number): number => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
  for (const e of edges) {
    const a = at.get(e.source), b = at.get(e.target);
    if (a === undefined || b === undefined) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) up[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const out = new Int32Array(ids.length).fill(-1);
  for (const i of at.values()) out[i] = find(i);
  return out;
}
