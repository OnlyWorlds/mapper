import { describe, expect, it } from 'vitest';
import { A, B, C, LAYOUT, MAP, ZONE, id, world } from './fixture';
import { readMap } from './kinds';
import { build, GraphCache, readerFor, type BuildInput } from './scene';
import { sliceFor } from './slice';
import { WorldStore } from './store';
import type { LineItem, PinItem, ZoneItem } from './types';
import { outLine } from './words';

function storeOf(w = world()) {
  const s = new WorldStore();
  s.put('map', w.maps);
  s.put('pin', w.pins);
  s.put('marker', w.markers);
  s.put('zone', w.zones);
  s.put('location', w.bodies);
  return s;
}

function input(store: WorldStore, mapId: string, complete = true, done = { markersComplete: true, zonesComplete: true }): BuildInput {
  const maps = store.ofType('map');
  const reading = readMap(store.get(mapId)!, maps, store.ofType('pin'));
  const ground = reading.ground ? readMap(store.get(reading.ground)!, maps) : null;
  return {
    slice: sliceFor(store, mapId, ground?.id ?? null, done),
    reading,
    ground,
    rung: 'public',
    complete,
    pictureSize: null,
    versionOf: (i) => store.version(i),
  };
}

describe('the builder', () => {
  it('names every item from served ids only', () => {
    const scene = build(input(storeOf(), MAP), new GraphCache());
    const ids = scene.items.map((i) => i.id);
    expect(ids).toContain(`picture:${MAP}`);
    expect(ids).toContain(`zone:${ZONE}@${MAP}`);
    expect(ids).toContain(`pin:${id(30)}`);
    expect(ids).toContain(`line:${A}~${B}`);
    expect(ids).toContain(`line:${A}~${C}`);
    expect(ids).toContain(`label:pin:${id(30)}`);
    for (const i of ids) expect(i).toMatch(/^(picture|zone|pin|line|label):/);
    expect(new Set(ids).size).toBe(ids.length);
    expect(scene.items.some((i) => (i.kind as string) === 'marker')).toBe(false);
  });

  it('draws one line per unordered pair, its edges kept, a mirror pair included', () => {
    const scene = build(input(storeOf(), MAP), new GraphCache());
    const ab = scene.byId.get(`line:${A}~${B}`) as LineItem;
    expect(ab.edges).toHaveLength(3);
    expect(ab.edges).toEqual(expect.arrayContaining([
      { source: A, field: 'partner', target: B },
      { source: A, field: 'rival', target: B },
      { source: B, field: 'partner', target: A },
    ]));
    expect(scene.items.filter((i) => i.kind === 'line')).toHaveLength(2);
  });

  it('gives the same ids when built again and for another reader', () => {
    const store = storeOf();
    const one = build(input(store, MAP), new GraphCache()).items.map((i) => i.id);
    const again = build({ ...input(store, MAP), rung: 'owner' }, new GraphCache()).items.map((i) => i.id);
    expect(again).toEqual(one);
  });

  it('draws a Pin with no body, and no line to it', () => {
    const scene = build(input(storeOf(), MAP), new GraphCache());
    const unseen = scene.byId.get(`pin:${id(34)}`) as PinItem;
    expect(unseen.element).toBe(id(99));
    expect(scene.items.some((i) => i.kind === 'line' && (i.a === id(99) || i.b === id(99)))).toBe(false);
    const loose = scene.byId.get(`pin:${id(33)}`) as PinItem;
    expect(loose.element).toBeNull();
    expect(loose.style).toBe('pin:none');
  });

  it('holds the out line and the labels until the reads are complete', () => {
    const store = storeOf();
    const partial = build(input(store, MAP, false), new GraphCache());
    expect(partial.out).toBeNull();
    expect(outLine(partial)).toBeNull();
    expect(partial.items.some((i) => i.kind === 'label')).toBe(false);
    const whole = build(input(store, MAP, true), new GraphCache());
    expect(whole.out).toEqual({});
    expect(whole.items.filter((i) => i.kind === 'label').length).toBe(3);
  });

  it('draws no outline while its Markers or its Zone are still being read', () => {
    const store = storeOf();
    const before = build(input(store, MAP, false, { markersComplete: false, zonesComplete: false }), new GraphCache());
    expect(before.items.some((i) => i.kind === 'zone')).toBe(false);
    const noZone = new WorldStore();
    const w = world();
    noZone.put('map', w.maps);
    noZone.put('pin', w.pins);
    noZone.put('marker', w.markers);
    const waiting = build(input(noZone, MAP, false, { markersComplete: true, zonesComplete: false }), new GraphCache());
    expect(waiting.items.some((i) => i.kind === 'zone')).toBe(false);
    expect(waiting.out).toBeNull();
  });

  it('places a ground at its margin, each ground item carrying its source Map', () => {
    const scene = build(input(storeOf(), LAYOUT), new GraphCache());
    const z = scene.byId.get(`zone:${ZONE}@${MAP}`) as ZoneItem;
    expect(z.source).toBe(MAP);
    expect(z.offset).toEqual([100, 100]);
    expect(z.points[0]).toEqual([100, 100]);
    const pic = scene.byId.get(`picture:${MAP}`);
    expect(pic?.kind === 'picture' && pic.rect).toEqual([100, 100, 1000, 800]);
    expect(scene.byId.has(`picture:${LAYOUT}`)).toBe(false);
    expect(scene.counts.pins).toBe(2);
    expect(scene.byId.get(`line:${A}~${B}`)).toBeTruthy();
  });

  it('ranks labels by degree, ties by name', () => {
    const scene = build(input(storeOf(), MAP), new GraphCache());
    const labels = scene.items.filter((i) => i.kind === 'label').map((i) => (i.kind === 'label' ? i.text : ''));
    expect(labels).toEqual(['Akra', 'Bela', 'Cora']);
  });

  it('keeps the graph per Map until a row changes', () => {
    const store = storeOf();
    const cache = new GraphCache();
    build(input(store, MAP), cache);
    build(input(store, MAP), cache);
    expect(cache.hits).toBe(1);
    store.put('location', [{ id: C, type: 'location', name: 'Cora', parent_location: B }]);
    const scene = build(input(store, MAP), cache);
    expect(cache.misses).toBe(2);
    expect(scene.byId.has(`line:${B}~${C}`)).toBe(true);
    expect(scene.byId.has(`line:${A}~${C}`)).toBe(false);
  });

  it('reads a guest over its served set', () => {
    const r = readerFor('guest', [{ id: A }, { id: B, known_of: true }]);
    expect(r).toEqual({ rung: 'guest', whole: [A], known_of: [B] });
    expect(readerFor('public', [])).toEqual({ rung: 'public' });
  });
});

describe('the slice', () => {
  it('hands the builder only the opened Map and its ground', () => {
    const store = storeOf();
    store.put('pin', [{ id: id(70), map: id(9), element_type: 'location', element_id: id(71), x: 1, y: 1 }]);
    store.put('location', [{ id: id(71), name: 'Elsewhere' }]);
    const s = sliceFor(store, MAP, null, { markersComplete: true, zonesComplete: true });
    expect(s.pins.map((p) => p.id)).not.toContain(id(70));
    expect(s.bodies.map((b) => b.id).sort()).toEqual([A, B, C].sort());
    expect(s.zones.map((z) => z.id)).toEqual([ZONE]);
    const lay = sliceFor(store, LAYOUT, MAP, { markersComplete: true, zonesComplete: true });
    expect(lay.markers).toHaveLength(4);
    expect(lay.pins).toHaveLength(2);
  });
});
