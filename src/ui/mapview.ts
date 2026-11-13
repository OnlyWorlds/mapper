// One Map opened flat. It draws the scene list it is handed and runs the view pass over it: the
// camera, the selection (a set of item ids), the hover, the lines toggle, the labels placed when the
// camera rests, the element view's mark. The pointer asks the list (core/hit.ts) and goes through
// the one-mode table (ui/modes.ts); the camera owns the wheel and two fingers.
import { fieldLabel } from '@onlyworlds/sdk';
import { mountWaymark } from '@onlyworlds/sdk/waymark';
import type { AddressWriter } from '../core/address';
import { atOf, cameraFromAt, centreOn, fit, limitsFor, panBy, toMap, toScreen, zoomAt, type At, type Camera, type View } from '../core/camera';
import { pick } from '../core/hit';
import { linesAlwaysOn, type MapReading } from '../core/kinds';
import { placeLabels, type Placed } from '../core/labels';
import { byName } from '../core/rows';
import type { Scene } from '../core/scene';
import type { ElementInfo, Item, ItemKind, LabelItem, LineItem, PinItem, Row, ZoneItem } from '../core/types';
import { countsLine, outLine, plural } from '../core/words';
import { Picture } from '../view/picture';
import { readTheme, Renderer, type Theme } from '../view/render';
import { button, clear, h, isPhone, typeName } from './dom';
import { makeModes, type ModeHost, type ModeName } from './modes';

export interface MapViewHost {
  world: { id: string; name: string };
  waymarkReader: 'member' | 'public';
  writer: AddressWriter;
  measure: boolean;
  infoOf(id: string): ElementInfo;
  pinRow(pinId: string): Row | undefined;
  /** A picture's natural size arrived (or its time limit passed: null), for a Map with no written size. */
  pictureSized(url: string, size: { w: number; h: number } | null): void;
  back(): void;
}

export interface MapStatus {
  progress: string | null;
  long: string | null;
  wait: string | null;
  failure: { text: string; retry: () => void } | null;
  /** The map could not be drawn from what was read (a builder error, not a read's): no Try again. */
  drawing: string | null;
  notes: string[];
}

interface Stats {
  openedAt: number;
  firstPictureDrawMs: number | null;
  frames: number[];
  draws: number[];
}

/** How long a wheel, a key or a button waits with no further step before `at` is written. */
const IDLE_MS = 300;

function firstItem(s: Scene, ids: ReadonlySet<string>): Item | undefined {
  for (const id of ids) {
    const it = s.byId.get(id);
    if (it) return it;
  }
  return undefined;
}

function p95(list: readonly number[]): number | null {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

function p50(list: readonly number[]): number | null {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export class MapView implements ModeHost {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: Renderer;
  private theme: Theme;
  scene: Scene | null = null;
  camera: Camera | null = null;
  private view: View = { w: 1, h: 1 };
  private dpr = 1;
  /** The camera was fitted (or set from the address, or by the person) and stays where it is. */
  private settled = false;
  private personMoved = false;
  selection = new Set<string>();
  hover: string | null = null;
  marked = new Set<string>();
  private many: string[] = [];
  hidden = new Set<ItemKind>();
  labels: Placed[] = [];
  readonly pictures = new Map<string, Picture>();
  private linesOn: boolean;
  private focus: string | null;
  private focusDone = false;
  private at: At | null;
  private modes = makeModes();
  private mode: ModeName = 'look';
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; mx: number; my: number; cam: Camera } | null = null;
  private twoFinger = false;
  private frameReq = 0;
  private restTimer = 0;
  private lastMove = 0;
  private lastFrameAt = 0;
  private listOpen = false;
  private status: MapStatus = { progress: null, long: null, wait: null, failure: null, drawing: null, notes: [] };
  private els: {
    title: HTMLElement;
    head: HTMLElement;
    extra: HTMLElement;
    lines: HTMLElement;
    linesBtn: HTMLButtonElement | null;
    listBtn: HTMLButtonElement;
    panel: HTMLElement;
    card: HTMLElement;
    list: HTMLElement;
    tip: HTMLElement;
    readout: HTMLElement | null;
    lost: HTMLElement;
  };
  /** Scenes handed to this view: a walk checks that a camera move derives nothing. */
  sceneCount = 0;
  /** The element view's centring is done (it waits for the frame, like the fit). */
  private centred = false;
  /** On a phone, the element view's card opens as a one-line peek; Details opens the sheet. */
  peek = false;
  /**
   * The selected Pin is kept clear of the overlays until the person moves the camera: a status
   * line or the element head growing moves the camera again (never written to the address).
   */
  private holdClear = false;
  private disposers: (() => void)[] = [];
  private waymarks: (() => void)[] = [];
  readonly stats: Stats = { openedAt: performance.now(), firstPictureDrawMs: null, frames: [], draws: [] };

  constructor(
    private host: MapViewHost,
    parent: HTMLElement,
    readonly reading: MapReading,
    readonly ground: MapReading | null,
    opts: { at: At | null; element: string | null },
  ) {
    this.at = opts.at;
    this.focus = opts.element;
    this.linesOn = linesAlwaysOn(reading.kind);
    if (!this.linesOn) this.hidden.add('line');

    this.canvas = h('canvas', { class: 'surface', tabindex: '0', role: 'img', 'aria-label': `The map ${reading.name}. The List button lists what it places.` });
    this.renderer = new Renderer(this.canvas);
    this.theme = readTheme(document.documentElement);

    const back = button('Back', () => this.host.back(), { class: 'back' });
    const title = h('h1', { class: 'map-name', title: reading.name }, reading.name);
    const kind = h('span', { class: 'kind' }, reading.words);
    const listBtn = button('List', () => this.toggleList(), { 'aria-expanded': 'false', 'aria-controls': 'panel' });
    const linesBtn = this.linesOn ? null : button('Show links', () => this.toggleLines(), { 'aria-pressed': 'false' });
    const extra = h('div', { class: 'extra' });
    const lines = h('div', { class: 'status', 'aria-live': 'polite' });
    const head = h('div', { class: 'top' }, h('div', { class: 'bar' }, back, h('div', { class: 'titles' }, title, kind), h('div', { class: 'tools' }, listBtn, linesBtn)), extra, lines);
    const card = h('section', { class: 'card', 'aria-label': 'Selected' });
    const list = h('section', { class: 'maplist', 'aria-label': 'What this map places', hidden: true });
    const panel = h('aside', { class: 'panel', id: 'panel', hidden: true }, card, list);
    const tip = h('div', { class: 'tip', role: 'tooltip', hidden: true });
    const zoom = h('div', { class: 'zoom' },
      button('+', () => this.zoomButton(1.6), { 'aria-label': 'Zoom in' }),
      button('−', () => this.zoomButton(1 / 1.6), { 'aria-label': 'Zoom out' }),
      button('Fit', () => this.fitButton(), { 'aria-label': 'Fit the map' }));
    const lost = h('div', { class: 'lost', hidden: true }, 'The drawing was lost by the browser. It is drawn again when the browser gives it back.');
    const readout = host.measure ? h('div', { class: 'readout', 'aria-live': 'off' }) : null;
    this.root = h('div', { class: 'mapview' }, this.canvas, head, zoom, panel, tip, lost, readout);
    this.els = { title, head, extra, lines, linesBtn, listBtn, panel, card, list, tip, readout, lost };
    parent.append(this.root);
    this.listen();
    this.resize();
    this.renderStatus();
  }

  // ---- the scene and the camera

  setScene(scene: Scene): void {
    this.sceneCount++;
    this.scene = scene;
    this.renderer.setScene(scene);
    for (const it of scene.items) {
      if (it.kind !== 'picture' || this.pictures.has(it.url)) continue;
      const pic = new Picture(it.url, () => this.pictureChanged(pic));
      this.pictures.set(it.url, pic);
      void pic.load();
    }
    // Keep only selected items the list still holds.
    for (const id of [...this.selection]) if (!scene.byId.has(id)) this.selection.delete(id);
    this.placeCamera();
    this.applyFocus();
    if (this.listOpen) this.renderList();
    this.renderCard();
    this.scheduleRest(0);
    this.renderStatus();
    this.invalidate();
  }

  /**
   * A Map with no written size and a picture of its own waits for the frame to come from that
   * picture (or for the picture to fail, or its time limit to pass): never a fit to its points'
   * extent while a picture is coming. The frame, not the picture's own field, is what is waited on:
   * the picture knows its size a little before the scene's frame takes it.
   */
  private waitsForPicture(): boolean {
    const s = this.scene;
    if (!s || s.frame.from === 'written' || s.frame.from === 'picture') return false;
    if (!this.reading.picture) return false;
    const own = this.pictures.get(this.reading.picture);
    return !own || own.state !== 'failed';
  }

  /** The camera fits once, when the frame is known; an `at` from the address wins. */
  private placeCamera(): void {
    const s = this.scene;
    if (!s || this.settled) return;
    if (this.at) {
      this.camera = cameraFromAt(this.at, this.view);
      this.settled = true;
      return;
    }
    if (this.waitsForPicture()) return;
    if (this.personMoved) {
      this.settled = true;
      return;
    }
    this.camera = this.fitCam(s.frame.w, s.frame.h);
    if (s.frame.from === 'written' || s.frame.from === 'picture' || s.complete) this.settled = true;
  }

  /** The element view: every item of the element selected and marked, its first Pin centred (once). */
  private applyFocus(): void {
    const s = this.scene;
    if (!s || !this.focus) return;
    const ids = s.byElement.get(this.focus) ?? [];
    if (!ids.length) return;
    this.marked = new Set(ids.filter((id) => s.byId.get(id)?.kind === 'pin'));
    if (!this.focusDone) {
      this.selection = new Set(ids);
      this.many = [];
      this.clearPending = true;
      this.holdClear = true;
      this.peek = isPhone();
      this.focusDone = true;
    }
    if (this.centred || this.at || this.personMoved || s.frame.from === 'none' || this.waitsForPicture()) return;
    const pin = ids.map((id) => s.byId.get(id)).find((it): it is PinItem => it?.kind === 'pin');
    if (!pin) return;
    this.camera = centreOn(s.frame.w, s.frame.h, this.view, pin.x, pin.y);
    this.settled = true;
    this.centred = true;
    this.clearPending = true;
  }

  /** A fit inside what the overlays leave free: below the bar and its status lines. */
  private fitCam(w: number, hgt: number): Camera {
    const top = Math.max(0, this.els.head.getBoundingClientRect().bottom - this.root.getBoundingClientRect().top + 4);
    return fit(w, hgt, this.view, 0.94, { top, right: 0, bottom: 0, left: 0 });
  }

  private limits(): [number, number] {
    const f = this.scene?.frame ?? { w: 1000, h: 1000 };
    return limitsFor(f.w, f.h, this.view);
  }

  private moved(): void {
    this.lastMove = performance.now();
    this.settled = true;
    this.personMoved = true;
    this.holdClear = false;
    this.scheduleRest(160);
    this.invalidate();
  }

  pan(dx: number, dy: number): void {
    if (!this.camera) return;
    this.camera = panBy(this.camera, dx, dy);
    this.moved();
  }

  /**
   * The person's camera gesture ended: `at` is written now (a drag's or a pinch's end), or after
   * `idle` ms with no further step (the wheel, a key held or pressed again, a button pressed again),
   * so a held key never writes on every repeat.
   */
  gestureEnded(idle = 0): void {
    if (this.camera && this.scene) this.host.writer.gestureEnded(this.reading.id, atOf(this.camera, this.view), idle);
  }

  private zoomButton(f: number): void {
    if (!this.camera) return;
    this.camera = zoomAt(this.camera, this.view, this.view.w / 2, this.view.h / 2, f, this.limits());
    this.moved();
    this.gestureEnded(IDLE_MS);
  }

  private fitButton(): void {
    if (!this.scene) return;
    this.camera = this.fitCam(this.scene.frame.w, this.scene.frame.h);
    this.moved();
    this.gestureEnded(IDLE_MS);
  }

  // ---- the pointer

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private pickAt(sx: number, sy: number, touch: boolean, many: boolean): string[] {
    const s = this.scene;
    if (!s || !this.camera) return [];
    const [x, y] = toMap(this.camera, this.view, sx, sy);
    const r = (touch ? 14 : 8) / this.camera.s;
    return pick(s.grid, { x, y, r, sx, sy, hidden: this.hidden, labels: this.labels, many });
  }

  press(cx: number, cy: number, touch: boolean): void {
    const [sx, sy] = this.local({ clientX: cx, clientY: cy });
    const ids = this.pickAt(sx, sy, touch, touch);
    this.many = ids.length > 1 ? ids : [];
    this.selection = new Set(ids);
    this.peek = false;
    this.clearPending = ids.length > 0;
    this.holdClear = ids.length > 0;
    this.renderCard();
    this.invalidate();
  }

  private hoverAt(e: PointerEvent): void {
    const [sx, sy] = this.local(e);
    const id = this.pickAt(sx, sy, false, false)[0] ?? null;
    const tip = this.els.tip;
    if (id !== this.hover) {
      this.hover = id;
      this.invalidate();
    }
    if (!id) {
      tip.hidden = true;
      this.canvas.style.cursor = '';
      return;
    }
    tip.textContent = this.itemWords(id);
    tip.hidden = false;
    const r = this.root.getBoundingClientRect();
    tip.style.left = `${Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.max(8, e.clientY - r.top - 34)}px`;
    this.canvas.style.cursor = 'pointer';
  }

  private listen(): void {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, type: K | string, fn: (e: never) => void, o?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, o);
      this.disposers.push(() => t.removeEventListener(type, fn as EventListener, o));
    };
    const mode = () => this.modes[this.mode];
    on(c, 'pointerdown', (e: PointerEvent) => {
      // A primary pointer going down means no other is down: drop any whose end never arrived.
      if (e.isPrimary && this.pointers.size) {
        this.pointers.clear();
        this.pinch = null;
        this.twoFinger = false;
        mode().cancel(this);
      }
      try {
        c.setPointerCapture?.(e.pointerId);
      } catch {
        /* a pointer the engine does not know: its events still reach the canvas */
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.els.tip.hidden = true;
      if (this.pointers.size === 1) {
        this.twoFinger = false;
        mode().down(this, e);
      } else if (this.pointers.size === 2 && this.camera) {
        // Two fingers belong to the camera in every mode.
        mode().cancel(this);
        this.twoFinger = true;
        const [a, b] = [...this.pointers.values()];
        const [mx, my] = this.local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx, my, cam: this.camera };
      }
    });
    on(c, 'pointermove', (e: PointerEvent) => {
      if (this.pointers.has(e.pointerId)) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pinch && this.pointers.size >= 2) {
          const [a, b] = [...this.pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          const [mx, my] = this.local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
          const p = this.pinch;
          let cam = zoomAt(p.cam, this.view, p.mx, p.my, d / p.d, this.limits());
          cam = panBy(cam, mx - p.mx, my - p.my);
          this.camera = cam;
          this.moved();
        } else if (!this.twoFinger) mode().move(this, e);
      } else if (e.pointerType === 'mouse' && e.buttons === 0) this.hoverAt(e);
    });
    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.twoFinger) {
        if (this.pointers.size === 0) {
          this.twoFinger = false;
          this.pinch = null;
          this.gestureEnded();
        }
        return;
      }
      if (e.type === 'pointercancel') mode().cancel(this);
      else mode().up(this, e);
    };
    on(c, 'pointerup', end);
    on(c, 'pointercancel', end);
    on(c, 'pointerleave', (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && this.hover) {
        this.hover = null;
        this.els.tip.hidden = true;
        this.invalidate();
      }
    });
    on(c, 'wheel', (e: WheelEvent) => {
      if (!this.camera) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const [sx, sy] = this.local(e);
      this.camera = zoomAt(this.camera, this.view, sx, sy, Math.exp(-e.deltaY * unit * 0.0015), this.limits());
      this.moved();
      this.gestureEnded(IDLE_MS);
    }, { passive: false });
    on(c, 'keydown', (e: KeyboardEvent) => {
      if (!this.camera) return;
      const step = 60;
      const k = e.key;
      if (k === '+' || k === '=') this.zoomButton(1.4);
      else if (k === '-' || k === '_') this.zoomButton(1 / 1.4);
      else if (k === '0') this.fitButton();
      else if (k.startsWith('Arrow')) {
        const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[k];
        if (!d) return;
        this.pan(d[0], d[1]);
        this.gestureEnded(IDLE_MS);
      } else if (k === 'Escape') this.clearSelection();
      else return;
      e.preventDefault();
    });
    on(c, 'contextlost', () => {
      this.els.lost.hidden = false;
    });
    on(c, 'contextrestored', () => {
      this.els.lost.hidden = true;
      this.restored++;
      this.invalidate();
    });
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !this.els.panel.hidden && document.activeElement !== this.canvas) this.clearSelection();
    });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    on(mq, 'change', () => {
      this.theme = readTheme(document.documentElement);
      this.invalidate();
    });
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.root);
    this.disposers.push(() => ro.disconnect());
  }

  /** How many times the canvas drew again on `contextrestored`. */
  restored = 0;

  private resize(): void {
    const r = this.root.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const hgt = Math.max(1, Math.round(r.height));
    if (w === this.view.w && hgt === this.view.h && this.dpr === (window.devicePixelRatio || 1)) return;
    const before = this.view;
    this.view = { w, h: hgt };
    this.dpr = window.devicePixelRatio || 1;
    this.renderer.resize(this.view, this.dpr);
    if (this.camera && this.scene && !this.personMoved && !this.at && !this.focus) {
      this.camera = this.fitCam(this.scene.frame.w, this.scene.frame.h);
    } else if (this.camera && before.w > 1) {
      // Keep the same area across the shorter side.
      this.camera = { ...this.camera, s: (this.camera.s * Math.min(w, hgt)) / Math.min(before.w, before.h) };
    }
    if (!this.camera) this.placeCamera();
    this.scheduleRest(0);
    this.invalidate();
  }

  // ---- drawing

  invalidate(): void {
    if (this.frameReq) return;
    this.frameReq = requestAnimationFrame((t) => {
      this.frameReq = 0;
      this.draw(t);
    });
  }

  private draw(t: number): void {
    if (!this.camera) {
      this.renderer.draw({ camera: { cx: 0, cy: 0, s: 1 }, view: this.view, dpr: this.dpr, selection: this.selection, hover: null, marked: this.marked, hidden: this.hidden, labels: [], pictures: this.pictures, theme: this.theme });
      return;
    }
    this.renderer.draw({ camera: this.camera, view: this.view, dpr: this.dpr, selection: this.selection, hover: this.hover, marked: this.marked, hidden: this.hidden, labels: this.labels, pictures: this.pictures, theme: this.theme });
    const moving = t - this.lastMove < 200 || this.pointers.size > 0;
    if (moving && this.lastFrameAt && t - this.lastFrameAt < 1000) this.stats.frames.push(t - this.lastFrameAt);
    if (moving) this.stats.draws.push(this.renderer.lastDrawMs);
    this.lastFrameAt = t;
    if (this.renderer.drewPicture && this.stats.firstPictureDrawMs === null) this.stats.firstPictureDrawMs = performance.now() - this.stats.openedAt;
    if (this.stats.frames.length > 2000) this.stats.frames.splice(0, 1000);
    if (this.stats.draws.length > 2000) this.stats.draws.splice(0, 1000);
    this.renderReadout();
  }

  /** The camera rested: the view pass chooses the labels again. */
  private scheduleRest(ms: number): void {
    clearTimeout(this.restTimer);
    this.restTimer = window.setTimeout(() => this.placeLabelsNow(), ms);
  }

  private placeLabelsNow(): void {
    const s = this.scene;
    if (!s || !this.camera || !s.complete) {
      this.labels = [];
      return;
    }
    const cands = [];
    for (const it of s.items) {
      if (it.kind !== 'label') continue;
      const a = s.byId.get((it as LabelItem).anchor) as PinItem | undefined;
      if (!a) continue;
      const [sx, sy] = toScreen(this.camera, this.view, a.x, a.y);
      cands.push({ anchor: a.id, text: (it as LabelItem).text, sx, sy });
    }
    const max = Math.min(40, Math.max(8, Math.floor((this.view.w * this.view.h) / 24000)));
    this.labels = placeLabels(cands, (t) => this.renderer.measure(t, this.theme), { w: this.view.w, h: this.view.h, max, font: 12, gap: 8 });
    this.invalidate();
  }

  private pictureChanged(pic: Picture): void {
    if (pic.natural || pic.state === 'failed') {
      if (this.scene?.frame.from === 'points' || this.scene?.frame.from === 'none') this.host.pictureSized(pic.url, pic.natural);
    }
    this.renderStatus();
    this.invalidate();
  }

  // ---- words on the page

  setStatus(s: MapStatus): void {
    this.status = s;
    this.renderStatus();
  }

  /** The element view's own lines, above the map's status. */
  setExtra(node: Node | null): void {
    clear(this.els.extra);
    if (node) this.els.extra.append(node);
  }

  private renderStatus(): void {
    const box = this.els.lines;
    clear(box);
    const line = (text: string, cls = '') => box.append(h('p', { class: cls }, text));
    const s = this.scene;
    if (s) line(countsLine(s.counts), 'counts');
    if (this.status.progress) line(this.status.progress, 'progress');
    if (this.status.long) line(this.status.long, 'progress');
    if (this.status.wait) line(this.status.wait, 'wait');
    if (this.status.failure) {
      const f = this.status.failure;
      box.append(h('p', { class: 'failure', role: 'alert' }, f.text + ' ', button('Try again', f.retry, { class: 'retry' })));
    }
    if (this.status.drawing) box.append(h('p', { class: 'failure drawing', role: 'alert' }, this.status.drawing));
    for (const url of this.pictures.keys()) {
      const pic = this.pictures.get(url)!;
      const whose = this.ground?.picture === url ? "The ground's picture" : 'The picture';
      if (pic.state === 'reading') line(`${whose} is being read.`, 'progress');
      else if (pic.state === 'decoding') line(`${whose} is being decoded.`, 'progress');
      else if (pic.state === 'failed') {
        box.append(h('p', { class: 'failure' }, `${whose} did not load; the map is drawn without it. `, button('Try again', () => this.retryPicture(url), { class: 'retry' })));
      }
    }
    if (s) {
      const o = outLine(s);
      if (o) line(o, 'out');
      if (s.frame.from === 'picture') line("This map has no written size; it takes its picture's size.");
      else if (s.frame.from === 'points') line('This map has no written size; its frame is measured from its points.');
      if (this.reading.depth !== null && s.zMax !== null && s.zMax > this.reading.depth) line(`Some points stand higher than the map's depth of ${this.reading.depth}; they are drawn where written.`);
    }
    for (const n of this.status.notes) line(n, 'note');
    this.layoutChanged();
  }

  /** The overlays changed size (a status line, the element head's maps): keep the selection clear. */
  layoutChanged(): void {
    if (this.holdClear) this.keepClear();
  }

  private retryPicture(url: string): void {
    const old = this.pictures.get(url);
    old?.close();
    const pic = new Picture(url, () => this.pictureChanged(pic));
    this.pictures.set(url, pic);
    void pic.load();
    this.renderStatus();
  }

  private renderReadout(): void {
    const el = this.els.readout;
    if (!el) return;
    const own = this.reading.picture ? this.pictures.get(this.reading.picture) : this.ground?.picture ? this.pictures.get(this.ground.picture) : undefined;
    const f = (n: number | null) => (n === null ? 'none' : n.toFixed(1));
    const parts = [
      `picture first draw ${f(this.stats.firstPictureDrawMs)} ms after open`,
      own ? `picture read ${f(own.times.readMs)} ms, first copy ${f(own.times.firstCopyMs)} ms, all copies ${f(own.times.allCopiesMs)} ms` : 'no picture',
      `frame p50 ${f(p50(this.stats.frames))} ms, p95 ${f(p95(this.stats.frames))} ms over ${this.stats.frames.length} frames`,
      `draw p95 ${f(p95(this.stats.draws))} ms`,
      `list derive ${f(this.scene?.ms ?? null)} ms, ${this.scene?.items.length ?? 0} items`,
    ];
    el.textContent = parts.join(' · ');
    el.dataset.firstDraw = f(this.stats.firstPictureDrawMs);
    el.dataset.p95 = f(p95(this.stats.frames));
    el.dataset.p50 = f(p50(this.stats.frames));
    el.dataset.frames = String(this.stats.frames.length);
    el.dataset.drawP95 = f(p95(this.stats.draws));
  }

  // ---- what an item is, in words

  private nameOf(element: string | null, pinId?: string): string {
    if (!element) {
      const row = pinId ? this.host.pinRow(pinId) : undefined;
      const n = row && typeof row.name === 'string' && row.name.trim() ? row.name : null;
      return n ?? 'A Pin that places nothing';
    }
    const info = this.host.infoOf(element);
    return info.name ?? 'An element this reader cannot see';
  }

  itemWords(id: string): string {
    const it = this.scene?.byId.get(id);
    if (!it) return '';
    if (it.kind === 'pin') return this.nameOf(it.element, it.pin);
    if (it.kind === 'zone') return this.nameOf(it.element);
    if (it.kind === 'line') {
      const fields = [...new Set(it.edges.map((e) => fieldLabel(e.field).toLowerCase()))].join(', ');
      return `${this.nameOf(it.a)}, ${this.nameOf(it.b)}: ${fields}`;
    }
    if (it.kind === 'label') return it.text;
    return '';
  }

  // ---- the card

  clearSelection(): void {
    this.selection.clear();
    this.many = [];
    this.peek = false;
    this.holdClear = false;
    this.renderCard();
    this.invalidate();
  }

  select(ids: string[], centre = false): void {
    this.selection = new Set(ids);
    this.many = [];
    this.peek = false;
    this.clearPending = true;
    this.holdClear = true;
    if (centre && this.scene && this.camera) {
      const it = this.scene.byId.get(ids[0]);
      const at = it?.kind === 'pin' ? [it.x, it.y] : it?.kind === 'zone' ? [(it.bbox[0] + it.bbox[2]) / 2, (it.bbox[1] + it.bbox[3]) / 2] : null;
      if (at) {
        this.camera = { ...this.camera, cx: at[0], cy: at[1] };
        this.settled = true;
        this.scheduleRest(0);
      }
    }
    this.renderCard();
    this.invalidate();
  }

  private selectElement(el: string, centre = false): void {
    const ids = this.scene?.byElement.get(el) ?? [];
    if (ids.length) this.select(ids, centre);
  }

  private showPanel(): void {
    const open = this.selection.size > 0 || this.listOpen;
    this.els.panel.hidden = !open;
    this.root.classList.toggle('panel-open', open);
    if (this.clearPending) {
      this.clearPending = false;
      this.keepClear();
    }
  }

  /** Set when a press or the element view selects: the selected Pin is then kept clear of the card. */
  private clearPending = false;

  /**
   * The page moves the camera (never written to the address) so the selected Pin stands in the
   * part of the map the bar, the status lines and the card or sheet leave free.
   */
  private keepClear(): void {
    const s = this.scene;
    if (!s || !this.camera) return;
    const pin = [...this.selection].map((id) => s.byId.get(id)).find((it): it is PinItem => it?.kind === 'pin');
    if (!pin) return;
    const root = this.root.getBoundingClientRect();
    const top = this.els.head.getBoundingClientRect().bottom - root.top;
    let right = this.view.w;
    let bottom = this.view.h;
    if (!this.els.panel.hidden) {
      const p = this.els.panel.getBoundingClientRect();
      if (p.top - root.top > this.view.h * 0.3) bottom = p.top - root.top;
      else right = p.left - root.left;
    }
    if (bottom - top < 60 || right < 60) return;
    const [sx, sy] = toScreen(this.camera, this.view, pin.x, pin.y);
    const m = 24;
    if (sx >= m && sx <= right - m && sy >= top + m && sy <= bottom - m) return;
    const tx = right / 2;
    const ty = (top + bottom) / 2;
    this.camera = { ...this.camera, cx: this.camera.cx + (sx - tx) / this.camera.s, cy: this.camera.cy - (sy - ty) / this.camera.s };
    this.settled = true;
    this.scheduleRest(0);
    this.invalidate();
  }

  private renderCard(): void {
    for (const d of this.waymarks) d();
    this.waymarks = [];
    const card = this.els.card;
    clear(card);
    const s = this.scene;
    const peeking = this.peek && !!s && this.selection.size > 0;
    card.classList.toggle('peek', peeking);
    this.root.classList.toggle('peeking', peeking);
    if (!s || !this.selection.size) {
      card.hidden = true;
      this.showPanel();
      return;
    }
    card.hidden = false;
    if (this.peek && this.focus) {
      const info = this.host.infoOf(this.focus);
      const first = firstItem(s, this.selection);
      const type = info.type ?? (first?.kind === 'pin' ? first.elementType : first?.kind === 'zone' ? 'zone' : null);
      const details = button('Details', () => {
        this.peek = false;
        this.clearPending = true;
        this.renderCard();
      }, { class: 'details', 'aria-expanded': 'false' });
      card.append(h('div', { class: 'peek-bar' },
        h('h2', { class: 'peek-name' }, info.name ?? 'An element this reader cannot see', h('span', { class: 'type' }, ` · ${typeName(type)}`)),
        details,
        button('Close', () => this.clearSelection(), { class: 'close' })));
      this.showPanel();
      return;
    }
    card.append(h('div', { class: 'card-bar' }, button('Close', () => this.clearSelection(), { class: 'close' })));
    if (this.many.length > 1) {
      card.append(h('p', { class: 'many' }, `${plural(this.many.length, 'Pin')} under that press:`));
      const ul = h('ul', { class: 'rows' });
      for (const id of this.many) ul.append(h('li', {}, button(this.itemWords(id), () => this.select([id]))));
      card.append(ul);
      this.showPanel();
      return;
    }
    const items = [...this.selection].map((id) => s.byId.get(id)).filter((x): x is Item => !!x);
    const elements = [...new Set(items.filter((i) => i.kind === 'pin' || i.kind === 'zone').map((i) => i.element ?? `none:${i.id}`))];
    for (const el of elements) card.append(this.elementBlock(el, items));
    for (const line of items.filter((i): i is LineItem => i.kind === 'line')) card.append(this.lineBlock(line));
    this.showPanel();
  }

  private elementBlock(el: string, items: Item[]): HTMLElement {
    const s = this.scene!;
    if (el.startsWith('none:')) {
      const pin = items.find((i) => i.id === el.slice(5)) as PinItem | undefined;
      return h('div', { class: 'block' }, h('h2', {}, this.nameOf(null, pin?.pin)), h('p', { class: 'type' }, 'A Pin that names no element'), pin ? h('p', {}, `At ${pin.x}, ${pin.y}`) : null);
    }
    const info = this.host.infoOf(el);
    const mine = (s.byElement.get(el) ?? []).map((id) => s.byId.get(id)).filter((x): x is PinItem | ZoneItem => !!x);
    const pins = mine.filter((i): i is PinItem => i.kind === 'pin');
    const zones = mine.filter((i): i is ZoneItem => i.kind === 'zone');
    const type = info.type ?? pins[0]?.elementType ?? (zones.length ? 'zone' : null);
    const name = h('h2', { class: 'el-name' }, info.name ?? 'An element this reader cannot see');
    const block = h('div', { class: 'block' }, name, h('p', { class: 'type' }, typeName(type)));
    if (info.name && type) {
      try {
        const dispose = mountWaymark(name, {
          world: { id: this.host.world.id, name: this.host.world.name },
          element: { id: el, type: type.toLowerCase(), name: info.name },
          reader: this.host.waymarkReader,
          tool: 'mapper',
          phone: isPhone(),
        });
        this.waymarks.push(dispose);
      } catch {
        /* an id the waymark refuses: the name stands alone */
      }
    }
    for (const p of pins) block.append(h('p', { class: 'pos' }, p.z ? `At ${p.x}, ${p.y}, height ${p.z}` : `At ${p.x}, ${p.y}`));
    for (const z of zones) block.append(h('p', { class: 'pos' }, z.shape === 'line' ? `A line of ${plural(z.points.length, 'point')}` : `An area of ${plural(z.points.length, 'point')}`, z.source !== this.reading.id ? " on the ground's map" : ''));
    if (info.hidden) block.append(h('p', { class: 'note' }, 'Marked hidden: its Pin is drawn, its links are not.'));
    if (info.knownOf) block.append(h('p', { class: 'note' }, 'Known of: only its name is served to this reader, so it draws no links.'));
    // Its links on this map, from the lines that touch it.
    const lines = s.items.filter((i): i is LineItem => i.kind === 'line' && (i.a === el || i.b === el));
    if (lines.length) {
      block.append(h('h3', {}, `Linked on this map (${lines.length})`));
      const ul = h('ul', { class: 'rows' });
      const rows = lines
        .map((l) => {
          const other = l.a === el ? l.b : l.a;
          return { other, text: l.edges.map((e) => this.edgeWords(e)).join('; ') };
        })
        .sort((a, b) => byName(a.text, b.text));
      for (const r of rows) ul.append(h('li', {}, button(r.text, () => this.selectElement(r.other, true))));
      block.append(ul);
    } else if (this.scene?.complete && info.name && !this.hidden.has('line')) block.append(h('p', { class: 'note' }, 'No links to anything else on this map.'));
    else if (this.hidden.has('line') && lines.length === 0 && s.counts.lines === 0) {
      /* nothing to say */
    }
    return block;
  }

  /** One link as a sentence: "Drip Plaza names Puddleton as its parent location". */
  private edgeWords(e: { source: string; field: string; target: string }): string {
    return `${this.nameOf(e.source)} names ${this.nameOf(e.target)} as its ${fieldLabel(e.field).toLowerCase()}`;
  }

  private lineBlock(l: LineItem): HTMLElement {
    const a = this.nameOf(l.a);
    const b = this.nameOf(l.b);
    const ul = h('ul', { class: 'rows' });
    for (const e of l.edges) ul.append(h('li', {}, this.edgeWords(e)));
    return h('div', { class: 'block' },
      h('h2', {}, `${a} and ${b}`),
      h('p', { class: 'type' }, `A link line (${plural(l.edges.length, 'link')})`),
      ul,
      h('p', { class: 'ends' }, button(a, () => this.selectElement(l.a, true)), ' ', button(b, () => this.selectElement(l.b, true))));
  }

  // ---- the List view: one row per element the Map places

  private toggleList(): void {
    this.listOpen = !this.listOpen;
    this.els.listBtn.setAttribute('aria-expanded', String(this.listOpen));
    this.els.list.hidden = !this.listOpen;
    if (this.listOpen) this.renderList();
    this.showPanel();
  }

  private renderList(): void {
    const box = this.els.list;
    clear(box);
    const s = this.scene;
    if (!s) return;
    const rows = [...s.byElement.entries()].map(([el, ids]) => {
      const first = s.byId.get(ids[0]) as PinItem | ZoneItem;
      const info = this.host.infoOf(el);
      const type = info.type ?? (first.kind === 'pin' ? first.elementType : 'zone');
      const where = first.kind === 'pin' ? `${first.x}, ${first.y}` : first.shape === 'line' ? 'a line' : 'an area';
      return { el, name: info.name ?? 'An element this reader cannot see', type, where };
    });
    rows.sort((a, b) => byName(a.name, b.name));
    box.append(h('h2', {}, `On this map (${rows.length})`));
    const ul = h('ul', { class: 'rows list-rows' });
    for (const r of rows) {
      const b = button('', () => this.selectElement(r.el, true), { class: 'row' });
      b.append(h('span', { class: 'row-name' }, r.name), h('span', { class: 'row-meta' }, `${typeName(r.type)} · ${r.where}`));
      ul.append(h('li', {}, b));
    }
    box.append(ul);
  }

  private toggleLines(): void {
    this.linesOn = !this.linesOn;
    if (this.linesOn) this.hidden.delete('line');
    else this.hidden.add('line');
    const b = this.els.linesBtn!;
    b.textContent = this.linesOn ? 'Hide links' : 'Show links';
    b.setAttribute('aria-pressed', String(this.linesOn));
    for (const id of [...this.selection]) if (this.scene?.byId.get(id)?.kind === 'line' && !this.linesOn) this.selection.delete(id);
    this.renderCard();
    this.invalidate();
  }

  get linesShown(): boolean {
    return this.linesOn;
  }

  destroy(): void {
    cancelAnimationFrame(this.frameReq);
    clearTimeout(this.restTimer);
    for (const d of this.disposers) d();
    for (const d of this.waymarks) d();
    for (const p of this.pictures.values()) p.close();
    this.root.remove();
  }
}
