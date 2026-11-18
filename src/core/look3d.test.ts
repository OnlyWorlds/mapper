import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOT_EDGE, GROW_MAX, GROW_MIN, LOOK_KEY, NEAR_GLOW, OPEN_GLOW, POINT_MAX_PX, drawn, pointPx, readLook, storedLook, storeLook, writeLook } from './look3d';

describe('a point\'s width in the icon look', () => {
  it('grows a near point and shrinks a far one, within the bounds', () => {
    expect(pointPx(9, 1, 100, 100)).toBe(9);
    expect(pointPx(9, 1, 100, 50)).toBe(18);
    expect(pointPx(9, 1, 100, 400)).toBeCloseTo(9 * GROW_MIN);
    expect(pointPx(9, 1, 100, 1)).toBe(Math.min(POINT_MAX_PX, 9 * GROW_MAX));
    expect(pointPx(9, 1.5, 100, 50)).toBe(27);
    expect(pointPx(40, 1.5, 100, 10)).toBe(POINT_MAX_PX);
  });

  it('no fitted distance, or a point behind the camera, keeps the base', () => {
    expect(pointPx(9, 1, 0, 50)).toBe(9);
    expect(pointPx(9, 1.25, 100, -3)).toBe(11.25);
  });
});

describe('a point as drawn', () => {
  const at = { base: 9, lit: 0 as const, ref: 100, dpr: 1, maxSprite: 1024, from: 20, hasIcon: true };

  it('is a dot below the threshold, its edge at DOT_EDGE of its radius; a body from it', () => {
    const dot = drawn({ ...at, depth: 50 });
    expect(dot).toEqual({ px: 18, icon: false, r: 9 * DOT_EDGE });
    const body = drawn({ ...at, depth: 45 });
    expect(body.icon).toBe(true);
    expect(body.r).toBeCloseTo(10);
    // Exactly at the threshold it is a body.
    expect(drawn({ ...at, depth: 45, from: 20 }).icon).toBe(true);
    expect(drawn({ ...at, depth: 45, from: 16 }).icon).toBe(true);
    expect(drawn({ ...at, depth: 50, from: 16 }).icon).toBe(true);
  });

  it('a type with no icon stays a dot at any size', () => {
    const d = drawn({ ...at, depth: 10, hasIcon: false });
    expect(d.icon).toBe(false);
    expect(d.r).toBeCloseTo((d.px / 2) * DOT_EDGE);
  });

  it('lit points are larger: a selected one 1.5 times, a reached one 1.25', () => {
    expect(drawn({ ...at, depth: 100, lit: 2 }).px).toBeCloseTo(13.5);
    expect(drawn({ ...at, depth: 100, lit: 1 }).px).toBeCloseTo(11.25);
  });

  it('the sprite, glow and all, is held to what the GPU draws, as the shader holds it', () => {
    // 48 px at device ratio 2 with the selected glow is 148.8 device px: a GPU drawing 100 holds it to 100 / 1.55 / 2 CSS px.
    const d = drawn({ ...at, depth: 1, lit: 2, dpr: 2, maxSprite: 100 });
    expect(d.px).toBeCloseTo(100 / (OPEN_GLOW * 2));
    const n = drawn({ ...at, depth: 1, lit: 1, dpr: 1, maxSprite: 40 });
    expect(n.px).toBeCloseTo(40 / NEAR_GLOW);
    expect(drawn({ ...at, depth: 1, dpr: 1, maxSprite: 4096 }).px).toBe(9 * GROW_MAX);
    expect(drawn({ ...at, depth: 1, lit: 2, dpr: 1, maxSprite: 4096 }).px).toBe(POINT_MAX_PX);
  });
});

describe('the look as one browser keeps it', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads what it writes, anything else is the dots from 20 px', () => {
    for (const l of [{ icons: true, from: 16 }, { icons: true, from: 20 }, { icons: false, from: 16 }, { icons: false, from: 20 }] as const) expect(readLook(writeLook(l))).toEqual(l);
    expect(readLook(null)).toEqual({ icons: false, from: 20 });
    expect(readLook('icons')).toEqual({ icons: false, from: 20 });
    expect(readLook('icons:17')).toEqual({ icons: false, from: 20 });
  });

  it('a storage that throws keeps the dots and never throws itself', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(storedLook()).toEqual({ icons: false, from: 20 });
    expect(() => storeLook({ icons: true, from: 16 })).not.toThrow();
  });

  it('kept under its own key', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => kept.set(k, v) });
    storeLook({ icons: false, from: 16 });
    expect(kept.get(LOOK_KEY)).toBe('dots:16');
    expect(storedLook()).toEqual({ icons: false, from: 16 });
  });
});
