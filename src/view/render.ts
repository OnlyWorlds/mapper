// The flat surface: a 2D canvas that draws the scene list and then the view pass, nothing else.
// Zones are one cached Path2D each in the Map's frame, drawn under one transform; link lines are
// one Path2D; Pins are batched by style in screen space so they keep their size at every zoom.
// `devicePixelRatio` is honoured, and the canvas draws again on `contextrestored`.
import { GROUP_COLORS, type ElementGroup } from '@onlyworlds/sdk';
import { toScreen, type Camera, type View } from '../core/camera';
import type { Placed } from '../core/labels';
import type { Scene } from '../core/scene';
import type { Item, ItemKind, PinItem, ZoneItem } from '../core/types';
import { levelFor, type Picture } from './picture';

export interface Theme {
  mode: 'light' | 'dark';
  bg: string;
  frame: string;
  zone: string;
  zoneFill: string;
  road: string;
  line: string;
  pinRing: string;
  pinNone: string;
  label: string;
  halo: string;
  accent: string;
  hover: string;
  font: string;
}

export function readTheme(el: Element): Theme {
  const cs = getComputedStyle(el);
  const v = (k: string, d: string) => cs.getPropertyValue(k).trim() || d;
  const dark = v('--scheme', 'light') === 'dark';
  return {
    mode: dark ? 'dark' : 'light',
    bg: v('--map-bg', '#eceae4'),
    frame: v('--map-frame', '#f7f6f2'),
    zone: v('--zone', '#5b6b7a'),
    zoneFill: v('--zone-fill', 'rgba(91,107,122,0.08)'),
    road: v('--road', '#7a6a55'),
    line: v('--link', 'rgba(60,70,90,0.45)'),
    pinRing: v('--pin-ring', '#ffffff'),
    pinNone: v('--pin-none', '#8a8a8a'),
    label: v('--label', '#1d1f24'),
    halo: v('--halo', 'rgba(255,255,255,0.85)'),
    accent: v('--accent', '#c2410c'),
    hover: v('--hover', '#0e7490'),
    font: v('--font', 'system-ui, sans-serif'),
  };
}

export interface ViewPass {
  camera: Camera;
  view: View;
  dpr: number;
  selection: ReadonlySet<string>;
  hover: string | null;
  /** The element view's mark: these items are ringed. */
  marked: ReadonlySet<string>;
  hidden: ReadonlySet<ItemKind>;
  labels: readonly Placed[];
  pictures: ReadonlyMap<string, Picture>;
  theme: Theme;
}

const PIN_R = 4.5;

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private scene: Scene | null = null;
  private zonePaths = new Map<string, Path2D>();
  private polys: ZoneItem[] = [];
  private roads: ZoneItem[] = [];
  private linesPath: Path2D | null = null;
  private pinsByStyle = new Map<string, PinItem[]>();
  /** Draw calls made, and the last one's duration. */
  draws = 0;
  lastDrawMs = 0;
  /** Whether the last draw put a picture's copy on the canvas. */
  drewPicture = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This browser cannot draw on a canvas.');
    this.ctx = ctx;
  }

  /** A new list: the cached paths are made again from it (never when the camera moves). */
  setScene(scene: Scene): void {
    this.scene = scene;
    const keep = new Map<string, Path2D>();
    this.polys = [];
    this.roads = [];
    const lines = new Path2D();
    let anyLine = false;
    this.pinsByStyle.clear();
    for (const it of scene.items) {
      if (it.kind === 'zone') {
        let p = this.zonePaths.get(it.id + '#' + it.points.length);
        if (!p) {
          p = new Path2D();
          it.points.forEach(([x, y], i) => (i ? p!.lineTo(x, y) : p!.moveTo(x, y)));
          if (it.shape === 'polygon') p.closePath();
        }
        keep.set(it.id + '#' + it.points.length, p);
        (it.shape === 'polygon' ? this.polys : this.roads).push(it);
      } else if (it.kind === 'line') {
        lines.moveTo(it.ax, it.ay);
        lines.lineTo(it.bx, it.by);
        anyLine = true;
      } else if (it.kind === 'pin') {
        const l = this.pinsByStyle.get(it.style);
        if (l) l.push(it);
        else this.pinsByStyle.set(it.style, [it]);
      }
    }
    this.zonePaths = keep;
    this.linesPath = anyLine ? lines : null;
  }

  resize(view: View, dpr: number): void {
    const w = Math.max(1, Math.round(view.w * dpr));
    const h = Math.max(1, Math.round(view.h * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  private pathOf(z: ZoneItem): Path2D | undefined {
    return this.zonePaths.get(z.id + '#' + z.points.length);
  }

  draw(v: ViewPass): void {
    const t0 = performance.now();
    const { ctx } = this;
    const { camera: c, view, dpr, theme } = v;
    this.draws++;
    this.drewPicture = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const scene = this.scene;
    if (!scene) {
      this.lastDrawMs = performance.now() - t0;
      return;
    }
    const screen = (x: number, y: number) => toScreen(c, view, x, y);
    // The frame, then the pictures, in screen space.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [fx0, fy0] = screen(0, scene.frame.h);
    ctx.fillStyle = theme.frame;
    ctx.fillRect(fx0, fy0, scene.frame.w * c.s, scene.frame.h * c.s);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const it of scene.items) {
      if (it.kind !== 'picture' || v.hidden.has('picture')) continue;
      const pic = v.pictures.get(it.url);
      if (!pic) continue;
      const [x, y, w, h] = it.rect;
      const lvl = levelFor(pic.levels, w * c.s * dpr);
      if (!lvl) continue;
      const [sx, sy] = screen(x, y + h);
      ctx.drawImage(lvl.bitmap, sx, sy, w * c.s, h * c.s);
      this.drewPicture = true;
    }
    // The vectors, in the Map's frame under one transform (y up).
    const s = c.s * dpr;
    ctx.setTransform(s, 0, 0, -s, dpr * (view.w / 2 - c.cx * c.s), dpr * (view.h / 2 + c.cy * c.s));
    const px = 1 / c.s;
    if (!v.hidden.has('zone')) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.fillStyle = theme.zoneFill;
      ctx.strokeStyle = theme.zone;
      ctx.lineWidth = 1.25 * px;
      for (const z of this.polys) {
        const p = this.pathOf(z);
        if (!p) continue;
        ctx.fill(p);
        ctx.stroke(p);
      }
      ctx.strokeStyle = theme.road;
      ctx.lineWidth = 1.5 * px;
      for (const z of this.roads) {
        const p = this.pathOf(z);
        if (p) ctx.stroke(p);
      }
    }
    if (this.linesPath && !v.hidden.has('line')) {
      if (this.drewPicture) {
        // Over a picture, a line needs a halo to read on dark and light ground alike.
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 2.6 * px;
        ctx.stroke(this.linesPath);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
        ctx.lineWidth = 1.1 * px;
      } else {
        ctx.strokeStyle = theme.line;
        ctx.lineWidth = 1 * px;
      }
      ctx.stroke(this.linesPath);
    }
    // The view pass's strokes over the vectors: hover and selection on zones and lines.
    const emph = (id: string, color: string, width: number) => {
      const it = scene.byId.get(id);
      if (!it || v.hidden.has(it.kind)) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * px;
      if (it.kind === 'zone') {
        const p = this.pathOf(it);
        if (p) ctx.stroke(p);
      } else if (it.kind === 'line') {
        ctx.beginPath();
        ctx.moveTo(it.ax, it.ay);
        ctx.lineTo(it.bx, it.by);
        ctx.stroke();
      }
    };
    for (const id of v.selection) emph(id, theme.accent, 3);
    if (v.hover && !v.selection.has(v.hover)) emph(v.hover, theme.hover, 2.5);

    // Pins, batched by style, in screen space.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!v.hidden.has('pin')) {
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = theme.pinRing;
      for (const [style, pins] of this.pinsByStyle) {
        const g = style.slice(4) as ElementGroup | 'none';
        ctx.fillStyle = g === 'none' ? theme.pinNone : GROUP_COLORS[g]?.[theme.mode] ?? theme.pinNone;
        ctx.beginPath();
        for (const p of pins) {
          const [sx, sy] = screen(p.x, p.y);
          if (sx < -10 || sy < -10 || sx > view.w + 10 || sy > view.h + 10) continue;
          ctx.moveTo(sx + PIN_R, sy);
          ctx.arc(sx, sy, PIN_R, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
      }
    }
    const ring = (it: Item | undefined, color: string, r: number, width: number) => {
      if (!it || it.kind !== 'pin' || v.hidden.has('pin')) return;
      const [sx, sy] = screen(it.x, it.y);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    for (const id of v.marked) ring(scene.byId.get(id), theme.accent, 11, 2);
    for (const id of v.selection) ring(scene.byId.get(id), theme.accent, 7.5, 2.5);
    if (v.hover && !v.selection.has(v.hover)) ring(scene.byId.get(v.hover), theme.hover, 7.5, 2.5);

    // Labels: the ones the view pass placed when the camera last rested, beside their anchors.
    if (v.labels.length && !v.hidden.has('label')) {
      ctx.font = `12px ${theme.font}`;
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (const l of v.labels) {
        const a = scene.byId.get(l.anchor) as PinItem | undefined;
        if (!a) continue;
        const [sx, sy] = screen(a.x, a.y);
        const tx = l.side === 'right' ? sx + 8 : sx - 8;
        ctx.textAlign = l.side === 'right' ? 'left' : 'right';
        ctx.strokeStyle = theme.halo;
        ctx.lineWidth = 3;
        ctx.strokeText(l.text, tx, sy);
        ctx.fillStyle = v.hover === l.anchor || v.selection.has(l.anchor) ? theme.accent : theme.label;
        ctx.fillText(l.text, tx, sy);
      }
    }
    this.lastDrawMs = performance.now() - t0;
  }

  /** The label candidates on screen, in the list's order. */
  measure(text: string, theme: Theme): number {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.font = `12px ${theme.font}`;
    return this.ctx.measureText(text).width;
  }
}


