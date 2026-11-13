// The builder: the opened Map's slice and the reader in, the scene list out. Pure: it reads only its
// input, draws nothing and is never edited in place. It runs again when a read lands, never when
// the camera moves. Map space, layouts and links are the SDK's readers' (`mapSpace`, `worldGraph`,
// `degreeOf`), never read here.
import { degreeOf, groupOf, mapSpace, worldGraph, type ElementType, type OwLensReader, type OwMapSpace, type OwWorldGraph } from '@onlyworlds/sdk';
import { Grid } from './hit';
import type { MapReading } from './kinds';
import { cp, byName, str } from './rows';
import type { Slice } from './slice';
import type { Item, LabelItem, LineEdge, LineItem, PictureItem, PinItem, Row, ZoneItem } from './types';

/** Who reads: the public (keyless), the owner, or any other key, read over its served set. */
export type ReaderRung = 'public' | 'owner' | 'guest';

/**
 * The lens reader for a rung, over the bodies as served. A guest's `whole` is the served ids
 * without `known_of: true`, its `known_of` the ids with it.
 */
export function readerFor(rung: ReaderRung, bodies: readonly Row[]): OwLensReader {
  if (rung === 'public') return { rung: 'public' };
  if (rung === 'owner') return { rung: 'owner' };
  const whole: string[] = [];
  const known: string[] = [];
  for (const b of bodies) (b.known_of === true ? known : whole).push(b.id);
  return { rung: 'guest', whole, known_of: known };
}

export interface BuildInput {
  slice: Slice;
  reading: MapReading;
  ground: MapReading | null;
  rung: ReaderRung;
  /** Every read of the Map has landed: the `out` line and the labels wait for this. */
  complete: boolean;
  /** The picture's natural size, for a Map with no written size. */
  pictureSize: { w: number; h: number } | null;
  /** A row's version in the store (moves when its body changes): what the kept graph is checked against. */
  versionOf: (id: string) => number;
}

export interface Frame {
  w: number;
  h: number;
  /** Where the size came from. */
  from: 'written' | 'picture' | 'points' | 'none';
}

export interface Scene {
  mapId: string;
  frame: Frame;
  items: Item[];
  byId: Map<string, Item>;
  /** Each element's Pin and Zone items on this Map. */
  byElement: Map<string, string[]>;
  grid: Grid;
  /** `mapSpace`'s `out` for this Map, said only when its reads are complete; null until then. */
  out: OwMapSpace['out'] | null;
  complete: boolean;
  counts: { pins: number; zones: number; elements: number; lines: number; labels: number };
  /** The Map's own z_max as `mapSpace` read it, for a z past the depth. */
  zMax: number | null;
  /** Milliseconds the derive took. */
  ms: number;
}

/** A graph kept per Map until one of its rows changes. */
export class GraphCache {
  private kept = new Map<string, { sig: string; graph: OwWorldGraph; degree: Record<string, number> }>();
  hits = 0;
  misses = 0;

  get(mapId: string, bodies: readonly Row[], rung: ReaderRung, versionOf: (id: string) => number) {
    let sum = 0;
    for (const b of bodies) sum += versionOf(b.id);
    const sig = `${rung}|${bodies.length}|${sum}`;
    const k = this.kept.get(mapId);
    if (k && k.sig === sig) {
      this.hits++;
      return k;
    }
    this.misses++;
    const graph = worldGraph({ elements: bodies }, readerFor(rung, bodies));
    const degree = degreeOf(graph);
    const v = { sig, graph, degree };
    this.kept.set(mapId, v);
    return v;
  }
}

function pinStyle(type: string | null): string {
  if (!type) return 'pin:none';
  try {
    return 'pin:' + groupOf(type as ElementType);
  } catch {
    return 'pin:none';
  }
}

/** A Pin's item, from `mapSpace`'s reading of that one row. */
export function pinItem(p: OwMapSpace['pins'][number], type: string | null): PinItem {
  return {
    id: `pin:${p.pin}`,
    kind: 'pin',
    element: p.element_id,
    elementType: type,
    pin: p.pin,
    source: p.map,
    offset: [0, 0],
    style: pinStyle(type),
    x: p.x,
    y: p.y,
    z: p.z,
  };
}

/** A Zone's outline on one Map, placed at that Map's offset in the opened frame. */
export function zoneItem(o: OwMapSpace['zones'][number], offset: [number, number]): ZoneItem {
  const [ox, oy] = offset;
  const points = o.points.map(([x, y]) => [x + ox, y + oy] as [number, number]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  let area = 0;
  if (o.shape === 'polygon') {
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) area += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
    area = Math.abs(area / 2);
  }
  return {
    id: `zone:${o.zone}@${o.map}`,
    kind: 'zone',
    element: o.zone,
    shape: o.shape,
    source: o.map,
    offset,
    style: `zone:${o.shape}`,
    points,
    bbox: [x0, y0, x1, y1],
    area,
  };
}

/** One line per unordered pair of elements, its edges kept for the card. */
export function lineItems(edges: readonly { source: string; field: string; target: string }[], pinOf: Map<string, PinItem>): LineItem[] {
  const pairs = new Map<string, LineEdge[]>();
  for (const e of edges) {
    if (e.source === e.target || !pinOf.has(e.source) || !pinOf.has(e.target)) continue;
    const [a, b] = cp(e.source, e.target) < 0 ? [e.source, e.target] : [e.target, e.source];
    const k = `${a}~${b}`;
    const list = pairs.get(k);
    const edge = { source: e.source, field: e.field, target: e.target };
    if (list) {
      if (!list.some((x) => x.source === edge.source && x.field === edge.field && x.target === edge.target)) list.push(edge);
    } else pairs.set(k, [edge]);
  }
  const out: LineItem[] = [];
  for (const [k, list] of [...pairs].sort((x, y) => cp(x[0], y[0]))) {
    const [a, b] = k.split('~');
    const pa = pinOf.get(a)!;
    const pb = pinOf.get(b)!;
    out.push({
      id: `line:${k}`,
      kind: 'line',
      element: null,
      a,
      b,
      aPin: pa.id,
      bPin: pb.id,
      source: pa.source,
      offset: [0, 0],
      style: 'line',
      ax: pa.x,
      ay: pa.y,
      bx: pb.x,
      by: pb.y,
      edges: list,
    });
  }
  return out;
}

export function build(input: BuildInput, cache: GraphCache): Scene {
  const t0 = performance.now();
  const { slice, reading, ground } = input;
  const ms = mapSpace([...slice.maps, ...slice.pins, ...slice.markers, ...slice.zones]);
  const own = ms.maps.find((m) => m.id === slice.mapId) ?? null;

  let frame: Frame;
  if (reading.width !== null && reading.height !== null) frame = { w: reading.width, h: reading.height, from: 'written' };
  else if (input.pictureSize) frame = { w: input.pictureSize.w, h: input.pictureSize.h, from: 'picture' };
  else if (own && own.width !== null && own.height !== null) frame = { w: Math.max(1, own.width), h: Math.max(1, own.height), from: 'points' };
  else frame = { w: 1000, h: 1000, from: 'none' };

  const items: Item[] = [];
  const bodyOf = new Map<string, Row>();
  for (const b of slice.bodies) bodyOf.set(b.id, b);

  // The ground's picture under everything, then the Map's own.
  if (ground && slice.groundId) {
    const g = ms.maps.find((m) => m.id === slice.groundId);
    const gw = ground.width ?? g?.width ?? null;
    const gh = ground.height ?? g?.height ?? null;
    if (ground.picture && gw && gh) {
      const [ox, oy] = reading.groundOffset;
      items.push({ id: `picture:${ground.id}`, kind: 'picture', element: null, source: ground.id, offset: [ox, oy], style: 'picture', url: ground.picture, rect: [ox, oy, gw, gh] } satisfies PictureItem);
    }
  }
  if (reading.picture) {
    items.push({ id: `picture:${reading.id}`, kind: 'picture', element: null, source: reading.id, offset: [0, 0], style: 'picture', url: reading.picture, rect: [0, 0, frame.w, frame.h] } satisfies PictureItem);
  }

  const zones: ZoneItem[] = [];
  for (const o of ms.zones) {
    if (o.map === slice.mapId) zones.push(zoneItem(o, [0, 0]));
    else if (slice.groundId && o.map === slice.groundId) zones.push(zoneItem(o, reading.groundOffset));
  }
  items.push(...zones);

  const pins: PinItem[] = [];
  for (const p of ms.pins) {
    if (p.map !== slice.mapId) continue;
    const served = p.element_id ? bodyOf.get(p.element_id) : undefined;
    const type = served && typeof served.type === 'string' ? served.type : p.element_type;
    pins.push(pinItem(p, type ? type.toLowerCase() : null));
  }

  const { graph, degree } = cache.get(slice.mapId, slice.bodies, input.rung, input.versionOf);
  const pinOf = new Map<string, PinItem>();
  for (const p of pins) if (p.element && !pinOf.has(p.element)) pinOf.set(p.element, p);
  const lines = lineItems(graph.edges, pinOf);
  items.push(...lines);
  items.push(...pins);

  const labels: LabelItem[] = [];
  if (input.complete) {
    for (const [el, p] of pinOf) {
      const text = str(bodyOf.get(el), 'name');
      if (!text) continue;
      labels.push({ id: `label:${p.id}`, kind: 'label', element: el, anchor: p.id, text, rank: degree[el] ?? 0, source: p.source, offset: [0, 0], style: 'label', x: p.x, y: p.y });
    }
    labels.sort((a, b) => b.rank - a.rank || byName(a.text, b.text) || cp(a.id, b.id));
    items.push(...labels);
  }

  const byId = new Map<string, Item>();
  const byElement = new Map<string, string[]>();
  for (const it of items) {
    byId.set(it.id, it);
    if ((it.kind === 'pin' || it.kind === 'zone') && it.element) {
      const l = byElement.get(it.element);
      if (l) l.push(it.id);
      else byElement.set(it.element, [it.id]);
    }
  }
  const grid = new Grid(items, frame.w, frame.h);
  return {
    mapId: slice.mapId,
    frame,
    items,
    byId,
    byElement,
    grid,
    out: input.complete ? ms.out : null,
    complete: input.complete,
    counts: { pins: pins.length, zones: zones.length, elements: byElement.size, lines: lines.length, labels: labels.length },
    zMax: own?.z_max ?? null,
    ms: performance.now() - t0,
  };
}
