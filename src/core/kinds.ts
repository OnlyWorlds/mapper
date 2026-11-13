// The kinds of Map, as the list words them and the page draws them:
//   a picture        a plain Map with a picture: flat, its picture, Zones and Pins
//   a plan           a plain Map without one: flat on a blank frame of its width and height
//   a layout         a layout map without a depth: flat
//   a layout · 3D    a layout map with a depth: 3D in a later version, drawn flat in this one
// A plain Map with a depth is drawn flat, with one line naming its depth. Whether a Map is a layout
// map, and its ground, are `layoutOf`'s answer, never read here.
import { layoutOf } from '@onlyworlds/sdk';
import { httpsUrl, str, whole } from './rows';
import type { Row } from './types';

export type MapKind = 'picture' | 'plan' | 'layout' | 'layout3d';

export interface MapReading {
  id: string;
  name: string;
  kind: MapKind;
  /** The list's words for the kind. */
  words: string;
  /** The picture's address when it is `https:`, else null. */
  picture: string | null;
  /** True when the Map names a picture that is not on an `https:` address (never drawn). */
  pictureRefused: boolean;
  width: number | null;
  height: number | null;
  /** A whole, positive depth, else null. */
  depth: number | null;
  /** `layoutOf`'s method, or null for a plain Map. */
  layout: string | null;
  /** `layoutOf`'s ground: another served Map's id, or null. */
  ground: string | null;
  /** Where the ground sits: [margin, margin] when the method's own settings give a whole `margin`, else [0, 0]. */
  groundOffset: [number, number];
  /** True when the offset was read from `settings.margin`. */
  marginRead: boolean;
}

export const KIND_WORDS: Record<MapKind, string> = {
  picture: 'a picture',
  plan: 'a plan',
  layout: 'a layout',
  layout3d: 'a layout · 3D',
};

export function readMap(map: Row, maps: readonly Row[], pins: readonly Row[] = []): MapReading {
  const lo = layoutOf(map, maps, pins);
  const raw = map.image_url;
  const picture = httpsUrl(raw);
  const pictureRefused = !picture && typeof raw === 'string' && raw.trim() !== '';
  const d = whole(map.depth);
  const depth = d !== null && d > 0 ? d : null;
  const kind: MapKind = lo.layout !== null ? (depth !== null ? 'layout3d' : 'layout') : picture ? 'picture' : 'plan';
  let margin: number | null = null;
  if (lo.layout !== null) {
    const xl = map.x_layout as { settings?: { margin?: unknown } } | undefined;
    margin = whole(xl?.settings?.margin);
  }
  return {
    id: map.id,
    name: str(map, 'name') ?? 'A map with no name',
    kind,
    words: KIND_WORDS[kind],
    picture,
    pictureRefused,
    width: whole(map.width),
    height: whole(map.height),
    depth,
    layout: lo.layout,
    ground: lo.ground,
    groundOffset: margin !== null ? [margin, margin] : [0, 0],
    marginRead: margin !== null,
  };
}

/** Lines are always drawn on a layout map; on a plain Map they wait for the button. */
export function linesAlwaysOn(kind: MapKind): boolean {
  return kind === 'layout' || kind === 'layout3d';
}

/**
 * The order an element's Maps are offered in, and the first one opened: a plain Map with a picture,
 * then a plain Map, then a layout map; within each, the most Pins (when counted), then the name.
 */
export function elementMapOrder(maps: readonly MapReading[], pinCount: (id: string) => number | null): MapReading[] {
  const rank = (k: MapKind) => (k === 'picture' ? 0 : k === 'plan' ? 1 : 2);
  return [...maps].sort((a, b) => {
    const r = rank(a.kind) - rank(b.kind);
    if (r) return r;
    const pa = pinCount(a.id) ?? -1;
    const pb = pinCount(b.id) ?? -1;
    if (pa !== pb) return pb - pa;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1);
  });
}
