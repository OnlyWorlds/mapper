import { describe, expect, it } from 'vitest';
import { AddressWriter, formatAddress, parseAddress, type HistoryLike, type Timers } from './address';

class FakeHistory implements HistoryLike {
  entries: { state: unknown; url: string }[];
  i = 0;
  constructor(url: string) {
    this.entries = [{ state: null, url }];
  }
  get state() {
    return this.entries[this.i].state;
  }
  get url() {
    return this.entries[this.i].url;
  }
  pushState(state: unknown, _u: string, url?: string | URL | null) {
    this.entries = this.entries.slice(0, this.i + 1);
    this.entries.push({ state, url: String(url) });
    this.i++;
  }
  replaceState(state: unknown, _u: string, url?: string | URL | null) {
    this.entries[this.i] = { state, url: String(url ?? this.url) };
  }
  back() {
    this.i = Math.max(0, this.i - 1);
  }
}

class FakeTimers implements Timers {
  queue: { fn: () => void; at: number; id: number }[] = [];
  n = 0;
  set(fn: () => void, ms: number) {
    const id = ++this.n;
    this.queue.push({ fn, at: ms, id });
    return id;
  }
  clear(h: unknown) {
    this.queue = this.queue.filter((t) => t.id !== h);
  }
  flush() {
    const q = this.queue;
    this.queue = [];
    for (const t of q) t.fn();
  }
}

const W = '0695db52-5433-7332-8000-db7fe10da375';
const M1 = '01a1206b-efde-7a5c-8956-d0b871776154';
const M2 = '069620b8-a566-7850-8000-2afcac2701e5';

function setup(url = `?world=${W}`) {
  const h = new FakeHistory(url);
  const t = new FakeTimers();
  const w = new AddressWriter(h, () => h.url, t);
  return { h, t, w };
}

describe('the address', () => {
  it('reads and writes its words', () => {
    const a = parseAddress(`?world=${W}&type=Location&element=${M1}&map=${M2}&at=10,20,300&measure=1`);
    expect(a).toEqual({ world: W, type: 'location', element: M1, map: M2, at: { x: 10, y: 20, span: 300 }, measure: true });
    expect(formatAddress(a)).toBe(`?world=${W}&type=location&element=${M1}&map=${M2}&at=10,20,300&measure=1`);
  });
  it('drops an at it cannot read', () => {
    expect(parseAddress('?at=1,2').at).toBeNull();
    expect(parseAddress('?at=1,2,0').at).toBeNull();
    expect(parseAddress('?at=a,b,c').at).toBeNull();
  });
});

describe('the address writer', () => {
  it('pushes a Map on a press, so Back returns to the list', () => {
    const { h, w } = setup();
    w.push({ ...w.current(), map: M1 });
    expect(h.entries).toHaveLength(2);
    expect(h.url).toBe(`?world=${W}&map=${M1}`);
    expect(w.depth()).toBe(1);
    h.back();
    expect(parseAddress(h.url).map).toBeNull();
  });

  it('writes at only at a gesture end, by replace, on the entry that shows its Map', () => {
    const { h, w } = setup(`?world=${W}&map=${M1}`);
    w.gestureEnded(M1, { x: 5, y: 6, span: 700 });
    expect(h.entries).toHaveLength(1);
    expect(h.url).toBe(`?world=${W}&map=${M1}&at=5,6,700`);
    expect(w.log).toEqual([{ how: 'replace', url: `?world=${W}&map=${M1}&at=5,6,700` }]);
  });

  it('never writes a camera onto an entry that shows another Map', () => {
    const { h, w } = setup(`?world=${W}&map=${M1}`);
    w.gestureEnded(M2, { x: 5, y: 6, span: 700 });
    expect(h.url).toBe(`?world=${W}&map=${M1}`);
  });

  it('cancels a pending at when a press writes the address', () => {
    const { h, w, t } = setup(`?world=${W}&map=${M1}`);
    w.gestureEnded(M1, { x: 1, y: 2, span: 3 }, 300);
    expect(w.hasPending).toBe(true);
    w.push({ ...w.current(), map: M2 });
    expect(w.hasPending).toBe(false);
    t.flush();
    expect(h.url).toBe(`?world=${W}&map=${M2}`);
    h.back();
    expect(h.url).toBe(`?world=${W}&map=${M1}`);
  });

  it('a pending at that fires after its Map was left writes nothing', () => {
    const { h, w, t } = setup(`?world=${W}&map=${M1}`);
    w.gestureEnded(M1, { x: 1, y: 2, span: 3 }, 300);
    // Back or a link left the entry without a press through the writer.
    h.pushState({ mapper: 1, map: M2, depth: 1 }, '', `?world=${W}&map=${M2}`);
    t.flush();
    expect(h.url).toBe(`?world=${W}&map=${M2}`);
  });

  it('marks the element view first Map without writing it, and takes its at', () => {
    const el = `?world=${W}&type=location&element=${M2}`;
    const { h, w } = setup(el);
    w.markShown(M1);
    expect(h.entries).toHaveLength(1);
    expect(h.url).toBe(el);
    expect(w.shownMap()).toBe(M1);
    w.gestureEnded(M1, { x: 9, y: 9, span: 99 });
    expect(h.url).toBe(`${el}&at=9,9,99`);
  });

  it('never carries at into a pushed entry', () => {
    const { h, w } = setup(`?world=${W}&map=${M1}&at=1,1,1`);
    w.push({ ...w.current(), map: M2, at: null });
    expect(h.url).toBe(`?world=${W}&map=${M2}`);
  });
});
