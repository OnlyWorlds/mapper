import '@onlyworlds/sdk/waymark.css';
import './style.css';
import { App } from './app';

const root = document.getElementById('app')!;
const app = new App(root);

// A read-only window for the walks: copies of what the page holds, never a way to change it, and
// nothing kept once a map is left (the scene is read through the open map).
const pinPoint = (id: string) => {
  const it = app.map?.scene?.byId.get(id);
  const c = app.map?.camera;
  const canvas = document.querySelector('canvas.surface');
  if (!it || !c || !canvas || it.kind !== 'pin') return null;
  const r = canvas.getBoundingClientRect();
  return { x: r.left + (it.x - c.cx) * c.s + r.width / 2, y: r.top + r.height / 2 - (it.y - c.cy) * c.s };
};
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
    pins() {
      const s = app.map?.scene;
      return s ? s.items.filter((i) => i.kind === 'pin').map((i) => ({ id: i.id, element: i.element })) : [];
    },
  }),
});

void app.route();
