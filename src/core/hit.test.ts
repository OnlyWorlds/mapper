import { describe, expect, it } from 'vitest';
import { Grid, pick, type PickQuery } from './hit';
import { lineItems, pinItem, zoneItem } from './scene';
import type { Item, ItemKind } from './types';

const pin = (n: string, x: number, y: number) => pinItem({ pin: n, map: 'm', element_type: 'location', element_id: `e${n}`, x, y, z: 0 }, 'location');
const zone = (n: string, shape: 'polygon' | 'line', pts: [number, number][]) => zoneItem({ zone: n, map: 'm', shape, points: pts.map(([x, y]) => [x, y, 0]) }, [0, 0]);

const picture: Item = { id: 'picture:m', kind: 'picture', element: null, source: 'm', offset: [0, 0], style: 'picture', url: 'https://x/p.png', rect: [0, 0, 1000, 1000] };
const big = zone('big', 'polygon', [[0, 0], [600, 0], [600, 600], [0, 600]]);
const small = zone('small', 'polygon', [[100, 100], [300, 100], [300, 300], [100, 300]]);
const road = zone('road', 'line', [[0, 500], [1000, 500]]);
const p1 = pin('1', 200, 200);
const p2 = pin('2', 205, 200);
const p3 = pin('3', 800, 800);
const pins = new Map([[p1.element!, p1], [p3.element!, p3]]);
const [link] = lineItems([{ source: p1.element!, field: 'partner', target: p3.element! }], pins);
const items: Item[] = [picture, big, small, road, link, p1, p2, p3];
const grid = new Grid(items, 1000, 1000);

const q = (x: number, y: number, extra: Partial<PickQuery> = {}): PickQuery => ({ x, y, r: 10, sx: 0, sy: 0, hidden: new Set<ItemKind>(), labels: [], many: false, ...extra });

describe('the pointer order', () => {
  it('never answers with the picture', () => {
    expect(pick(grid, q(950, 50))).toEqual([]);
  });
  it('takes a Pin first, the nearest', () => {
    expect(pick(grid, q(204, 200))).toEqual([p2.id]);
    expect(pick(grid, q(199, 200))).toEqual([p1.id]);
  });
  it('lists every Pin within the radius on a phone', () => {
    expect(pick(grid, q(202, 200, { many: true }))).toEqual([p1.id, p2.id]);
  });
  it('takes a label as its anchor, before a line', () => {
    const labels = [{ anchor: p3.id, rect: [10, 10, 60, 24] as [number, number, number, number] }];
    expect(pick(grid, q(700, 502, { sx: 20, sy: 15, labels }))).toEqual([p3.id]);
  });
  it('takes a line Zone or a link line by distance, before a polygon', () => {
    expect(pick(grid, q(700, 503))).toEqual([road.id]);
    // Where the road and the link cross, the nearer one answers.
    expect(pick(grid, q(500, 501))).toEqual([link.id]);
    const onLink = pick(grid, q(500, 500 + 0.01, { hidden: new Set<ItemKind>(['zone']) }));
    expect(onLink).toEqual([link.id]);
  });
  it('takes the smallest polygon that holds the point', () => {
    expect(pick(grid, q(150, 150))).toEqual([small.id]);
    expect(pick(grid, q(450, 150))).toEqual([big.id]);
  });
  it('skips what the view hides', () => {
    const hidden = new Set<ItemKind>(['line']);
    expect(pick(grid, q(650, 650, { hidden }))).toEqual([]);
    expect(pick(grid, q(650, 650))).toEqual([link.id]);
  });
});
