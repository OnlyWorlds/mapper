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
  t = 0;
  now() {
    return this.t;
  }
  set(fn: () => void, ms: number) {
    const id = ++this.n;
    this.queue.push({ fn, at: this.t + ms, id });
    return id;
  }
  /** Move the clock on, running what falls due. */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = this.queue.filter((q) => q.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.t = due.at;
      this.queue = this.queue.filter((q) => q !== due);
      due.fn();
    }
    this.t = end;
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
    expect(a).toEqual({ world: W, type: 'location', element: M1, map: M2, at: { x: 10, y: 20, span: 300 }, measure: true, view: null });
    expect(formatAddress(a)).toBe(`?world=${W}&type=location&element=${M1}&map=${M2}&at=10,20,300&measure=1`);
  });
  it('reads view=flat and nothing else as a view', () => {
    expect(parseAddress(`?world=${W}&map=${M1}&view=flat`).view).toBe('flat');
    expect(parseAddress(`?world=${W}&map=${M1}&view=3d`).view).toBeNull();
    expect(formatAddress(parseAddress(`?world=${W}&map=${M1}&view=flat&at=1,2,3`))).toBe(`?world=${W}&map=${M1}&view=flat&at=1,2,3`);
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

  it('Flat writes view=flat by replace and drops at; 3D drops view; a gesture on flat keeps view', () => {
    const { h, w, t } = setup(`?world=${W}&map=${M1}&at=1,2,3`);
    w.gestureEnded(M1, { x: 4, y: 5, span: 6 }, 300);
    w.setView(M1, true);
    expect(w.hasPending).toBe(false);
    t.flush();
    expect(h.entries).toHaveLength(1);
    expect(h.url).toBe(`?world=${W}&map=${M1}&view=flat`);
    w.gestureEnded(M1, { x: 7, y: 8, span: 9 });
    expect(h.url).toBe(`?world=${W}&map=${M1}&view=flat&at=7,8,9`);
    w.setView(M1, false);
    expect(h.url).toBe(`?world=${W}&map=${M1}`);
  });

  it('markShown keeps view=flat; a press that opens another Map drops it', () => {
    const el = `?world=${W}&type=location&element=${M2}&view=flat`;
    const { h, w } = setup(el);
    w.markShown(M1);
    expect(h.url).toBe(el);
    w.push({ ...w.current(), map: M2, view: null });
    expect(h.url).toBe(`?world=${W}&type=location&element=${M2}&map=${M2}`);
    // A press built from the old address without naming view (the app's go) drops it too.
    const { h: h2, w: w2 } = setup(`?world=${W}&map=${M1}&view=flat`);
    w2.push({ world: W, map: M2, element: null, type: null, at: null, measure: false });
    expect(h2.url).toBe(`?world=${W}&map=${M2}`);
  });

  it('Flat on the element view names the Map it shows; on an entry showing another Map it writes nothing', () => {
    const el = `?world=${W}&type=location&element=${M2}`;
    const { h, w } = setup(el);
    w.markShown(M1);
    w.setView(M1, true);
    expect(h.url).toBe(`?world=${W}&type=location&element=${M2}&map=${M1}&view=flat`);
    w.setView(M2, false);
    expect(h.url).toBe(`?world=${W}&type=location&element=${M2}&map=${M1}&view=flat`);
  });

  it('marks the element view first Map without writing it, and takes its at', () => {
    const el = `?world=${W}&type=location&element=${M2}`;
    const { h, w } = setup(el);
    w.markShown(M1);
    expect(h.entries).toHaveLength(1);
    expect(h.url).toBe(el);
    expect(w.shownMap()).toBe(M1);
    // The write names the Map it shows, so a reload opens the same Map whatever the tab held.
    w.gestureEnded(M1, { x: 9, y: 9, span: 99 });
    expect(h.url).toBe(`?world=${W}&type=location&element=${M2}&map=${M1}&at=9,9,99`);
    expect(parseAddress(h.url).map).toBe(M1);
  });

  it('meters at writes: a held key or a run of presses never nears an engine limit, and the last camera lands', () => {
    const { h, w, t } = setup(`?world=${W}&map=${M1}`);
    let writes = 0;
    const real = h.replaceState.bind(h);
    h.replaceState = (s, u, url) => {
      writes++;
      real(s, u, url);
    };
    // 300 gesture ends, 20 ms apart (a held arrow key's repeat), each with no idle delay: 6 s.
    for (let i = 0; i < 300; i++) {
      w.gestureEnded(M1, { x: i, y: 0, span: 100 });
      t.advance(20);
    }
    t.advance(2000);
    // At most the burst and four a second over the 6 s, and far under WebKit's 100 in 10 s.
    expect(writes).toBeLessThanOrEqual(10 + 6 * 4 + 2);
    expect(parseAddress(h.url).at).toEqual({ x: 299, y: 0, span: 100 });
  });

  it('drops a write the engine refuses, never throws', () => {
    const { h, w } = setup(`?world=${W}&map=${M1}`);
    h.replaceState = () => {
      throw new DOMException('Attempt to use history.replaceState() more than 100 times per 10 seconds', 'SecurityError');
    };
    expect(() => w.gestureEnded(M1, { x: 1, y: 2, span: 3 })).not.toThrow();
    expect(w.log).toHaveLength(0);
    expect(() => w.markShown(M2)).not.toThrow();
  });

  it('never carries at into a pushed entry', () => {
    const { h, w } = setup(`?world=${W}&map=${M1}&at=1,1,1`);
    w.push({ ...w.current(), map: M2, at: null });
    expect(h.url).toBe(`?world=${W}&map=${M2}`);
  });
});
