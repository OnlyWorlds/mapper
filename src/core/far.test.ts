// A stranger's far coordinate: one Pin or Marker far past the frame (a typo, x 100000 for 1000)
// keeps the derive cheap and the hit index bounded, and the far item still answers the pointer.
import { describe, expect, it } from 'vitest';
import { OVERSIZE, pick } from './hit';
import { readMap } from './kinds';
import { build, GraphCache } from './scene';
import type { ItemKind, Row } from './types';

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const MAP = id(1);
const map: Row = { id: MAP, type: 'map', name: 'M', width: 1000, height: 1000 };

function scene(far: number) {
  const maps = [map];
  const pins: Row[] = [
    { id: id(30), type: 'pin', map: MAP, element_type: 'location', element_id: id(20), x: 100, y: 100 },
    { id: id(31), type: 'pin', map: MAP, element_type: 'location', element_id: id(21), x: far, y: far },
  ];
  const markers: Row[] = [
    { id: id(40), type: 'marker', map: MAP, zone: id(50), x: 200, y: 200, order: 0 },
    { id: id(41), type: 'marker', map: MAP, zone: id(50), x: far, y: 300, order: 1 },
    { id: id(42), type: 'marker', map: MAP, zone: id(50), x: 300, y: -far, order: 2 },
  ];
  const zones: Row[] = [{ id: id(50), type: 'zone', name: 'Far reach', shape: 'polygon' }];
  const bodies: Row[] = [
    { id: id(20), type: 'location', name: 'Near', parent_location: id(21) },
    { id: id(21), type: 'location', name: 'Far' },
  ];
  const reading = readMap(map, maps, pins);
  const t0 = performance.now();
  const s = build({ slice: { mapId: MAP, groundId: null, maps, pins, markers, zones, bodies, pinned: [id(20), id(21)] }, reading, ground: null, rung: 'public', complete: true, pictureSize: null, versionOf: () => 1 }, new GraphCache());
  return { s, ms: performance.now() - t0 };
}

const none = new Set<ItemKind>();

describe('a far coordinate', () => {
  for (const far of [10_000, 100_000, 1_000_000, 1e12]) {
    it(`a linked Pin and a Zone Marker at ${far} on a 1000 map derive at once, with a bounded index`, () => {
      const { s, ms } = scene(far);
      expect(s.counts.lines).toBe(1);
      expect(s.counts.zones).toBe(1);
      expect(ms).toBeLessThan(250);
      // The index never holds more than its bounded cells: (64 + 2)² for the whole frame and its edge.
      expect(s.grid.entries).toBeLessThanOrEqual(3 * OVERSIZE);
      // The far Pin answers where it is written, and the link line answers near the near Pin.
      const farPin = pick(s.grid, { x: far, y: far, r: 10, sx: 0, sy: 0, hidden: none, labels: [], many: false });
      expect(farPin).toEqual([`pin:${id(31)}`]);
      const onLine = pick(s.grid, { x: 150, y: 150, r: 10, sx: 0, sy: 0, hidden: none, labels: [], many: false });
      expect(onLine[0]?.startsWith('line:')).toBe(true);
    }, 20_000);
  }
});
