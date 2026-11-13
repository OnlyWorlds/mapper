import { describe, expect, it } from 'vitest';
import { elementMapOrder, linesAlwaysOn, readMap } from './kinds';
import type { Row } from './types';

const maps: Row[] = [
  { id: 'p', name: 'Pictured', width: 10, height: 10, image_url: 'https://media.example/a.webp' },
  { id: 'n', name: 'Plain', width: 10, height: 10 },
  { id: 'd', name: 'Plain deep', width: 10, height: 10, depth: 40 },
  { id: 'h', name: 'Unsafe', image_url: 'http://media.example/a.webp' },
  { id: 'l', name: 'Layout', x_layout: { method: 'force' } },
  { id: 'l3', name: 'Layout deep', depth: 900, x_layout: { method: 'force', settings: { ground: { map: 'p' } } } },
  { id: 'm', name: 'Layout margin', depth: 900, x_layout: { method: 'force', settings: { ground: { map: 'n' }, margin: 300 } } },
];

describe('the kinds of Map', () => {
  it('words each kind', () => {
    const w = Object.fromEntries(maps.map((m) => [m.id, readMap(m, maps).words]));
    expect(w).toEqual({ p: 'a picture', n: 'a plan', d: 'a plan', h: 'a plan', l: 'a layout', l3: 'a layout · 3D', m: 'a layout · 3D' });
  });
  it('draws a picture only from https', () => {
    const h = readMap(maps[3], maps);
    expect(h.picture).toBeNull();
    expect(h.pictureRefused).toBe(true);
  });
  it('reads the ground through layoutOf, and its place from the margin when there is one', () => {
    const l3 = readMap(maps[5], maps);
    expect(l3.ground).toBe('p');
    expect(l3.groundOffset).toEqual([0, 0]);
    expect(l3.marginRead).toBe(false);
    const m = readMap(maps[6], maps);
    expect(m.groundOffset).toEqual([300, 300]);
    expect(m.marginRead).toBe(true);
  });
  it('keeps a plain Map’s depth, to say it', () => {
    expect(readMap(maps[2], maps).depth).toBe(40);
  });
  it('draws lines always on a layout only', () => {
    expect(linesAlwaysOn('layout')).toBe(true);
    expect(linesAlwaysOn('layout3d')).toBe(true);
    expect(linesAlwaysOn('picture')).toBe(false);
    expect(linesAlwaysOn('plan')).toBe(false);
  });
  it('orders an element’s Maps: picture, plan, layout; then most Pins; then name', () => {
    const r = maps.map((m) => readMap(m, maps));
    const counts: Record<string, number> = { n: 3, d: 5 };
    const order = elementMapOrder(r, (id) => counts[id] ?? null).map((m) => m.id);
    expect(order).toEqual(['p', 'd', 'n', 'h', 'l', 'l3', 'm']);
  });
});
