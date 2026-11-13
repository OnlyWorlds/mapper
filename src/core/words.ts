// The page's sentences that depend on what was read. Plain words, no markup: every one is set as
// a text node.
import type { OwMapSpace } from '@onlyworlds/sdk';
import type { Scene } from './scene';

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

const OUT_WORDS: Record<string, (n: number) => string> = {
  no_point: (n) => `${plural(n, 'row')} without a whole x and y`,
  no_markers: (n) => `${plural(n, 'Zone')} with no placed Marker`,
  dangling: (n) => `${plural(n, 'Marker')} whose Zone or Map was not served`,
  no_map: (n) => `${plural(n, 'Pin')} whose Map was not served`,
};

/**
 * What the map reading left aside, in one line, said only when the Map's reads are complete
 * (until then a Marker whose Zone is still being read would count as broken). Null when there is
 * nothing to say, or nothing to say yet.
 */
export function outLine(scene: Pick<Scene, 'complete' | 'out'>): string | null {
  if (!scene.complete || !scene.out) return null;
  const out = scene.out as OwMapSpace['out'];
  const parts = (Object.keys(OUT_WORDS) as (keyof typeof out)[])
    .filter((k) => (out[k] ?? 0) > 0)
    .map((k) => OUT_WORDS[k](out[k]!));
  return parts.length ? `Not drawn: ${parts.join(', ')}.` : null;
}

export type StepState = 'waiting' | 'running' | 'done' | 'failed';

export interface ReadStep {
  name: string;
  state: StepState;
  /** Requests this step has made so far. */
  calls: number;
}

/** "Reading Zones, read 3 of 4." while a step runs; null when every step is done. */
export function progressLine(steps: readonly ReadStep[]): string | null {
  const i = steps.findIndex((s) => s.state !== 'done');
  if (i < 0) return null;
  const s = steps[i];
  if (s.state === 'failed') return null;
  return `Reading ${s.name}, read ${i + 1} of ${steps.length}.`;
}

export function countsLine(c: Scene['counts']): string {
  return [plural(c.pins, 'Pin'), plural(c.zones, 'Zone'), plural(c.elements, 'element'), plural(c.lines, 'link line')].join(' · ');
}
