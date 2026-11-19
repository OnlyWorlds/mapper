// The layout profile's fixtures, run through the mapper's own call sites: the 3D method's cases
// through `layOutGraph` (what the layout's worker runs, after `worldGraph`) with the plate's rows as
// `spaceOf` hands them, and the by-kind unplaced cases through `placedOn` and `unplacedCount` (what a
// by-kind layout map's count line reads). The fixtures are copied in byte for byte and pinned by
// their SHA-256; a case the mapper never makes (a hold it would not keep, a heldUnit other than 1) is
// listed by why, never counted as passed.
import { describe, expect, it } from 'vitest';
import fx3Raw from './fixtures/layout-by-links-3d.fixture.json?raw';
import fx2Raw from './fixtures/layout.fixture.json?raw';
import { flatHold } from './hold';
import { layOutGraph } from './layout3d';
import { spaceOf } from './links3d';
import { placedOn, unplacedCount } from './unplaced';
import type { Row } from './types';

/** The bytes as published (serial 137 of the profiles; unchanged through 139). */
const SHA3 = 'acd6da7252493485cafc24356a84c53656d078872a28c695c0f7554009b6fb2a';
const SHA2 = '392b5b19b21d5beb1994692f51a8d8df3ef431f93bc279a7fc42ab0b0db508a5';

/* eslint-disable @typescript-eslint/no-explicit-any */
const fx3: any = JSON.parse(fx3Raw);
const fx2: any = JSON.parse(fx2Raw);

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Code point order, as the fixture's ties read it. */
const cp = (a: string, b: string): number => {
  const A = Array.from(a);
  const B = Array.from(b);
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const d = A[i].codePointAt(0)! - B[i].codePointAt(0)!;
    if (d) return d;
  }
  return A.length - B.length;
};

/**
 * The ring pieces' nodes, as the fixture's `compare.pieces` finds them from the graph and the want:
 * every piece but the main one (the largest, a tie to the smaller least id) of two nodes or more with
 * no node pinned (want.how 'map') and no node held (in input.held and not pinned).
 */
function ringNodes(input: any, want: any): Set<string> {
  const ids: string[] = input.nodes.map((n: any) => n.id);
  const set = new Set(ids);
  const up = new Map(ids.map((i) => [i, i]));
  const find = (x: string): string => {
    while (up.get(x) !== x) x = up.get(x)!;
    return x;
  };
  for (const e of input.edges) {
    if (e.source === e.target || !set.has(e.source) || !set.has(e.target)) continue;
    const a = find(e.source);
    const b = find(e.target);
    if (a !== b) up.set(a, b);
  }
  const pieces = new Map<string, string[]>();
  for (const i of ids) (pieces.get(find(i)) ?? pieces.set(find(i), []).get(find(i))!).push(i);
  const least = (g: string[]) => g.slice().sort(cp)[0];
  const list = [...pieces.values()].sort((a, b) => b.length - a.length || cp(least(a), least(b)));
  const how = new Map<string, string>(want.ids.map((id: string, k: number) => [id, want.how[k]]));
  const held = input.held && typeof input.held === 'object' && !Array.isArray(input.held) ? input.held : {};
  const out = new Set<string>();
  for (const g of list.slice(1)) {
    if (g.length < 2 || g.some((id) => how.get(id) === 'map') || g.some((id) => Object.hasOwn(held, id) && how.get(id) !== 'map')) continue;
    for (const id of g) out.add(id);
  }
  return out;
}

/** The answer against the want: ids, how and unplaced exact; each point exact or within 6e-8 as the fixture says. */
function mismatch(c: any, a: { ids: string[]; points: ArrayLike<number>; how: string[]; unplaced: string[] }): string | null {
  const w = c.want;
  for (const part of ['ids', 'how', 'unplaced'] as const) {
    if (JSON.stringify(a[part]) !== JSON.stringify(w[part])) return `${part}: want ${JSON.stringify(w[part]).slice(0, 120)}, got ${JSON.stringify(a[part]).slice(0, 120)}`;
  }
  if (a.points.length !== w.points.length) return `points: want ${w.points.length / 3}, got ${a.points.length / 3}`;
  const ring = ringNodes(c.input, w);
  for (let k = 0; k < w.ids.length; k++) {
    const exact = w.held[k] === true || (['centre', 'with', 'map'].includes(w.how[k]) && !ring.has(w.ids[k]));
    for (let d = 0; d < 3; d++) {
      const g = a.points[3 * k + d];
      const v = w.points[3 * k + d];
      if (exact ? g !== v : !(Math.abs(g - v) <= 6e-8)) return `point of ${w.ids[k]} (${w.how[k]}${exact ? ', exact' : ''}): want ${v}, got ${g}`;
    }
  }
  return null;
}

/** A hold as the mapper keeps one: ids to three whole numbers (it rounds before it keeps). */
function wholeHold(held: unknown): Map<string, Float64Array> | null {
  if (!held || typeof held !== 'object' || Array.isArray(held)) return null;
  const m = new Map<string, Float64Array>();
  for (const [k, v] of Object.entries(held as Record<string, unknown>)) {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isInteger(n))) return null;
    m.set(k, Float64Array.from(v));
  }
  return m;
}

/**
 * The call the mapper makes for a case, or why it makes none: no hold (null or absent, with no
 * heldUnit), or a hold of whole numbers handed with heldUnit 1, the only unit it hands.
 */
function mapperCall(input: any): { held: { ids: string[]; xyz: Float64Array } | null } | { not: string } {
  const hasHeld = 'held' in input;
  const hasUnit = 'heldUnit' in input;
  // A heldUnit of null is no unit (absent or null: 0), so with nothing held it is the call with no options.
  if (!hasHeld || input.held === null) return hasUnit && input.heldUnit !== null ? { not: 'a heldUnit with nothing held; the mapper hands a unit only with a hold' } : { held: null };
  const m = wholeHold(input.held);
  if (!m) return { not: 'a held that is not ids to three whole numbers; the mapper rounds what it keeps' };
  if (!hasUnit) return { not: 'whole numbers held with no heldUnit; the mapper hands heldUnit 1' };
  if (input.heldUnit !== 1) return { not: 'a heldUnit other than 1; the mapper hands heldUnit 1' };
  return { held: flatHold(m) };
}

/**
 * The one case the mapper's press answers otherwise: it reads no Markers, and map-space measures a
 * Map with no written size from its Pins and Markers, so a Marker past the Pins makes a larger plate.
 */
const NO_MARKERS = 'a Marker measuring a Map';

/** The case's rows as the mapper hands them: its Maps and Pins through `spaceOf` (no Marker or Zone). */
function spaceFor(rows: Row[] | null): Row[] {
  const list = rows ?? [];
  return spaceOf(list.filter((r) => r.type === 'map'), list.filter((r) => r.type === 'pin'));
}

describe('the fixtures as copied', () => {
  it('are the published bytes', async () => {
    expect(await sha256(fx3Raw)).toBe(SHA3);
    expect(await sha256(fx2Raw)).toBe(SHA2);
    expect(fx3.method).toBe('by-links-3d');
    expect(fx3.cases).toHaveLength(116);
    expect(fx3.unplaced).toHaveLength(9);
    expect(fx2.unplaced).toHaveLength(17);
  });
});

describe('by-links-3d: every case the mapper can hand, through its own call', () => {
  const ran: string[] = [];
  const failed: string[] = [];
  const notHanded = new Map<string, string[]>();
  for (const c of fx3.cases) {
    const call = mapperCall(c.input);
    if ('not' in call) {
      (notHanded.get(call.not) ?? notHanded.set(call.not, []).get(call.not)!).push(c.name);
      continue;
    }
    ran.push(c.name);
    it(c.name, () => {
      const graph = { nodes: c.input.nodes, edges: c.input.edges };
      const space = spaceFor(c.input.rows);
      let got;
      try {
        got = layOutGraph(graph, space, call.held);
      } catch (err) {
        failed.push(c.name);
        throw err;
      }
      if (c.want.refused) {
        // A refused hold is dropped and the world laid out from nothing, its code reported.
        expect(got.refused).toBe(c.want.refused);
        expect(got.heldUsed).toBe(false);
        return;
      }
      const m = mismatch(c, got);
      if (c.name === NO_MARKERS) {
        // Red as the press hands it; equal to the want once its Markers and Zones are handed too.
        expect(m).not.toBeNull();
        const withMarkers = [...space, ...c.input.rows.filter((r: Row) => r.type === 'marker' || r.type === 'zone')];
        expect(mismatch(c, layOutGraph(graph, withMarkers, call.held))).toBeNull();
        return;
      }
      if (m) failed.push(c.name);
      expect(m).toBeNull();
      expect(got.refused).toBeNull();
      // What is drawn is only what is placed: no unplaced id among the placed, one point each.
      const placed = new Set(got.ids);
      expect(got.unplaced.some((x) => placed.has(x))).toBe(false);
      expect(got.points.length).toBe(3 * got.ids.length);
      expect(got.ids.length + got.unplaced.length).toBe(c.input.nodes.length);
    });
  }

  it('runs 68 of the 116, and says why it runs none of the rest', () => {
    expect(failed).toEqual([]);
    expect(ran).toHaveLength(68);
    const counts = Object.fromEntries([...notHanded].map(([why, names]) => [why, names.length]));
    expect(counts).toEqual({
      'a held that is not ids to three whole numbers; the mapper rounds what it keeps': 26,
      'whole numbers held with no heldUnit; the mapper hands heldUnit 1': 16,
      'a heldUnit with nothing held; the mapper hands a unit only with a hold': 1,
      'a heldUnit other than 1; the mapper hands heldUnit 1': 5,
    });
  });

  it('whole numbers held with no heldUnit, handed as the mapper hands them (heldUnit 1): a different call, its answers kept on record', () => {
    const verdicts: string[] = [];
    const these = notHanded.get('whole numbers held with no heldUnit; the mapper hands heldUnit 1')!;
    for (const c of fx3.cases) {
      if (!these.includes(c.name)) continue;
      const got = layOutGraph({ nodes: c.input.nodes, edges: c.input.edges }, spaceFor(c.input.rows), flatHold(wholeHold(c.input.held)!));
      if (c.want.refused) verdicts.push(`${c.name}: ${got.refused === c.want.refused ? 'equal' : `refused ${got.refused}`}`);
      else verdicts.push(`${c.name}: ${mismatch(c, got) === null && got.refused === null ? 'equal' : 'differs'}`);
    }
    expect(verdicts).toHaveLength(16);
    // Only the case written to show what the unit changes answers otherwise.
    expect(verdicts.filter((v) => !v.endsWith(': equal'))).toEqual(['held: an earlier answer rounded to whole numbers, with no heldUnit: differs']);
  });
});

describe('the 2D unplaced cases: a by-kind map through its count', () => {
  for (const u of fx2.unplaced) {
    if (u.method !== 'by-kind') continue;
    it(u.name, () => {
      // The Map's Pins as `mapSpace` serves them, each member of `placed` an element_id.
      const pins = u.placed.map((m: unknown, k: number) => ({ id: `pin${k}`, map: 'M', element_id: m }));
      const placed = placedOn('M', pins);
      expect(unplacedCount({ nodes: u.graph.nodes, edges: u.graph.edges }, placed)).toBe(u.want.length);
    });
  }

  it('counts the 8 by-kind cases; an around map is never counted (its focus and steps are not on its mark)', () => {
    expect(fx2.unplaced.filter((u: any) => u.method === 'by-kind')).toHaveLength(8);
    expect(fx2.unplaced.filter((u: any) => u.method === 'around')).toHaveLength(9);
  });
});
