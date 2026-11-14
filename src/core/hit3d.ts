// The pointer in 3D asks the same list as projected: Pins by screen distance to their projected
// point (the nearest first, ties by depth then id; on a phone every Pin within the radius), then a
// placed label's box, then a link line or a line Zone by screen distance to its projected segments,
// then a polygon Zone where the press's ray meets its plane, smallest area first. A point behind the
// camera never answers. The projection is the 3D surface's; this module only measures.
import { pick, segDist, type Grid, type PlacedLabel } from './hit';
import type { Item, ItemKind, LineItem, PinItem, ZoneItem } from './types';

export interface Projector {
  /** A point in the Map's frame (z up) on screen, CSS pixels, and its depth (0 near to 1 far); null behind the camera or past its far plane. */
  project(x: number, y: number, z: number): [number, number, number] | null;
  /** A segment on screen, cut at the camera's near plane; null when it lies wholly behind the camera. */
  projectSegment(a: [number, number, number], b: [number, number, number]): [[number, number], [number, number]] | null;
  /** Where the press's ray meets the level plane at height `z`, in the Map's frame; null when it does not, or behind the camera. */
  onPlane(sx: number, sy: number, z: number): [number, number] | null;
}

type V3 = [number, number, number];

/**
 * A segment in camera space (the camera looks down -z) cut at the near plane: null when it lies
 * wholly behind; else its ends, one moved onto the plane when it was behind. Projecting an end that
 * is behind the camera mirrors it across the screen, so a line would answer where nothing is drawn.
 */
export function clipToNear(a: V3, b: V3, near: number): [V3, V3] | null {
  const behind = (v: V3) => v[2] > -near;
  if (behind(a) && behind(b)) return null;
  const cut = (p: V3, q: V3): V3 => {
    const t = (p[2] + near) / (p[2] - q[2]);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, -near];
  };
  if (behind(a)) return [cut(a, b), b];
  if (behind(b)) return [a, cut(b, a)];
  return [a, b];
}

export interface Pick3DQuery {
  sx: number;
  sy: number;
  /** The radius in CSS pixels. */
  r: number;
  hidden: ReadonlySet<ItemKind>;
  labels: readonly PlacedLabel[];
  /** A phone's press: every Pin within the radius, not only the nearest. */
  many: boolean;
  /** The height a Zone is drawn at. */
  zoneZ: number;
}

/** The distance on screen from the press to a run of segments, each cut at the near plane; Infinity when none is in front. */
function projectedDist(pr: Projector, pts: readonly [number, number, number][], sx: number, sy: number): number {
  let best = Infinity;
  if (pts.length === 1) {
    const p = pr.project(...pts[0]);
    return p ? Math.hypot(sx - p[0], sy - p[1]) : Infinity;
  }
  for (let i = 1; i < pts.length; i++) {
    const s = pr.projectSegment(pts[i - 1], pts[i]);
    if (s) best = Math.min(best, segDist(sx, sy, s[0][0], s[0][1], s[1][0], s[1][1]));
  }
  return best;
}

export function pick3d(items: readonly Item[], grid: Grid, pr: Projector, q: Pick3DQuery): string[] {
  if (!q.hidden.has('pin')) {
    const pins: [PinItem, number, number][] = [];
    for (const it of items) {
      if (it.kind !== 'pin') continue;
      const p = pr.project(it.x, it.y, it.z);
      if (!p) continue;
      const d = Math.hypot(p[0] - q.sx, p[1] - q.sy);
      if (d <= q.r) pins.push([it, d, p[2]]);
    }
    if (pins.length) {
      pins.sort((a, b) => a[1] - b[1] || a[2] - b[2] || (a[0].id < b[0].id ? -1 : 1));
      return q.many ? pins.map(([p]) => p.id) : [pins[0][0].id];
    }
  }
  if (!q.hidden.has('label')) {
    for (const l of q.labels) {
      const [x0, y0, x1, y1] = l.rect;
      if (q.sx >= x0 && q.sx <= x1 && q.sy >= y0 && q.sy <= y1) return [l.anchor];
    }
  }
  let bestLine: [string, number] | null = null;
  for (const it of items) {
    let d = Infinity;
    if (it.kind === 'line' && !q.hidden.has('line')) {
      const l = it as LineItem;
      d = projectedDist(pr, [[l.ax, l.ay, l.az], [l.bx, l.by, l.bz]], q.sx, q.sy);
    } else if (it.kind === 'zone' && it.shape === 'line' && !q.hidden.has('zone')) {
      d = projectedDist(pr, (it as ZoneItem).points.map(([x, y]) => [x, y, q.zoneZ] as [number, number, number]), q.sx, q.sy);
    } else continue;
    if (d <= q.r && (!bestLine || d < bestLine[1] || (d === bestLine[1] && it.id < bestLine[0]))) bestLine = [it.id, d];
  }
  if (bestLine) return [bestLine[0]];
  if (q.hidden.has('zone')) return [];
  const at = pr.onPlane(q.sx, q.sy, q.zoneZ);
  if (!at) return [];
  // Only the polygon stage of the flat pick answers: every other kind is hidden from it.
  const only = new Set<ItemKind>(['pin', 'line', 'label']);
  return pick(grid, { x: at[0], y: at[1], r: 0, sx: q.sx, sy: q.sy, hidden: only, labels: [], many: false }).filter((id) => id.startsWith('zone:'));
}
