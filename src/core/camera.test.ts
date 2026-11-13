import { describe, expect, it } from 'vitest';
import { atOf, cameraFromAt, fit, panBy, toMap, toScreen, zoomAt } from './camera';
import { placeLabels } from './labels';
import { copySides, levelFor } from '../view/picture';
import { outLine, progressLine } from './words';

const v = { w: 800, h: 600 };

describe('the camera', () => {
  it('fits a frame and keeps y up', () => {
    const c = fit(1000, 500, v, 1);
    expect(c.s).toBeCloseTo(0.8);
    expect(toScreen(c, v, 0, 0)).toEqual([0, 500]);
    expect(toScreen(c, v, 1000, 500)).toEqual([800, 100]);
  });
  it('fits below what floats over the top', () => {
    const c = fit(1000, 500, v, 1, { top: 200, right: 0, bottom: 0, left: 0 });
    const [, top] = toScreen(c, v, 0, 500);
    const [, bottom] = toScreen(c, v, 0, 0);
    expect(top).toBeGreaterThanOrEqual(200 - 1e-9);
    expect(bottom).toBeLessThanOrEqual(600 + 1e-9);
  });
  it('round-trips a point and zooms about the pointer', () => {
    const c = fit(1000, 500, v);
    const [x, y] = toMap(c, v, 123, 456);
    expect(toScreen(c, v, x, y).map((n) => Math.round(n * 1e6) / 1e6)).toEqual([123, 456]);
    const z = zoomAt(c, v, 123, 456, 2, [0.01, 100]);
    expect(z.s).toBeCloseTo(c.s * 2);
    const [x2, y2] = toMap(z, v, 123, 456);
    expect(x2).toBeCloseTo(x);
    expect(y2).toBeCloseTo(y);
    const p = panBy(c, 10, 0);
    expect(toScreen(p, v, x, y)[0]).toBeCloseTo(133);
  });
  it('writes the same area for every screen: span across the shorter side', () => {
    const c = { cx: 500, cy: 250, s: 2 };
    const at = atOf(c, v);
    expect(at).toEqual({ x: 500, y: 250, span: 300 });
    const phone = cameraFromAt(at, { w: 390, h: 844 });
    expect(Math.min(390, 844) / phone.s).toBeCloseTo(300);
  });
});

describe('labels where they fit', () => {
  it('places in order, never over another, at most max', () => {
    const cands = [
      { anchor: 'a', text: 'Alpha', sx: 100, sy: 100 },
      { anchor: 'b', text: 'Beta', sx: 104, sy: 102 },
      { anchor: 'c', text: 'Gamma', sx: 400, sy: 300 },
      { anchor: 'd', text: 'Off', sx: -5, sy: 10 },
    ];
    const placed = placeLabels(cands, (t) => t.length * 7, { w: 800, h: 600, max: 10, font: 12, gap: 8 });
    expect(placed.map((p) => p.anchor)).toEqual(['a', 'b', 'c']);
    expect(placed[1].side).toBe('left');
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const [a, b] = [placed[i].rect, placed[j].rect];
        expect(a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]).toBe(false);
      }
    expect(placeLabels(cands, () => 10, { w: 800, h: 600, max: 1, font: 12, gap: 8 })).toHaveLength(1);
  });
});

describe('the picture copies', () => {
  it('never makes a copy past 4096, smallest first', () => {
    expect(copySides(8000, 5700)).toEqual([1024, 2048, 4096]);
    expect(copySides(2400, 1800)).toEqual([1024, 2048, 2400]);
    expect(copySides(784, 1168)).toEqual([1024, 1168]);
    expect(copySides(640, 480)).toEqual([640]);
  });
  it('draws the smallest copy that holds the screen', () => {
    const levels = [{ w: 1024 }, { w: 2048 }, { w: 4096 }];
    expect(levelFor(levels, 900)?.w).toBe(1024);
    expect(levelFor(levels, 1500)?.w).toBe(2048);
    expect(levelFor(levels, 9000)?.w).toBe(4096);
    expect(levelFor([], 10)).toBeNull();
  });
});

describe('the words', () => {
  it('says what was left aside only when complete', () => {
    expect(outLine({ complete: false, out: { dangling: 4 } })).toBeNull();
    expect(outLine({ complete: true, out: {} })).toBeNull();
    expect(outLine({ complete: true, out: { no_markers: 1, dangling: 4312 } })).toBe('Not drawn: 1 Zone with no placed Marker, 4,312 Markers whose Zone or Map was not served.');
  });
  it('says which read runs', () => {
    expect(progressLine([{ name: 'Pins', state: 'done', calls: 1 }, { name: 'Zones', state: 'running', calls: 1 }, { name: 'elements', state: 'waiting', calls: 0 }])).toBe('Reading Zones, read 2 of 3.');
    expect(progressLine([{ name: 'Pins', state: 'done', calls: 1 }])).toBeNull();
  });
});
