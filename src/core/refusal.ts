// The method's four refusals of a hold, read from the error's `code`. Imported by the layout's
// worker only: the codes are the layout code's own words, and the page's first script never holds
// them (walk/chunks.mjs reads the built files for `held-box`).
import type { HoldRefusal } from './links3d';

const REFUSALS: ReadonlySet<string> = new Set(['held-not-object', 'held-not-point', 'held-box', 'held-unit']);

/** The code of a hold refusal, or null for any other error (a layout that throws). */
export function holdRefusal(err: unknown): HoldRefusal | null {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' && REFUSALS.has(code) ? (code as HoldRefusal) : null;
}
