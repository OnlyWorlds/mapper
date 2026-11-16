// The page's side of the layout's worker: one worker a press, ended at once by the press's signal
// (Cancel, Back, another world, sign-out), so a late answer is never drawn.
import type { Links3dInput } from '../core/layout3d';
import type { Links3dAnswer } from '../core/links3d';
import { ReadFailure } from '../net/api';

/** The layout threw (not a hold refusal): its message, for the console. */
export class LayoutFailure extends Error {}

export function layOutOffPage(input: Links3dInput, signal: AbortSignal): Promise<Links3dAnswer> {
  return new Promise((ok, no) => {
    if (signal.aborted) return no(new ReadFailure('stopped', null, 'stopped'));
    let worker: Worker;
    try {
      worker = new Worker(new URL('../core/links3d.worker.ts', import.meta.url), { type: 'module', name: 'by-links-3d' });
    } catch (err) {
      return no(new LayoutFailure(err instanceof Error ? err.message : String(err)));
    }
    const end = () => {
      worker.terminate();
      signal.removeEventListener('abort', stop);
    };
    const stop = () => {
      end();
      no(new ReadFailure('stopped', null, 'stopped'));
    };
    signal.addEventListener('abort', stop, { once: true });
    worker.onmessage = (e: MessageEvent<{ ok: true; answer: Links3dAnswer } | { ok: false; message: string }>) => {
      end();
      if (e.data.ok) ok(e.data.answer);
      else no(new LayoutFailure(e.data.message));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      end();
      no(new LayoutFailure(e.message || 'the layout worker failed'));
    };
    const transfer = input.held ? [input.held.xyz.buffer] : [];
    worker.postMessage(input, transfer);
  });
}
