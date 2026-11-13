// Labels where they fit: the candidates in the list's order (most linked first, ties by name),
// placed greedily in screen space, at most `max`, none over another, chosen again only when the
// camera rests.
import type { PlacedLabel } from './hit';

export interface LabelCandidate {
  anchor: string;
  text: string;
  /** The anchor's place on screen, CSS pixels. */
  sx: number;
  sy: number;
}

export interface PlaceOptions {
  w: number;
  h: number;
  max: number;
  /** The text's height in CSS pixels. */
  font: number;
  /** The gap between the point and the text. */
  gap: number;
}

export interface Placed extends PlacedLabel {
  text: string;
  /** Which side of the point the text sits. */
  side: 'right' | 'left';
}

function overlaps(a: readonly number[], b: readonly number[]): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

export function placeLabels(cands: readonly LabelCandidate[], measure: (text: string) => number, o: PlaceOptions): Placed[] {
  const out: Placed[] = [];
  const half = o.font / 2 + 2;
  for (const c of cands) {
    if (out.length >= o.max) break;
    if (c.sx < 0 || c.sy < 0 || c.sx > o.w || c.sy > o.h) continue;
    const tw = measure(c.text) + 6;
    const right: [number, number, number, number] = [c.sx + o.gap, c.sy - half, c.sx + o.gap + tw, c.sy + half];
    const left: [number, number, number, number] = [c.sx - o.gap - tw, c.sy - half, c.sx - o.gap, c.sy + half];
    for (const [rect, side] of [[right, 'right'], [left, 'left']] as const) {
      if (rect[0] < 0 || rect[2] > o.w || rect[1] < 0 || rect[3] > o.h) continue;
      if (out.some((p) => overlaps(p.rect, rect))) continue;
      out.push({ anchor: c.anchor, text: c.text, rect, side });
      break;
    }
  }
  return out;
}
