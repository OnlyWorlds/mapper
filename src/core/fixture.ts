// A small played world for the unit tests: a pictured Map with a Zone and Pins, a layout map over
// it as its ground, and Locations that link to each other (one link held on both ends).
import type { Row } from './types';

export const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const MAP = id(1);
export const LAYOUT = id(2);
export const ZONE = id(10);
export const A = id(20);
export const B = id(21);
export const C = id(22);
export const HIDDEN = id(23);

export function world(): { maps: Row[]; pins: Row[]; markers: Row[]; zones: Row[]; bodies: Row[] } {
  const maps: Row[] = [
    { id: MAP, type: 'map', name: 'Island', width: 1000, height: 800, image_url: 'https://media.example/island.webp' },
    { id: LAYOUT, type: 'map', name: 'Island: layout', width: 1200, height: 1000, depth: 500, x_layout: { method: 'test', settings: { ground: { map: MAP }, margin: 100 } } },
  ];
  const pins: Row[] = [
    { id: id(30), type: 'pin', name: 'pin a', map: MAP, element_type: 'location', element_id: A, x: 100, y: 100 },
    { id: id(31), type: 'pin', name: 'pin b', map: MAP, element_type: 'location', element_id: B, x: 300, y: 100 },
    { id: id(32), type: 'pin', name: 'pin c', map: MAP, element_type: 'location', element_id: C, x: 300, y: 400 },
    { id: id(33), type: 'pin', name: 'a loose pin', map: MAP, x: 900, y: 700 },
    { id: id(34), type: 'pin', name: 'pin of the unseen', map: MAP, element_type: 'location', element_id: id(99), x: 500, y: 500 },
    { id: id(40), type: 'pin', name: 'A (layout)', map: LAYOUT, element_type: 'location', element_id: A, x: 600, y: 600 },
    { id: id(41), type: 'pin', name: 'B (layout)', map: LAYOUT, element_type: 'location', element_id: B, x: 700, y: 600 },
  ];
  const markers: Row[] = [
    { id: id(50), type: 'marker', map: MAP, zone: ZONE, x: 0, y: 0, order: 0 },
    { id: id(51), type: 'marker', map: MAP, zone: ZONE, x: 400, y: 0, order: 1 },
    { id: id(52), type: 'marker', map: MAP, zone: ZONE, x: 400, y: 300, order: 2 },
    { id: id(53), type: 'marker', map: MAP, zone: ZONE, x: 0, y: 300, order: 3 },
  ];
  const zones: Row[] = [{ id: ZONE, type: 'zone', name: 'The Plain', shape: 'polygon' }];
  const bodies: Row[] = [
    { id: A, type: 'location', name: 'Akra', partner: B, rival: B },
    { id: B, type: 'location', name: 'Bela', partner: A },
    { id: C, type: 'location', name: 'Cora', parent_location: A },
  ];
  return { maps, pins, markers, zones, bodies };
}
