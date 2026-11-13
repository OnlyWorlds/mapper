// The pointer asks the list: a uniform grid over the items' boxes in the Map's frame, rebuilt with
// the list, and the pointer's order. Never a DOM node, never a pixel's colour.
//   The picture never answers.
//   A Pin, the nearest within the radius (on a phone, every Pin within it, for the card to list).
//   A label, as its anchor.
//   A line Zone or a link line, the nearest within the radius.
//   A polygon Zone, the smallest by area that holds the point.
import type { Item, ItemKind, LineItem, PinItem, ZoneItem } from './types';

type Box = [number, number, number, number];

function boxOf(it: Item): Box | null {
  switch (it.kind) {
    case 'pin':
      return [it.x, it.y, it.x, it.y];
    case 'zone':
      return it.bbox;
    case 'line':
      return [Math.min(it.ax, it.bx), Math.min(it.ay, it.by), Math.max(it.ax, it.bx), Math.max(it.ay, it.by)];
    default:
      return null;
  }
}

/** The grid's cells across the frame's longer side. */
const ACROSS = 64;
/** An item whose box covers more cells than this is kept on one list every query scans. */
export const OVERSIZE = 256;

/**
 * A grid bounded by the frame whatever the coordinates: the cells cover the frame, with one ring of
 * edge cells that hold everything past it (a stranger's Pin at x 100000 on a 1000 map folds into
 * the edge), so it never has more than (ACROSS + 2)² cells. An item and a query are clamped the
 * same way, so a box that touches an item's box still finds it; the exact test is the caller's.
 */
export class Grid {
  readonly cell: number;
  private nx: number;
  private ny: number;
  private cells: (Item[] | undefined)[];
  private oversize: Item[] = [];
  /** Cell entries made, for a test to bound. */
  entries = 0;

  constructor(items: readonly Item[], frameW: number, frameH: number) {
    const fw = Number.isFinite(frameW) && frameW > 0 ? frameW : 1000;
    const fh = Number.isFinite(frameH) && frameH > 0 ? frameH : 1000;
    this.cell = Math.max(1e-9, Math.max(fw, fh) / ACROSS);
    this.nx = Math.ceil(fw / this.cell) + 2;
    this.ny = Math.ceil(fh / this.cell) + 2;
    this.cells = new Array(this.nx * this.ny);
    for (const it of items) {
      const b = boxOf(it);
      if (!b) continue;
      const [gx0, gy0, gx1, gy1] = this.span(b);
      if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > OVERSIZE) {
        this.oversize.push(it);
        continue;
      }
      for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
        const k = gx * this.ny + gy;
        const list = this.cells[k];
        if (list) list.push(it);
        else this.cells[k] = [it];
        this.entries++;
      }
    }
  }

  /** A coordinate's cell, from 0 (everything before the frame) to n - 1 (everything past it). */
  private at(v: number, n: number): number {
    if (Number.isNaN(v)) return 0;
    const g = Math.floor(v / this.cell) + 1;
    return g < 0 ? 0 : g > n - 1 ? n - 1 : g;
  }

  private span(b: Box): [number, number, number, number] {
    return [this.at(b[0], this.nx), this.at(b[1], this.ny), this.at(b[2], this.nx), this.at(b[3], this.ny)];
  }

  /** Every item whose box may touch this box. */
  query(b: Box): Set<Item> {
    const out = new Set<Item>(this.oversize);
    const [gx0, gy0, gx1, gy1] = this.span(b);
    for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
      const list = this.cells[gx * this.ny + gy];
      if (list) for (const it of list) out.add(it);
    }
    return out;
  }
}

export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function inside(points: readonly [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function polylineDist(z: ZoneItem, x: number, y: number): number {
  let best = Infinity;
  const p = z.points;
  if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]);
  for (let i = 1; i < p.length; i++) best = Math.min(best, segDist(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]));
  return best;
}

export interface PlacedLabel {
  anchor: string;
  /** In screen CSS pixels: left, top, right, bottom. */
  rect: Box;
}

export interface PickQuery {
  /** The point in the Map's frame. */
  x: number;
  y: number;
  /** The radius in Map units. */
  r: number;
  /** The same point on screen, for the labels. */
  sx: number;
  sy: number;
  /** Kinds the view hides (lines off): neither drawn nor answering. */
  hidden: ReadonlySet<ItemKind>;
  labels: readonly PlacedLabel[];
  /** A phone's press: every Pin within the radius, not only the nearest. */
  many: boolean;
}

/** The item ids under the pointer, best first: one item, or on a phone several Pins. */
export function pick(grid: Grid, q: PickQuery): string[] {
  const near = grid.query([q.x - q.r, q.y - q.r, q.x + q.r, q.y + q.r]);
  const pins: [PinItem, number][] = [];
  for (const it of near) {
    if (it.kind !== 'pin' || q.hidden.has('pin')) continue;
    const d = Math.hypot(it.x - q.x, it.y - q.y);
    if (d <= q.r) pins.push([it, d]);
  }
  if (pins.length) {
    pins.sort((a, b) => a[1] - b[1] || (a[0].id < b[0].id ? -1 : 1));
    return q.many ? pins.map(([p]) => p.id) : [pins[0][0].id];
  }
  if (!q.hidden.has('label')) {
    for (const l of q.labels) {
      const [x0, y0, x1, y1] = l.rect;
      if (q.sx >= x0 && q.sx <= x1 && q.sy >= y0 && q.sy <= y1) return [l.anchor];
    }
  }
  let bestLine: [string, number] | null = null;
  for (const it of near) {
    let d = Infinity;
    if (it.kind === 'zone' && it.shape === 'line' && !q.hidden.has('zone')) d = polylineDist(it, q.x, q.y);
    else if (it.kind === 'line' && !q.hidden.has('line')) {
      const l = it as LineItem;
      d = segDist(q.x, q.y, l.ax, l.ay, l.bx, l.by);
    }
    if (d <= q.r && (!bestLine || d < bestLine[1] || (d === bestLine[1] && it.id < bestLine[0]))) bestLine = [it.id, d];
  }
  if (bestLine) return [bestLine[0]];
  if (q.hidden.has('zone')) return [];
  const here = grid.query([q.x, q.y, q.x, q.y]);
  let bestZone: ZoneItem | null = null;
  for (const it of here) {
    if (it.kind !== 'zone' || it.shape !== 'polygon') continue;
    const [x0, y0, x1, y1] = it.bbox;
    if (q.x < x0 || q.x > x1 || q.y < y0 || q.y > y1 || !inside(it.points, q.x, q.y)) continue;
    if (!bestZone || it.area < bestZone.area || (it.area === bestZone.area && it.id < bestZone.id)) bestZone = it;
  }
  return bestZone ? [bestZone.id] : [];
}
