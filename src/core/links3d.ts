// The world laid out by its links in 3D, here and unsaved (`by-links-3d`, the SDK's
// `layoutByLinks3d`). Pure: the answer in, a made-up Map and its Pins out, shaped as a save would
// write them, so the mapper's own builder draws them; the words for each state; the count of what is
// new. The reads, the worker and the device's hold are the page's.
import { roundHalfEven } from '@onlyworlds/sdk';
import { COUNT_CEILING } from './unplaced';
import { plural } from './words';
import type { Row } from './types';

/** The method's word, written on the made-up Map as a save writes it. */
export const LAYOUT_METHOD = 'by-links-3d';

/**
 * The made-up Map's id and the start of its Pins' ids: not an id, so it can never be read or named
 * as one (it never reaches the address or a request).
 */
export const MADE_UP_MAP = 'by-links-3d';

/** Pins have their own read, with this ceiling: past it the layout runs with no plate. */
export const PIN_CEILING = 10_000;

/** What the worker answers for one press. */
export interface Links3dAnswer {
  ids: string[];
  /** x, y, z of `ids[i]` at `3 * i`, as the method answered them (not rounded, not moved). */
  points: Float64Array;
  how: string[];
  group: (string | null)[];
  /** The elements of this answer whose id is not in the hold handed in (R1.1). */
  fresh: number;
  /** The hold was used (handed in and not refused). */
  heldUsed: boolean;
  /** The method refused the hold (its code), and the press laid out from nothing. */
  refused: HoldRefusal | null;
  /** Milliseconds in the worker: the graph and the layout. */
  ms: number;
}

/** The method's four refusals of a hold (the codes are read in the worker only: refusal.ts). */
export type HoldRefusal = 'held-not-object' | 'held-not-point' | 'held-box' | 'held-unit';

/**
 * Which picture a press drew: kept only when the hold kept something (a hold that shares no id with
 * the answer is a fresh picture); lost when the hold could not be read or the method refused it.
 */
export function pictureFrom(answer: Pick<Links3dAnswer, 'heldUsed' | 'fresh' | 'ids' | 'refused'>, hold: 'held' | 'none' | 'lost' | 'no-store'): 'nothing' | 'kept' | 'lost' {
  if (answer.heldUsed && answer.fresh < answer.ids.length) return 'kept';
  return hold === 'lost' || answer.refused ? 'lost' : 'nothing';
}

/** Each point rounded with the SDK's own rounding, in the answer's frame (what the hold keeps). */
export function roundPoints(points: ArrayLike<number>): Float64Array {
  const out = new Float64Array(points.length);
  for (let i = 0; i < points.length; i++) out[i] = roundHalfEven(points[i]) + 0; // + 0: never a -0
  return out;
}

/**
 * The count of what is new: the answer's ids not in the hold handed in. Never the method's `held`
 * false, which a pinned element always is.
 */
export function newCount(ids: readonly string[], held: { has(id: string): boolean } | null): number {
  if (!held) return ids.length;
  let n = 0;
  for (const id of ids) if (!held.has(id)) n++;
  return n;
}

/**
 * The answer as a save would write it: one Pin per node (its element id kept), at the rounded point
 * less the per-axis minimum, so the picture starts at 0, 0, 0; the Map's width, height and depth the
 * extent on each axis, at least 1 (a one- or two-element world is still a layout with a depth).
 * `typeOf` gives each element's type for its Pin.
 */
export function madeUp(ids: readonly string[], rounded: ArrayLike<number>, typeOf: (id: string) => string | null): { map: Row; pins: Row[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < ids.length; i++) {
    for (let k = 0; k < 3; k++) {
      const v = rounded[3 * i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const extent = (k: number) => (ids.length ? Math.max(1, max[k] - min[k]) : 1);
  const map: Row = {
    id: MADE_UP_MAP,
    type: 'map',
    name: HEAD,
    width: extent(0),
    height: extent(1),
    depth: extent(2),
    x_layout: { method: LAYOUT_METHOD },
  };
  const pins: Row[] = ids.map((id, i) => ({
    id: `${MADE_UP_MAP}:${id}`,
    type: 'pin',
    map: MADE_UP_MAP,
    element_id: id,
    element_type: typeOf(id),
    x: rounded[3 * i] - min[0] + 0,
    y: rounded[3 * i + 1] - min[1] + 0,
    z: rounded[3 * i + 2] - min[2] + 0,
  }));
  return { map, pins };
}

// ---- the words

/** The page's head, and the made-up Map's name. */
export const HEAD = 'By links, in 3D (not saved)';
/** The bar's kind word on this view. */
export const KIND_WORDS = 'a layout · 3D · not saved';
export const OFFER_HEAD = 'The world in 3D';
export const OFFER_BUTTON = 'Lay out by links, in 3D';
export const OFFER_WORDS = 'Draws the elements you can see, joined by their links, in 3D. It is drawn here and not saved: the mapper writes nothing to the world.';
export const UNSAVED_LINE = 'Not saved: the mapper writes nothing. Atlas saves a layout.';
export const CHANGE_LINE = 'The method is not final; this device keeps the picture still meanwhile.';
export const FRESH_LINE = 'Laid out from nothing.';
export const AGAIN_BUTTON = 'Lay out again from nothing';
export const LOST_LINE = 'The last picture could not be kept, so this one was laid out from nothing.';
export const NO_STORE_LINE = 'This browser keeps no storage for the mapper here, so the picture is not kept: the next press lays it out from nothing.';
export const NOT_KEPT_LINE = 'This picture could not be kept on this device, so the next press lays it out from nothing.';
export const NO_PLATE_LINE = `The world’s map was too large to use (more than ${PIN_CEILING.toLocaleString('en-US')} Pins), so this picture has no plate: its pinned elements are laid out with the rest.`;
export const EMPTY_LINE = 'Nothing to lay out for you here.';
export const FAILED_LINE = 'This world could not be laid out.';
export const STOPPED_LINE = 'Stopped. Nothing was drawn.';
export const CANCEL_BUTTON = 'Cancel';
export const START_BUTTON = 'Lay out';

/** The line under the picture: which picture it drew. */
export function keptWords(fresh: number): string {
  return `Kept the picture you last saw here; ${fresh.toLocaleString('en-US')} placed new.`;
}

/** Above the ceiling: said where the press would be, and on the page itself for a shared link. */
export function ceilingWords3d(): string {
  return `This world holds more than ${COUNT_CEILING.toLocaleString('en-US')} elements you can see, too many for the mapper to lay out here.`;
}

/** When this tab read the world: a press uses that reading, a reload reads again. */
export function readAtWords(at: Date): string {
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `Read at ${hh}:${mm}; a reload reads again.`;
}

/** The running line while the world is read. */
export function readingWords(n: number, seconds: number): string {
  return `Reading what you can see of the world: ${plural(n, 'element')} so far, ${seconds} s.`;
}

/** The running line while the worker lays it out: the rows read (the graph may draw fewer), and time, with no promise of speed. */
export function layingWords(n: number, seconds: number): string {
  return `Laying out the ${plural(n, 'element')} read, ${seconds} s so far.`;
}
