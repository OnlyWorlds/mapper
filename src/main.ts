import '@onlyworlds/sdk/waymark.css';
import './style.css';
import { isSignInCallback, startSignInCallback, sweepStaleRecord } from './auth/signin';
import { App } from './app';

// The callback's code leaves the address before any other request to OnlyWorlds, and the first route
// waits for its outcome; on any other load, a round trip nobody came back from is dropped.
const callback = isSignInCallback() ? startSignInCallback() : null;
if (!callback) sweepStaleRecord();

const root = document.getElementById('app')!;
const app = new App(root);

// The page is done with the token when it leaves; a page back from the back/forward cache held a
// token it revoked, so it signs out.
window.addEventListener('pagehide', () => app.pageHidden());
window.addEventListener('pageshow', (e) => app.pageShown(e.persisted));

// A read-only window for the walks: copies of what the page holds, never a way to change it, and
// nothing kept once a map is left (the scene is read through the open map).
const pinPoint = (id: string) => app.map?.screenPoint(id) ?? null;
Object.defineProperty(window, '__mapper', {
  value: Object.freeze({
    get scene() {
      const s = app.map?.scene;
      return s ? { counts: { ...s.counts }, complete: s.complete, frame: { ...s.frame }, out: s.out ? structuredClone(s.out) : null, items: s.items.length, ms: s.ms, kinds: s.items.reduce<Record<string, number>>((a, i) => ((a[i.kind] = (a[i.kind] ?? 0) + 1), a), {}) } : null;
    },
    /** How many scenes the open map was handed: a camera move must not add one. */
    get derives() {
      return app.map?.sceneCount ?? 0;
    },
    get selection() {
      return app.map ? [...app.map.selection] : [];
    },
    get marked() {
      return app.map ? [...app.map.marked] : [];
    },
    get peek() {
      return app.map?.peek ?? false;
    },
    get camera() {
      const c = app.map?.camera;
      return c ? { ...c } : null;
    },
    get linesShown() {
      return app.map?.linesShown ?? null;
    },
    get restored() {
      return app.map?.restored ?? 0;
    },
    get labels() {
      return app.map?.labels.map((l) => ({ text: l.text, rect: [...l.rect] })) ?? [];
    },
    get writes() {
      return app.writer.log.map((w) => ({ ...w }));
    },
    /** A point on screen for an item, for a walk to hover or press. */
    screenOf(id: string) {
      return pinPoint(id);
    },
    /** A point in the open Map's frame on screen, in whichever view is drawn. */
    pointOf(x: number, y: number, z: number) {
      return app.map?.pointOnScreen(x, y, z) ?? null;
    },
    pins() {
      const s = app.map?.scene;
      return s ? s.items.flatMap((i) => (i.kind === 'pin' ? [{ id: i.id, element: i.element, style: i.style, x: i.x, y: i.y, z: i.z }] : [])) : [];
    },
    /** The open Map's picture items: where each sits in the Map's frame. */
    pictures() {
      const s = app.map?.scene;
      return s ? s.items.flatMap((i) => (i.kind === 'picture' ? [{ id: i.id, rect: [...i.rect] }] : [])) : [];
    },
    /** The 3D view: off, loading, on or failed, and how many surfaces (WebGL contexts) the open map made. */
    get view3d() {
      return app.map ? { state: app.map.state3d, made: app.map.surfacesMade, canvases: document.querySelectorAll('canvas.surface-3d').length, ...app.map.walk3d() } : null;
    },
    /** Signed in or not: a yes or no, never the token. */
    get signedIn() {
      return app.signedIn;
    },
  }),
});

void app.start(callback);
