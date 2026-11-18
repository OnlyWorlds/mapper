// The focus a selected Pin makes in the 3D view: its own link lines and the Pins they reach. The
// view draws only those lines and dims every other point, and the labels dim with their points.
// Pure, and kept per scene and selection (a camera move asks again and gets the same answer).
import type { Scene } from './scene';
import type { LineItem } from './types';

export interface Focus {
  /** The segments of the focus's lines: ax, ay, az, bx, by, bz each. */
  segs: number[];
  /** The Pin items in the focus: the selected Pins and every Pin one of their lines reaches. */
  near: ReadonlySet<string>;
}

const memo = new WeakMap<Scene, { key: string; focus: Focus }>();

/** The focus of the selected Pins, or null when no Pin is selected (a line, a zone, nothing). */
export function focusOf(scene: Scene, selection: Iterable<string>): Focus | null {
  const pins = [...selection].filter((id) => scene.byId.get(id)?.kind === 'pin');
  if (!pins.length) return null;
  const key = pins.sort().join(' ');
  const kept = memo.get(scene);
  if (kept && kept.key === key) return kept.focus;
  const sel = new Set(pins);
  const segs: number[] = [];
  const near = new Set<string>(pins);
  for (const it of scene.items) {
    if (it.kind !== 'line') continue;
    const l = it as LineItem;
    if (!sel.has(l.aPin) && !sel.has(l.bPin)) continue;
    segs.push(l.ax, l.ay, l.az, l.bx, l.by, l.bz);
    near.add(l.aPin);
    near.add(l.bPin);
  }
  const focus = { segs, near };
  memo.set(scene, { key, focus });
  return focus;
}
