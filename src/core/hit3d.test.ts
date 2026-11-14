import { describe, expect, it } from 'vitest';
import { Grid } from './hit';
import { clipToNear, pick3d, type Projector } from './hit3d';
import type { Item, LineItem, PinItem, ZoneItem } from './types';

const pin = (id: string, x: number, y: number, z: number): PinItem => ({ id: `pin:${id}`, kind: 'pin', element: id, elementType: 'location', pin: id, source: 'm', offset: [0, 0], style: 'pin:none', x, y, z });

/** A camera looking straight down from z 1000 onto a 100 x 100 frame, one unit a pixel: a higher z is nearer, z 1000 and up behind it. */
const down: Projector = {
  project: (x, y, z) => (z >= 1000 ? null : [x, 100 - y, (1000 - z) / 1000]),
  projectSegment: (a, b) => (a[2] >= 1000 || b[2] >= 1000 ? null : [[a[0], 100 - a[1]], [b[0], 100 - b[1]]]),
  onPlane: (sx, sy) => [sx, 100 - sy],
};

describe('a segment cut at the near plane', () => {
  it('keeps a segment in front, drops one wholly behind, cuts one end behind onto the plane', () => {
    expect(clipToNear([0, 0, -5], [1, 1, -10], 1)).toEqual([[0, 0, -5], [1, 1, -10]]);
    expect(clipToNear([0, 0, 5], [1, 1, 0], 1)).toBeNull();
    const c = clipToNear([0, 0, 9], [10, 0, -11], 1)!;
    expect(c[0][2]).toBe(-1);
    expect(c[0][0]).toBeCloseTo(5);
    expect(c[1]).toEqual([10, 0, -11]);
    const d = clipToNear([10, 0, -11], [0, 0, 9], 1)!;
    expect(d[1][2]).toBe(-1);
    expect(d[1][0]).toBeCloseTo(5);
  });
});

const base = { r: 8, hidden: new Set<never>(), labels: [], many: false, zoneZ: 0 };

describe('the pointer in 3D', () => {
  it('takes the nearest projected Pin, ties by depth', () => {
    const items: Item[] = [pin('a', 50, 50, 10), pin('b', 50, 50, 900), pin('c', 56, 50, 0)];
    const grid = new Grid(items, 100, 100);
    expect(pick3d(items, grid, down, { ...base, sx: 50, sy: 50 })).toEqual(['pin:b']);
    expect(pick3d(items, grid, down, { ...base, sx: 50, sy: 50, many: true })).toEqual(['pin:b', 'pin:a', 'pin:c']);
  });

  it('never answers with a point behind the camera', () => {
    const items: Item[] = [pin('a', 50, 50, 1200)];
    expect(pick3d(items, new Grid(items, 100, 100), down, { ...base, sx: 50, sy: 50 })).toEqual([]);
  });

  it('reads a link line by its projected segment, and a polygon Zone on its plane', () => {
    const a = pin('a', 10, 10, 0);
    const b = pin('b', 90, 10, 500);
    const line: LineItem = { id: 'line:a~b', kind: 'line', element: null, a: 'a', b: 'b', aPin: a.id, bPin: b.id, source: 'm', offset: [0, 0], style: 'line', ax: 10, ay: 10, bx: 90, by: 10, az: 0, bz: 500, edges: [] };
    const zone: ZoneItem = { id: 'zone:z@m', kind: 'zone', element: 'z', shape: 'polygon', source: 'm', offset: [0, 0], style: 'zone:polygon', points: [[20, 40], [80, 40], [80, 80], [20, 80]], bbox: [20, 40, 80, 80], area: 2400 };
    const items: Item[] = [zone, line, a, b];
    const grid = new Grid(items, 100, 100);
    expect(pick3d(items, grid, down, { ...base, sx: 50, sy: 92 })).toEqual(['line:a~b']);
    expect(pick3d(items, grid, down, { ...base, sx: 50, sy: 40 })).toEqual(['zone:z@m']);
    expect(pick3d(items, grid, down, { ...base, sx: 50, sy: 40, hidden: new Set(['zone']) })).toEqual([]);
  });
});
