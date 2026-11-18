// The layout's worker: a module file of its own (the CSP's `script-src 'self'` refuses a `blob:`
// worker). One message in, one answer out, the points transferred; Cancel ends it from the page.
import { layOut, type Links3dInput } from './layout3d';

type Out = { ok: true; answer: ReturnType<typeof layOut> } | { ok: false; message: string };
const scope = self as unknown as { onmessage: ((e: MessageEvent<Links3dInput>) => void) | null; postMessage(m: Out, transfer?: Transferable[]): void };

scope.onmessage = (e) => {
  try {
    const answer = layOut(e.data);
    scope.postMessage({ ok: true, answer }, [answer.points.buffer, answer.piece.buffer]);
  } catch (err) {
    scope.postMessage({ ok: false, message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};
