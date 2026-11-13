// The opened Map's slice of the store: what the builder is handed, and nothing more. The Maps,
// the Map's Pins and Markers (and its ground's Markers), the Zones those Markers name, and the
// bodies of its pinned elements. The SDK's readers then read exactly what this Map needs.
import { linkId } from './rows';
import type { WorldStore } from './store';
import type { Row } from './types';

export interface SliceState {
  /** Every Marker of the Map (and of its ground) has been read. */
  markersComplete: boolean;
  /** Every Zone those Markers name has been read, or found unseen. */
  zonesComplete: boolean;
}

export interface Slice {
  mapId: string;
  groundId: string | null;
  maps: Row[];
  pins: Row[];
  markers: Row[];
  zones: Row[];
  /** The bodies of the pinned elements that were served. */
  bodies: Row[];
  /** The pinned element ids, served or not. */
  pinned: string[];
}

const SPACE = new Set(['map', 'pin', 'marker']);

export function sliceFor(store: WorldStore, mapId: string, groundId: string | null, state: SliceState): Slice {
  const maps = store.ofType('map');
  const pins = store.onMap('pin', mapId);
  // Markers join only when every Marker is held, and then only those whose Zone has arrived, until
  // the Zones are complete: an outline appears whole, never dangling while a read runs.
  let markers: Row[] = [];
  if (state.markersComplete) {
    const all = [...store.onMap('marker', mapId), ...(groundId ? store.onMap('marker', groundId) : [])];
    markers = state.zonesComplete ? all : all.filter((k) => {
      const z = linkId(k.zone);
      return z !== null && store.typeOf(z) === 'zone';
    });
  }
  const zoneIds = new Set<string>();
  for (const k of markers) {
    const z = linkId(k.zone);
    if (z) zoneIds.add(z);
  }
  const zones: Row[] = [];
  for (const z of zoneIds) {
    const r = store.get(z);
    if (r && store.typeOf(z) === 'zone') zones.push(r);
  }
  const pinned = new Set<string>();
  for (const p of pins) {
    const e = typeof p.element_id === 'string' ? p.element_id : null;
    if (e) pinned.add(e);
  }
  const bodies: Row[] = [];
  for (const e of pinned) {
    const r = store.get(e);
    const t = store.typeOf(e);
    if (r && t && !SPACE.has(t)) bodies.push(r);
  }
  return { mapId, groundId, maps, pins, markers, zones, bodies, pinned: [...pinned] };
}

/** The Zone ids the Map's held Markers name that the store holds neither as a body nor as unseen. */
export function zonesToRead(store: WorldStore, mapId: string, groundId: string | null): string[] {
  const want = new Set<string>();
  for (const k of [...store.onMap('marker', mapId), ...(groundId ? store.onMap('marker', groundId) : [])]) {
    const z = linkId(k.zone);
    if (z && !store.has(z) && !store.unseen.has(z)) want.add(z);
  }
  return [...want];
}

/** The pinned elements not yet read, grouped by the type their Pin names, for reads by id. */
export function bodiesToRead(store: WorldStore, mapId: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of store.onMap('pin', mapId)) {
    const e = typeof p.element_id === 'string' ? p.element_id : null;
    const t = typeof p.element_type === 'string' ? p.element_type.toLowerCase() : null;
    if (!e || !t || store.has(e) || store.unseen.has(e)) continue;
    const list = out.get(t) ?? [];
    if (!list.includes(e)) list.push(e);
    out.set(t, list);
  }
  return out;
}

/** Split a list into calls of at most n (the API takes 200 ids a call). */
export function chunks<T>(list: readonly T[], n = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
