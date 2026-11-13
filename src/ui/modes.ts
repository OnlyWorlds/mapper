// The pointer goes through one mode at a time. This version has one mode, look: a drag pans, a
// press selects. The camera owns the wheel, the pinch and two fingers in every mode; a mode owns
// only the single pointer's press and drag. The editor's modes join this table later.
export interface ModeHost {
  /** Pan the camera by screen pixels (a person's drag). */
  pan(dx: number, dy: number): void;
  /** A press at a screen point: what is under it is selected. */
  press(sx: number, sy: number, touch: boolean): void;
  /** The person's camera gesture ended: the address may take the camera. */
  gestureEnded(): void;
}

export interface Mode {
  down(host: ModeHost, e: PointerEvent): void;
  move(host: ModeHost, e: PointerEvent): void;
  up(host: ModeHost, e: PointerEvent): void;
  cancel(host: ModeHost): void;
}

/** How far a pointer moves, in CSS pixels, before a press becomes a drag. */
export const SLOP = 6;

function lookMode(): Mode {
  let start: { x: number; y: number; lx: number; ly: number; dragging: boolean } | null = null;
  return {
    down(_h, e) {
      start = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, dragging: false };
    },
    move(h, e) {
      if (!start) return;
      if (!start.dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) start.dragging = true;
      if (start.dragging) {
        h.pan(e.clientX - start.lx, e.clientY - start.ly);
        start.lx = e.clientX;
        start.ly = e.clientY;
      }
    },
    up(h, e) {
      if (!start) return;
      const s = start;
      start = null;
      if (s.dragging) h.gestureEnded();
      else h.press(e.clientX, e.clientY, e.pointerType === 'touch' || e.pointerType === 'pen');
    },
    cancel() {
      start = null;
    },
  };
}

export type ModeName = 'look';

export function makeModes(): Record<ModeName, Mode> {
  return { look: lookMode() };
}
