// A Map's picture, drawn from downscaled copies and never from a canvas at its full size. The
// bytes are read with a time limit of their own; the source is decoded once, by `createImageBitmap`
// (off the main thread in the engines that do it so), into the largest copy, and the smaller copies
// are made from that copy, never from the source again: one full decode, one peak of memory.
export const PICTURE_LIMIT_MS = 45_000;
/** The largest copy's longer side: a 3D ground texture's default cap, and the flat view's too. */
export const MAX_SIDE = 4096;

export interface PictureLevel {
  w: number;
  h: number;
  bitmap: ImageBitmap;
}

export type PictureState = 'reading' | 'decoding' | 'ready' | 'failed';

export interface PictureTimes {
  /** From the start to the bytes held. */
  readMs: number | null;
  /** From the bytes held to the first copy ready. */
  firstCopyMs: number | null;
  /** From the bytes held to every copy ready. */
  allCopiesMs: number | null;
}

/** The longer sides of the copies a picture of this size gets, smallest first. */
export function copySides(w: number, h: number, max = MAX_SIDE): number[] {
  const long = Math.max(w, h);
  const out: number[] = [];
  for (const s of [1024, 2048, 4096]) if (s < long && s <= max) out.push(s);
  if (long <= max) out.push(long);
  return out.length ? out : [Math.min(long, max)];
}

/** The copy to draw for a picture shown `needPx` device pixels wide: the smallest that holds it. */
export function levelFor<T extends { w: number }>(levels: readonly T[], needPx: number): T | null {
  if (!levels.length) return null;
  for (const l of levels) if (l.w >= needPx * 0.9) return l;
  return levels[levels.length - 1];
}

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(what)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

async function sizeOf(src: string): Promise<{ w: number; h: number; img: HTMLImageElement }> {
  const img = new Image();
  img.decoding = 'async';
  const loaded = new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('The picture could not be read'));
  });
  img.src = src;
  await loaded;
  return { w: img.naturalWidth, h: img.naturalHeight, img };
}

async function copyOf(source: Blob | HTMLImageElement | ImageBitmap, w: number, h: number): Promise<ImageBitmap> {
  let b: ImageBitmap;
  try {
    b = await createImageBitmap(source, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  } catch {
    b = await createImageBitmap(source);
  }
  if (b.width === w && b.height === h) return b;
  // An engine that ignored the resize: draw it down once onto a canvas the copy's size.
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(b, 0, 0, w, h);
  b.close();
  return c.transferToImageBitmap();
}

export class Picture {
  state: PictureState = 'reading';
  natural: { w: number; h: number } | null = null;
  levels: PictureLevel[] = [];
  times: PictureTimes = { readMs: null, firstCopyMs: null, allCopiesMs: null };
  /** True when the host sent no CORS header and the picture was read as a plain image. */
  plain = false;
  private closed = false;

  constructor(
    readonly url: string,
    private onChange: () => void,
    private limitMs = PICTURE_LIMIT_MS,
  ) {}

  async load(): Promise<void> {
    const t0 = performance.now();
    this.state = 'reading';
    this.onChange();
    try {
      let source: Blob | HTMLImageElement;
      let objectUrl: string | null = null;
      try {
        const res = await fetch(this.url, { mode: 'cors', signal: AbortSignal.timeout(this.limitMs) });
        if (!res.ok) throw new Error(String(res.status));
        source = await timeout(res.blob(), this.limitMs, 'time limit');
        objectUrl = URL.createObjectURL(source);
      } catch (e) {
        if (e instanceof Error && /^\d+$/.test(e.message)) throw e;
        if (e instanceof DOMException && e.name === 'TimeoutError') throw e;
        // No CORS on the host: read it as a plain image (it still draws; the pointer never reads pixels).
        this.plain = true;
        source = (await timeout(sizeOf(this.url), this.limitMs, 'time limit')).img;
      }
      this.times.readMs = performance.now() - t0;
      if (this.closed) return;
      this.state = 'decoding';
      this.onChange();
      const t1 = performance.now();
      const size = objectUrl ? await sizeOf(objectUrl) : { w: (source as HTMLImageElement).naturalWidth, h: (source as HTMLImageElement).naturalHeight };
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      this.natural = { w: size.w, h: size.h };
      // The size is known: said at once, so a Map with no written size takes its frame now, before
      // any copy is built.
      this.onChange();
      if (this.closed) return;
      const sizes = copySides(size.w, size.h)
        .map((side) => {
          const k = side / Math.max(size.w, size.h);
          return { w: Math.max(1, Math.round(size.w * k)), h: Math.max(1, Math.round(size.h * k)) };
        })
        .reverse();
      // The largest from the source (the one decode), then each smaller one from the largest.
      let largest: ImageBitmap | null = null;
      for (const { w, h } of sizes) {
        const bitmap = await copyOf(largest ?? source, w, h);
        if (this.closed) {
          bitmap.close();
          return;
        }
        largest ??= bitmap;
        this.levels.push({ w, h, bitmap });
        this.levels.sort((a, b) => a.w - b.w);
        if (this.times.firstCopyMs === null) {
          this.times.firstCopyMs = performance.now() - t1;
          this.state = 'ready';
        }
        this.onChange();
      }
      this.times.allCopiesMs = performance.now() - t1;
    } catch {
      if (this.closed) return;
      this.state = this.levels.length ? 'ready' : 'failed';
      this.onChange();
    }
  }

  close(): void {
    this.closed = true;
    for (const l of this.levels) l.bitmap.close();
    this.levels = [];
  }
}
