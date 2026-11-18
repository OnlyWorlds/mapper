// What the layout's worker runs for one press (links3d.worker.ts wires it to messages): the
// reader's graph over the rows as the unplaced count copies them, then `layoutByLinks3d` with the
// hold. A hold the method refuses (its four codes) is dropped and the press lays out from nothing;
// any other error is the layout's own. Imported by the worker only, so the layout code never sits in
// the page's first script.
import { layoutByLinks3d, worldGraph } from '@onlyworlds/sdk';
import { unflatHold } from './hold';
import { shelfPieces } from './floor';
import { newCount, type Links3dAnswer } from './links3d';
import { holdRefusal } from './refusal';
import { readerFor, type ReaderRung } from './scene';
import type { Row } from './types';

export interface Links3dInput {
  /** The element rows, each a copy with its type (the unplaced count's rows, shared). */
  rows: Row[];
  /** The Map and Pin rows, each with its type: the method reads them for the plate. */
  space: Row[];
  rung: ReaderRung;
  /** The hold, flat; null to lay out from nothing. */
  held: { ids: string[]; xyz: Float64Array } | null;
}

export function layOut(input: Links3dInput, now: () => number = () => performance.now()): Links3dAnswer {
  const t0 = now();
  const graph = worldGraph({ elements: input.rows }, readerFor(input.rung, input.rows));
  let held = input.held ? unflatHold(input.held) : null;
  let refused: Links3dAnswer['refused'] = null;
  let a;
  try {
    a = held ? layoutByLinks3d(graph, input.space, { held, heldUnit: 1 }) : layoutByLinks3d(graph, input.space);
  } catch (err) {
    const code = held ? holdRefusal(err) : null;
    if (!code) throw err;
    refused = code;
    held = null;
    a = layoutByLinks3d(graph, input.space);
  }
  return {
    ids: a.ids,
    points: a.points,
    how: a.how,
    group: a.group,
    part: a.part,
    piece: shelfPieces(a.ids, a.part, graph.edges),
    fresh: newCount(a.ids, held),
    heldUsed: held !== null,
    refused,
    ms: now() - t0,
  };
}
