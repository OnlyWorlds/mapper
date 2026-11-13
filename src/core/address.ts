// The address is history, and only a person's press or gesture writes it.
//   ?world=<id>                         a world's Maps
//   &map=<id>                           a Map opened by a press (pushState, so Back returns)
//   &type=<type>&element=<id>           one element's Maps; its first Map is not written
//   &at=<x>,<y>,<span>                  the camera, written by replaceState only at the end of the
//                                       person's own gesture, never for a camera the page moved
//   &measure=1                          the measure readout
// A press that writes the address first cancels a pending `at`, and an `at` write checks that the
// entry it writes still shows the Map whose camera it holds; on an entry that shows its Map without
// naming it (the element view's first Map), the write names it, so a reload opens the same Map.
// `at` writes are metered (a burst of BURST, then RATE a second: at most 50 in 10 s, where WebKit
// refuses more than 100 history writes), a write past the meter waits its turn, and a refused write
// is dropped, never thrown. When `element` and `at` are both present,
// `at` wins and the element is still marked.
import type { At } from './camera';

export interface Address {
  world: string | null;
  type: string | null;
  element: string | null;
  map: string | null;
  at: At | null;
  measure: boolean;
}

export const EMPTY: Address = { world: null, type: null, element: null, map: null, at: null, measure: false };

export function parseAt(v: string | null): At | null {
  if (!v) return null;
  const parts = v.split(',');
  if (parts.length !== 3) return null;
  const [x, y, span] = parts.map(Number);
  if (![x, y, span].every(Number.isFinite) || span <= 0) return null;
  return { x, y, span };
}

export function parseAddress(search: string): Address {
  const q = new URLSearchParams(search);
  const get = (k: string) => {
    const v = q.get(k);
    return v && v.trim() ? v.trim() : null;
  };
  return {
    world: get('world'),
    type: get('type')?.toLowerCase() ?? null,
    element: get('element'),
    map: get('map'),
    at: parseAt(get('at')),
    measure: q.get('measure') === '1',
  };
}

export function formatAddress(a: Address): string {
  const q = new URLSearchParams();
  if (a.world) q.set('world', a.world);
  if (a.type) q.set('type', a.type);
  if (a.element) q.set('element', a.element);
  if (a.map) q.set('map', a.map);
  if (a.at) q.set('at', `${Math.round(a.at.x)},${Math.round(a.at.y)},${Math.round(a.at.span)}`);
  if (a.measure) q.set('measure', '1');
  const s = q.toString().replace(/%2C/g, ',');
  return s ? `?${s}` : '?';
}

/** What the page keeps on each history entry it writes or marks. */
export interface EntryState {
  mapper: 1;
  /** The Map this entry shows, written or not (the element view's first Map is shown, not written). */
  map: string | null;
  /** How many entries this page pushed before this one: Back stays inside the page when it is above 0. */
  depth: number;
}

export interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
};

/** `at` writes the meter lets through at once, and how many a second it gives back. */
export const BURST = 10;
export const RATE = 4;

function entry(v: unknown): EntryState | null {
  return v && typeof v === 'object' && (v as EntryState).mapper === 1 ? (v as EntryState) : null;
}

export class AddressWriter {
  private pending: { handle: unknown } | null = null;
  private tokens = BURST;
  private filledAt: number | null = null;
  /** Each write, for a walk or a test to read. */
  readonly log: { how: 'push' | 'replace'; url: string }[] = [];

  constructor(
    private hist: HistoryLike,
    private search: () => string,
    private timers: Timers = realTimers,
  ) {}

  current(): Address {
    return parseAddress(this.search());
  }

  /** The Map the current entry shows: its state's when the page marked it, else its `map`. */
  shownMap(): string | null {
    const e = entry(this.hist.state);
    return e ? e.map : this.current().map;
  }

  depth(): number {
    return entry(this.hist.state)?.depth ?? 0;
  }

  cancelPending(): void {
    if (this.pending) this.timers.clear(this.pending.handle);
    this.pending = null;
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** A press: a new entry. Any pending `at` is cancelled first; `at` never rides into the new entry. */
  push(next: Address, shows: string | null = next.map): void {
    this.cancelPending();
    const url = formatAddress({ ...next, at: next.at ?? null });
    const state: EntryState = { mapper: 1, map: shows, depth: this.depth() + 1 };
    this.hist.pushState(state, '', url);
    this.log.push({ how: 'push', url });
  }

  /**
   * The page shows a Map on this entry without the address naming it (the element view's first
   * Map): kept on the entry's state, the address unchanged.
   */
  markShown(map: string | null): void {
    const state: EntryState = { mapper: 1, map, depth: this.depth() };
    try {
      this.hist.replaceState(state, '', formatAddress(this.current()));
    } catch {
      /* refused by the engine: the entry keeps its old state */
    }
  }

  /**
   * The end of the person's own camera gesture on `map`: write `at` by replaceState, now or after
   * `delay` (the wheel's idle). The write checks the entry still shows that Map.
   */
  gestureEnded(map: string, at: At, delay = 0): void {
    this.cancelPending();
    const write = () => {
      this.pending = null;
      if (this.shownMap() !== map) return;
      const now = this.current();
      const url = formatAddress({ ...now, map: now.map ?? map, at });
      const state: EntryState = entry(this.hist.state) ?? { mapper: 1, map, depth: 0 };
      this.fill();
      this.tokens = Math.max(0, this.tokens - 1);
      try {
        this.hist.replaceState(state, '', url);
      } catch {
        return; // refused (an engine's limit): the next gesture's end writes the camera
      }
      this.log.push({ how: 'replace', url });
    };
    this.fill();
    const wait = Math.max(delay, this.tokens >= 1 ? 0 : ((1 - this.tokens) * 1000) / RATE);
    if (wait <= 0) write();
    else this.pending = { handle: this.timers.set(write, wait) };
  }

  private fill(): void {
    const now = this.timers.now();
    if (this.filledAt !== null) this.tokens = Math.min(BURST, this.tokens + ((now - this.filledAt) * RATE) / 1000);
    this.filledAt = now;
  }
}
