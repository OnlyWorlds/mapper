// The page: the address decides what is shown, and a person's press or gesture is the only thing
// that writes it. Reads go one at a time through net/api.ts into the world store; each Map draws
// what has arrived as each read lands.
import { detectKeyKind, ELEMENT_TYPES, type OwWorldMeta } from '@onlyworlds/sdk';
import { mountWaymark } from '@onlyworlds/sdk/waymark';
import { AddressWriter, type Address } from './core/address';
import { elementMapOrder, readMap, type MapReading } from './core/kinds';
import { isId, linkId, str } from './core/rows';
import { build, GraphCache, type ReaderRung, type Scene } from './core/scene';
import { bodiesToRead, chunks, sliceFor, zonesToRead } from './core/slice';
import { WorldStore } from './core/store';
import type { ElementInfo, Row } from './core/types';
import { plural, progressLine, type ReadStep } from './core/words';
import { Api, asFailure, failureWords, ReadFailure } from './net/api';
import { button, clear, h, isPhone, typeName } from './ui/dom';
import { MapView, type MapStatus } from './ui/mapview';

/** Pin counts per Map are read only when every Pin of the world fits one read. */
export const ONE_READ = 1000;

export const EXAMPLES = [
  { id: '0695db52-5433-7332-8000-db7fe10da375', name: 'Moppetopia', words: 'a small demo world' },
  { id: '49501a68-179b-4a3c-8eaf-7f46f73d5fd2', name: 'Sikelia', words: 'a large one, with 214 maps' },
];

interface WorldState {
  id: string;
  api: Api;
  store: WorldStore;
  meta: OwWorldMeta;
  rung: ReaderRung;
  keyed: boolean;
  /** Reads that are done, by name: `maps`, `pins`, `pins@<map>`, `markers@<map>`. */
  done: Set<string>;
  pinCounts: Map<string, number> | null;
  /** Why the counts are left out, when they are. */
  countsNote: string | null;
  graphs: GraphCache;
  elements: Map<string, { body: Row | null; type: string | null; pins: Row[]; longWay: boolean }>;
  onWait: (line: string | null) => void;
}

const WAIT = (n: number) => `OnlyWorlds lets a visitor read 60 times a minute; reading again in ${n} s.`;

export class App {
  readonly writer: AddressWriter;
  private gen = 0;
  private key: string | null = null;
  private keyWorld: string | null = null;
  private keyNote: string | null = null;
  private world: WorldState | null = null;
  map: MapView | null = null;
  private page: HTMLElement;
  /** Aborted when the page is left: its reads in flight stop, its queued reads never start. */
  private leave = new AbortController();

  constructor(root: HTMLElement) {
    this.writer = new AddressWriter(history, () => location.search);
    this.page = h('main', { class: 'page' });
    root.append(this.page);
    window.addEventListener('popstate', () => {
      this.writer.cancelPending();
      void this.route();
    });
  }

  /** A press: a new entry, then the page follows it. */
  go(next: Address, shows: string | null = next.map): void {
    this.writer.push({ ...next, measure: this.writer.current().measure }, shows);
    void this.route();
  }

  private teardown(): void {
    this.leave.abort();
    this.leave = new AbortController();
    this.map?.destroy();
    this.map = null;
    clear(this.page);
    this.page.className = 'page';
  }

  async route(): Promise<void> {
    const gen = ++this.gen;
    const a = this.writer.current();
    this.teardown();
    if (!a.world) return this.front(null);
    if (!isId(a.world)) return this.front('This is not a world id. A world id looks like 0695db52-5433-7332-8000-db7fe10da375.');
    const ws = await this.ensureWorld(a.world, gen);
    if (!ws || gen !== this.gen) return;
    if (a.element) return this.elementPage(ws, a, gen);
    if (a.map) return this.mapPage(ws, a, gen, null, null);
    return this.mapsPage(ws, gen);
  }

  // ---- the front page and the key

  private front(error: string | null): void {
    document.title = 'OnlyWorlds mapper';
    const input = h('input', { id: 'world-id', name: 'world', autocomplete: 'off', spellcheck: 'false', placeholder: '0695db52-5433-7332-8000-db7fe10da375' });
    const msg = h('p', { class: 'error', role: 'alert' }, error ?? '');
    msg.hidden = !error;
    const form = h('form', { class: 'open-form' }, h('label', { for: 'world-id' }, 'World id'), h('div', { class: 'field' }, input, h('button', { type: 'submit' }, 'Open')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!isId(v)) {
        msg.textContent = 'This is not a world id. A world id looks like 0695db52-5433-7332-8000-db7fe10da375.';
        msg.hidden = false;
        return;
      }
      this.go({ ...this.writer.current(), world: v, map: null, element: null, type: null, at: null });
    });
    const examples = h('ul', { class: 'examples' });
    for (const ex of EXAMPLES) examples.append(h('li', {}, this.link(ex.name, { world: ex.id, map: null, element: null, type: null, at: null, measure: false }), `, ${ex.words}`));
    this.page.append(
      h('section', { class: 'intro' },
        h('h1', {}, 'OnlyWorlds mapper'),
        h('p', {}, 'See the maps of an OnlyWorlds world: its pictured maps with their Pins and Zones, and its layouts, where linked elements are joined by lines. The mapper only reads; it never changes a world.'),
        form, msg,
        h('p', {}, 'Public worlds to try:'), examples),
      h('section', { class: 'intro' }, h('h2', {}, 'A world of your own'), this.keyForm(null)),
    );
  }

  private link(text: string, to: Address): HTMLAnchorElement {
    const url = new URLSearchParams();
    if (to.world) url.set('world', to.world);
    if (to.map) url.set('map', to.map);
    const a = h('a', { href: `?${url}` }, text);
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      this.go(to);
    });
    return a;
  }

  /**
   * The key form: a read key, held in this page's memory only (a reload asks again), read when its
   * button is pressed and cleared from the field at once.
   *
   * A password field, so assistive technology reads it masked: a key spoken aloud, or read by an
   * accessibility tool, is a leak the person cannot see happen. It stands outside any form and asks
   * for no autocomplete, which is the answer to the browser's offer to save it: without a submitted
   * form the offer is rarely made, and a read key a person chose to save is the smaller harm.
   */
  private keyForm(addressWorld: string | null): HTMLElement {
    const input = h('input', { id: 'world-key', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'data-lpignore': 'true', 'data-1p-ignore': 'true', placeholder: 'ow_r_…' });
    const msg = h('p', { class: 'error', role: 'alert' });
    msg.hidden = true;
    const show = button('Show', () => {
      const shown = input.type === 'password';
      input.type = shown ? 'text' : 'password';
      show.textContent = shown ? 'Hide' : 'Show';
      show.setAttribute('aria-pressed', String(shown));
    }, { class: 'show-key', 'aria-pressed': 'false', 'aria-controls': 'world-key' });
    const open = h('button', { type: 'button', class: 'open-key' }, 'Open with this key');
    const form = h('div', { class: 'key-form', role: 'group', 'aria-labelledby': 'world-key-label' },
      h('label', { for: 'world-key', id: 'world-key-label' }, 'A read key for the world'),
      h('div', { class: 'field' }, input, show, open),
      h('p', { class: 'hint' }, 'Make a read key on onlyworlds.com, on the world’s page. It starts with ow_r_. The key stays in this page while it is open and is never stored: a reload asks for it again.'),
      msg);
    const say = (text: string, extra?: Node) => {
      clear(msg);
      msg.append(text);
      if (extra) msg.append(' ', extra);
      msg.hidden = false;
    };
    const submit = async () => {
      const key = input.value.trim();
      input.value = '';
      if (input.type !== 'password') show.click();
      const kind = detectKeyKind(key);
      if (kind === 'legacy') return say('Keys of ten digits are not taken here. Make a read key on onlyworlds.com (it starts with ow_r_) and paste that.');
      if (kind === 'account') return say('This is an account token, not a world key. Paste a world’s read key (it starts with ow_r_).');
      if (kind !== 'read' && kind !== 'write') return say('This does not look like a world key. A read key starts with ow_r_.');
      say('Reading the world with this key.');
      const api = new Api({ world: null, key });
      let meta: OwWorldMeta;
      try {
        meta = await api.world();
      } catch (err) {
        const f = asFailure(err);
        return say(f.status === 401 || f.status === 403 ? 'OnlyWorlds did not take this key.' : failureWords(f, 'world'));
      } finally {
        api.close();
      }
      const want = addressWorld ?? this.writer.current().world;
      if (want && isId(want) && meta.id !== want) {
        return say(`This key opens the world “${meta.name}”, not the one in the address.`, button(`Open “${meta.name}” instead`, () => {
          this.useKey(key, meta.id, kind);
          this.go({ world: meta.id, map: null, element: null, type: null, at: null, measure: false });
        }));
      }
      this.useKey(key, meta.id, kind);
      if (want === meta.id) void this.route();
      else this.go({ world: meta.id, map: null, element: null, type: null, at: null, measure: false });
    };
    open.addEventListener('click', () => void submit());
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      void submit();
    });
    return form;
  }

  private useKey(key: string, world: string, kind: string): void {
    this.world?.api.close();
    this.world = null;
    this.key = key;
    this.keyWorld = world;
    this.keyNote = kind === 'write' ? 'This is a write key. The mapper only reads, but a read key (ow_r_) is the safer one to paste.' : null;
  }

  // ---- the world

  private statusPage(title: string): { line: (text: string, cls?: string) => void; fail: (text: string, retry: () => void) => void; box: HTMLElement } {
    const box = h('div', { class: 'status-page', 'aria-live': 'polite' });
    this.page.append(h('section', { class: 'intro' }, h('h1', {}, title), box));
    return {
      box,
      line: (text, cls = 'progress') => {
        clear(box);
        box.append(h('p', { class: cls }, text));
      },
      fail: (text, retry) => {
        clear(box);
        box.append(h('p', { class: 'failure', role: 'alert' }, text + ' ', button('Try again', retry, { class: 'retry' })));
      },
    };
  }

  private async ensureWorld(id: string, gen: number): Promise<WorldState | null> {
    if (this.world && this.world.id === id) return this.world;
    this.world?.api.close();
    this.world = null;
    const keyed = !!this.key && this.keyWorld === id;
    const s = this.statusPage('Opening the world');
    s.line('Reading the world.');
    let waitLine: (l: string | null) => void = () => {};
    const api = new Api({ world: id, key: keyed ? this.key : null, onWait: (n) => waitLine(n ? WAIT(n) : null) });
    waitLine = (l) => l && s.line(l, 'wait');
    let meta: OwWorldMeta;
    try {
      meta = await api.world();
    } catch (err) {
      api.close();
      if (gen !== this.gen) return null;
      const f = asFailure(err);
      if (f.kind === 'not-found' && !keyed) {
        this.teardown();
        this.notPublic(id);
        return null;
      }
      s.fail(failureWords(f, 'world'), () => void this.route());
      return null;
    }
    let rung: ReaderRung = 'public';
    if (keyed) {
      try {
        const me = await api.me();
        rung = me.role === 'owner' ? 'owner' : 'guest';
      } catch {
        rung = 'guest';
      }
    }
    const ws: WorldState = {
      id, api, store: new WorldStore(), meta, rung, keyed, done: new Set(), pinCounts: null, countsNote: null,
      graphs: new GraphCache(), elements: new Map(), onWait: () => {},
    };
    waitLine = (l) => ws.onWait(l);
    if (gen !== this.gen) {
      this.world = ws;
      return null;
    }
    this.world = ws;
    clear(this.page);
    return ws;
  }

  private notPublic(id: string): void {
    document.title = 'Not opened · OnlyWorlds mapper';
    this.page.append(h('section', { class: 'intro' },
      h('h1', {}, 'This world could not be opened'),
      h('p', { class: 'error', role: 'alert' }, 'No public world has this id. It may be mistyped, or private: paste a key to open it.'),
      h('p', { class: 'mono' }, id),
      this.keyForm(id),
      h('p', {}, this.link('Back to the start', { world: null, map: null, element: null, type: null, at: null, measure: false }))));
  }

  /** The Maps (one read), then each Map's Pin count when every Pin of the world fits one read. */
  private async ensureMaps(ws: WorldState, say: (l: string | null, fail?: ReadFailure) => void, signal: AbortSignal): Promise<boolean> {
    if (!ws.done.has('maps')) {
      say('Reading the maps.');
      try {
        const maps = await ws.api.all('map', undefined, undefined, undefined, signal);
        ws.store.put('map', maps);
        ws.done.add('maps');
      } catch (err) {
        say(null, asFailure(err));
        return false;
      }
    }
    return true;
  }

  private async ensureCounts(ws: WorldState, signal: AbortSignal): Promise<void> {
    if (ws.pinCounts || ws.countsNote) return;
    const total = ws.meta.counts?.types?.pin;
    if (typeof total !== 'number') {
      ws.countsNote = 'OnlyWorlds did not say how many Pins this world has, so each map’s count is left out.';
      return;
    }
    if (total > ONE_READ) {
      ws.countsNote = `This world has ${plural(total, 'Pin')}, more than one read of ${ONE_READ.toLocaleString('en-US')} holds, so each map’s count is left out.`;
      return;
    }
    if (total > 0 && !ws.done.has('pins')) {
      const pins = await ws.api.all('pin', undefined, undefined, undefined, signal);
      ws.store.put('pin', pins);
      ws.done.add('pins');
    }
    const counts = new Map<string, number>();
    for (const p of ws.store.ofType('pin')) {
      const m = linkId(p.map);
      if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    ws.pinCounts = counts;
  }

  private worldHeading(ws: WorldState): HTMLElement {
    const name = h('h1', { class: 'world-name' }, ws.meta.name || 'A world with no name');
    try {
      mountWaymark(name, { world: { id: ws.id, name: ws.meta.name || 'World' }, reader: ws.keyed ? 'member' : 'public', tool: 'mapper', phone: isPhone() });
    } catch {
      /* the name stands alone */
    }
    return name;
  }

  private mapRow(ws: WorldState, r: MapReading, pressTo: Address, current = false): HTMLElement {
    const count = ws.pinCounts ? ws.pinCounts.get(r.id) ?? 0 : null;
    const b = button('', () => this.go(pressTo), { class: 'row map-row', 'aria-current': current ? 'true' : undefined });
    b.append(h('span', { class: 'row-name' }, r.name), h('span', { class: 'row-meta' }, [r.words, count !== null ? plural(count, 'Pin') : null].filter(Boolean).join(' · ')));
    return h('li', {}, b);
  }

  private async mapsPage(ws: WorldState, gen: number): Promise<void> {
    const signal = this.leave.signal;
    document.title = `${ws.meta.name} · OnlyWorlds mapper`;
    const status = h('div', { class: 'status-page', 'aria-live': 'polite' });
    const list = h('ul', { class: 'rows maps' });
    const countLine = h('p', { class: 'note' });
    countLine.hidden = true;
    const section = h('section', { class: 'intro wide' },
      h('p', { class: 'crumb' }, this.link('OnlyWorlds mapper', { world: null, map: null, element: null, type: null, at: null, measure: false })),
      this.worldHeading(ws),
      ws.keyed ? h('p', { class: 'note' }, ws.rung === 'owner' ? 'Read with your key, as the world’s owner.' : 'Read with your key, as this key reads it.') : null,
      this.keyNote && ws.keyed ? h('p', { class: 'note' }, this.keyNote) : null,
      status, countLine, list);
    this.page.append(section);
    ws.onWait = (l) => {
      clear(status);
      if (l) status.append(h('p', { class: 'wait' }, l));
    };
    const draw = () => {
      clear(list);
      const maps = ws.store.ofType('map');
      const readings = maps.map((m) => readMap(m, maps));
      readings.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
      for (const r of readings) list.append(this.mapRow(ws, r, { world: ws.id, map: r.id, element: null, type: null, at: null, measure: false }));
      if (!readings.length && ws.done.has('maps')) list.append(h('li', { class: 'note' }, 'This world has no maps this reader can see.'));
    };
    const run = async () => {
      clear(status);
      const ok = await this.ensureMaps(ws, (l, fail) => {
        clear(status);
        if (fail) status.append(h('p', { class: 'failure', role: 'alert' }, failureWords(fail, 'maps') + ' ', button('Try again', () => void run(), { class: 'retry' })));
        else if (l) status.append(h('p', { class: 'progress' }, l));
      }, signal);
      if (!ok || gen !== this.gen) return;
      clear(status);
      const n = ws.store.ofType('map').length;
      status.append(h('p', { class: 'counts' }, plural(n, 'map')));
      draw();
      try {
        if (!ws.pinCounts && !ws.countsNote) {
          countLine.hidden = false;
          countLine.textContent = 'Counting each map’s Pins.';
        }
        await this.ensureCounts(ws, signal);
      } catch (err) {
        if (gen !== this.gen) return;
        countLine.hidden = false;
        clear(countLine);
        countLine.append(failureWords(asFailure(err), 'Pins') + ' The counts are left out. ', button('Try again', () => void run(), { class: 'retry' }));
        return;
      }
      if (gen !== this.gen) return;
      countLine.hidden = !ws.countsNote;
      countLine.textContent = ws.countsNote ?? '';
      draw();
    };
    await run();
  }

  // ---- one element's maps

  private async elementPage(ws: WorldState, a: Address, gen: number): Promise<void> {
    const signal = this.leave.signal;
    const id = a.element!;
    const s = this.statusPage('Reading the element');
    ws.onWait = (l) => l && s.line(l, 'wait');
    if (!isId(id)) return s.line('This is not an element id.', 'error');
    if (a.type && !(ELEMENT_TYPES as readonly string[]).includes(a.type)) return s.line(`This address names no element type called “${a.type}”.`, 'error');
    const key = `${a.type ?? ''}:${id}`;
    let got = ws.elements.get(key);
    if (!got) {
      try {
        let body: Row | null = null;
        if (a.type) {
          s.line('Reading the element.');
          try {
            body = (await ws.api.get(a.type, id, signal)) as unknown as Row;
          } catch (err) {
            const f = asFailure(err);
            if (f.kind === 'not-found') return s.line('No element with this id that this reader can see in this world.', 'error');
            throw f;
          }
        }
        s.line('Reading the maps it is on.');
        const pins = await ws.api.all('pin', { element: id }, undefined, ['map'], signal);
        let longWay = false;
        let bodyType: string | null = a.type;
        if (!a.type) {
          longWay = true;
          const t = pins.map((p) => (typeof p.element_type === 'string' ? p.element_type.toLowerCase() : null)).find(Boolean);
          if (!t) return s.line('This address has no type, and no Pin this reader can see places this element, so it cannot be read.', 'error');
          bodyType = t;
          try {
            body = (await ws.api.get(t, id, signal)) as unknown as Row;
          } catch (err) {
            const f = asFailure(err);
            if (f.kind !== 'not-found') throw f;
          }
        }
        got = { body, type: bodyType, pins, longWay };
        ws.elements.set(key, got);
      } catch (err) {
        if (gen !== this.gen) return;
        return s.fail(failureWords(asFailure(err), 'element'), () => void this.route());
      }
    }
    if (gen !== this.gen) return;
    if (got.body && got.type) ws.store.put(got.type, [got.body]);
    // The Pins as served carry their Map expanded; the store keeps the Map's id as the link.
    ws.store.put('pin', got.pins.map((p) => ({ ...p, map: linkId(p.map) ?? p.map })));
    const ok = await this.ensureMaps(ws, (l, f) => (f ? s.fail(failureWords(f, 'maps'), () => void this.route()) : l && s.line(l)), signal);
    if (!ok || gen !== this.gen) return;
    const maps = ws.store.ofType('map');
    const mapIds = [...new Set(got.pins.map((p) => linkId(p.map)).filter((m): m is string => !!m && ws.store.typeOf(m) === 'map'))];
    const readings = elementMapOrder(mapIds.map((m) => readMap(ws.store.get(m)!, maps)), (m) => ws.pinCounts?.get(m) ?? null);
    const name = str(got.body, 'name') ?? 'An element this reader cannot see';
    const type = got.type;
    document.title = `${name} · ${ws.meta.name} · OnlyWorlds mapper`;
    if (!readings.length) {
      clear(this.page);
      this.page.append(h('section', { class: 'intro' },
        h('p', { class: 'crumb' }, this.link(ws.meta.name || 'The world', { world: ws.id, map: null, element: null, type: null, at: null, measure: false })),
        h('h1', {}, name), h('p', { class: 'type' }, typeName(type)),
        h('p', {}, 'No Pin places this element on any map this reader can see.')));
      return;
    }
    const open = a.map && readings.some((r) => r.id === a.map) ? a.map : readings[0].id;
    if (!a.map) this.writer.markShown(open);
    const nameEl = h('strong', { class: 'el-title' }, name);
    if (got.body && type) {
      try {
        mountWaymark(nameEl, { world: { id: ws.id, name: ws.meta.name }, element: { id, type, name }, reader: ws.keyed ? 'member' : 'public', tool: 'mapper', phone: isPhone() });
      } catch {
        /* the name stands alone */
      }
    }
    const others = h('ul', { class: 'chips', id: 'element-maps' });
    for (const r of readings) {
      const b = button(r.name, () => this.go({ world: ws.id, type: a.type, element: id, map: r.id, at: null, measure: false }), { class: 'chip', 'aria-current': r.id === open ? 'true' : undefined, title: r.words });
      others.append(h('li', {}, b));
    }
    const onMaps = `on ${plural(readings.length, 'map')}`;
    // On a phone the chips fold behind one button, so the map keeps the screen (rule 10).
    const header: HTMLElement = h('div', { class: `element-head${readings.length > 1 ? '' : ' single'}` });
    const fold = readings.length > 1
      ? button(onMaps, () => {
          const shown = header.classList.toggle('open');
          fold?.setAttribute('aria-expanded', String(shown));
          this.map?.layoutChanged();
        }, { class: 'maps-fold', 'aria-expanded': 'false', 'aria-controls': 'element-maps' })
      : null;
    header.append(
      h('p', {}, nameEl, ` · ${typeName(type)} · `, h('span', { class: 'on-maps' }, onMaps), fold),
      others);
    if (got.longWay) header.append(h('p', { class: 'note' }, 'The address has no type, so the element was found the long way, through its Pins.'));
    await this.mapPage(ws, { ...a, map: open }, gen, id, header);
  }

  // ---- a Map

  infoOf(ws: WorldState, id: string): ElementInfo {
    const b = ws.store.get(id);
    const t = ws.store.typeOf(id) ?? null;
    if (!b) return { id, type: null, name: null, hidden: false, knownOf: false };
    return { id, type: t, name: str(b, 'name'), hidden: b.hidden === true, knownOf: b.known_of === true };
  }

  private async mapPage(ws: WorldState, a: Address, gen: number, element: string | null, header: HTMLElement | null): Promise<void> {
    const signal = this.leave.signal;
    const mapId = a.map!;
    if (!element) {
      const s = this.statusPage('Opening the map');
      ws.onWait = (l) => l && s.line(l, 'wait');
      const ok = await this.ensureMaps(ws, (l, f) => (f ? s.fail(failureWords(f, 'maps'), () => void this.route()) : l && s.line(l)), signal);
      if (!ok || gen !== this.gen) return;
      if (ws.store.typeOf(mapId) !== 'map') {
        s.line('This world has no map with this id that this reader can see.', 'error');
        s.box.append(h('p', {}, this.link('See the world’s maps', { world: ws.id, map: null, element: null, type: null, at: null, measure: false })));
        return;
      }
    }
    clear(this.page);
    this.page.className = 'page full';
    const maps = ws.store.ofType('map');
    const reading = readMap(ws.store.get(mapId)!, maps, ws.store.ofType('pin'));
    const groundRow = reading.ground ? ws.store.get(reading.ground) : undefined;
    const ground = groundRow ? readMap(groundRow, maps) : null;
    document.title = `${reading.name} · ${ws.meta.name} · OnlyWorlds mapper`;

    const notes: string[] = [];
    if (reading.kind === 'layout3d') notes.push(`This layout has a depth of ${reading.depth}. The 3D view comes in a later version; it is drawn flat here.`);
    else if (reading.depth !== null) notes.push(`This map has a depth of ${reading.depth}; it is drawn flat.`);
    if (ground) {
      const where = reading.marginRead ? `at ${reading.groundOffset[0]}, ${reading.groundOffset[1]} (its margin, from the layout's own settings)` : 'at 0, 0 (the layout names no margin)';
      const what = ground.picture ? 'its picture and Zones are drawn under the Pins' : 'it has no picture, so only its Zones are drawn';
      notes.push(`Drawn over its ground, the map ${ground.name}, placed ${where}: ${what}. The ground's own Pins are not drawn.`);
    }
    if (reading.pictureRefused) notes.push('This map names a picture that is not on a secure (https) address, so it is not drawn.');
    if (ws.keyed) notes.push('Elements marked hidden are drawn as Pins without links, as the OnlyWorlds graph rules have it.');

    let pictureSize: { w: number; h: number } | null = null;
    const host = {
      world: { id: ws.id, name: ws.meta.name },
      waymarkReader: (ws.keyed ? 'member' : 'public') as 'member' | 'public',
      writer: this.writer,
      measure: a.measure,
      infoOf: (id: string) => this.infoOf(ws, id),
      pinRow: (id: string) => ws.store.get(id),
      pictureSized: (url: string, size: { w: number; h: number } | null) => {
        if (url !== reading.picture) return;
        pictureSize = size;
        derive();
      },
      back: () => {
        if (this.writer.depth() > 0) history.back();
        else this.go({ world: ws.id, map: null, element: null, type: null, at: null, measure: false });
      },
    };
    const mv = new MapView(host, this.page, reading, ground, { at: a.at, element });
    this.map = mv;
    if (header) mv.setExtra(header);

    const steps: ReadStep[] = [
      { name: 'Pins', state: 'waiting', calls: 0 },
      { name: 'Markers', state: 'waiting', calls: 0 },
      { name: 'Zones', state: 'waiting', calls: 0 },
      { name: 'elements', state: 'waiting', calls: 0 },
    ];
    const status: MapStatus = { progress: null, long: null, wait: null, failure: null, drawing: null, notes };
    const push = () => {
      status.progress = progressLine(steps);
      if (gen === this.gen) mv.setStatus({ ...status });
    };
    ws.onWait = (l) => {
      status.wait = l;
      push();
    };
    const markerMaps = [mapId, ...(ground ? [ground.id] : [])];
    let complete = false;
    // A builder or drawing error is not a read's: it is said as the map's, kept for the console, and
    // never fails the read that landed (its Try again would only repeat it).
    const derive = () => {
      if (gen !== this.gen) return;
      try {
        const slice = sliceFor(ws.store, mapId, ground?.id ?? null, {
          markersComplete: markerMaps.every((m) => ws.done.has(`markers@${m}`)),
          zonesComplete: steps[2].state === 'done',
        });
        const scene: Scene = build({ slice, reading, ground, rung: ws.rung, complete, pictureSize, versionOf: (id) => ws.store.version(id) }, ws.graphs);
        mv.setScene(scene);
        if (status.drawing) {
          status.drawing = null;
          push();
        }
      } catch (err) {
        console.error(err);
        status.drawing = 'This map could not be drawn from what was read.';
        push();
      }
    };

    const runStep = async (i: number, fn: () => Promise<void>) => {
      if (steps[i].state === 'done') return;
      steps[i].state = 'running';
      push();
      const t0 = performance.now();
      const longTimer = window.setInterval(() => {
        if (performance.now() - t0 > 4000) {
          status.long = `This read is taking a while: OnlyWorlds sends at most ${ONE_READ.toLocaleString('en-US')} rows a read, one read at a time (${plural(steps[i].calls, 'read')} so far).`;
          push();
        }
      }, 1000);
      try {
        await fn();
        steps[i].state = 'done';
      } finally {
        clearInterval(longTimer);
        status.long = null;
      }
      push();
    };

    const run = async () => {
      status.failure = null;
      for (const st of steps) if (st.state === 'failed') st.state = 'waiting';
      push();
      try {
        await runStep(0, async () => {
          if (ws.done.has('pins') || ws.done.has(`pins@${mapId}`)) return;
          await ws.api.all('pin', { map: mapId }, (rows) => {
            steps[0].calls++;
            ws.store.put('pin', rows);
            derive();
          }, undefined, signal);
          ws.done.add(`pins@${mapId}`);
        });
        derive();
        await runStep(1, async () => {
          for (const m of markerMaps) {
            if (ws.done.has(`markers@${m}`)) continue;
            await ws.api.all('marker', { map: m }, (rows) => {
              steps[1].calls++;
              ws.store.put('marker', rows);
            }, undefined, signal);
            ws.done.add(`markers@${m}`);
          }
        });
        derive();
        await runStep(2, async () => {
          for (const part of chunks(zonesToRead(ws.store, mapId, ground?.id ?? null))) {
            const got = await ws.api.byIds('zone', part, undefined, signal);
            steps[2].calls++;
            ws.store.put('zone', got);
            const seen = new Set(got.map((r) => r.id));
            for (const z of part) if (!seen.has(z)) ws.store.unseen.add(z);
            derive();
          }
        });
        derive();
        await runStep(3, async () => {
          for (const [type, ids] of bodiesToRead(ws.store, mapId)) {
            for (const part of chunks(ids)) {
              const got = await ws.api.byIds(type, part, undefined, signal);
              steps[3].calls++;
              ws.store.put(type, got);
              const seen = new Set(got.map((r) => r.id));
              for (const e of part) if (!seen.has(e)) ws.store.unseen.add(e);
              derive();
            }
          }
        });
        complete = true;
        derive();
      } catch (err) {
        if (gen !== this.gen) return;
        const f = asFailure(err);
        const i = steps.findIndex((st) => st.state === 'running');
        if (i >= 0) steps[i].state = 'failed';
        status.failure = { text: failureWords(f, i >= 0 ? steps[i].name : 'map'), retry: () => void run() };
        push();
      }
    };
    push();
    derive();
    await run();
  }
}
