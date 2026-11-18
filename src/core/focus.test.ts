import { describe, expect, it } from 'vitest';
import { focusOf } from './focus';
import type { Scene } from './scene';

// A scene as focusOf reads it: Pins p1 to p4, lines p1-p2 and p2-p3, p4 alone, and a zone.
const pin = (id: string) => ({ id, kind: 'pin' });
const line = (id: string, aPin: string, bPin: string, x: number) => ({ id, kind: 'line', aPin, bPin, ax: x, ay: 0, az: 0, bx: x + 1, by: 0, bz: 0 });
const items = [pin('p1'), pin('p2'), pin('p3'), pin('p4'), line('l12', 'p1', 'p2', 10), line('l23', 'p2', 'p3', 20), { id: 'z', kind: 'zone' }];
const scene = { items, byId: new Map(items.map((i) => [i.id, i])) } as unknown as Scene;

describe('a selected Pin\'s focus', () => {
  it('holds the selected Pin, its lines and the Pins they reach, nothing else', () => {
    const f = focusOf(scene, ['p1'])!;
    expect([...f.near].sort()).toEqual(['p1', 'p2']);
    expect(f.segs).toEqual([10, 0, 0, 11, 0, 0]);
    const g = focusOf(scene, ['p2'])!;
    expect([...g.near].sort()).toEqual(['p1', 'p2', 'p3']);
    expect(g.segs.length).toBe(12);
  });

  it('a Pin with no line is a focus of itself alone', () => {
    const f = focusOf(scene, ['p4'])!;
    expect([...f.near]).toEqual(['p4']);
    expect(f.segs).toEqual([]);
  });

  it('no focus without a selected Pin: nothing, a line or a zone', () => {
    expect(focusOf(scene, [])).toBeNull();
    expect(focusOf(scene, ['l12'])).toBeNull();
    expect(focusOf(scene, ['z', 'nope'])).toBeNull();
  });

  it('asked again for the same selection, the same answer; another selection, its own', () => {
    expect(focusOf(scene, ['p1'])).toBe(focusOf(scene, ['p1']));
    expect(focusOf(scene, ['p3'])!.near.has('p2')).toBe(true);
    expect(focusOf(scene, ['p1'])!.near.has('p3')).toBe(false);
  });
});
