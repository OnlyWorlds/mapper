import '@onlyworlds/sdk/waymark.css';
import './style.css';
import { App } from './app';

const root = document.getElementById('app')!;
const app = new App(root);

// A read-only window for the walks: what the page holds, never a way to change it.
Object.defineProperty(window, '__mapper', {
  value: {
    get scene() {
      const s = (window as unknown as { __mapperScene?: import('./core/scene').Scene }).__mapperScene;
      return s && app.map ? { counts: s.counts, complete: s.complete, frame: s.frame, out: s.out, items: s.items.length, ms: s.ms, kinds: s.items.reduce<Record<string, number>>((a, i) => ((a[i.kind] = (a[i.kind] ?? 0) + 1), a), {}) } : null;
    },
    get selection() {
      return app.map ? [...app.map.selection] : [];
    },
    get camera() {
      return app.map?.camera ?? null;
    },
    get linesShown() {
      return app.map?.linesShown ?? null;
    },
    get restored() {
      return app.map?.restored ?? 0;
    },
    get labels() {
      return app.map?.labels.map((l) => ({ text: l.text, rect: l.rect })) ?? [];
    },
    get writes() {
      return [...app.writer.log];
    },
    /** A point on screen for an item, for a walk to hover or press. */
    screenOf(id: string) {
      const s = (window as unknown as { __mapperScene?: import('./core/scene').Scene }).__mapperScene;
      const it = s?.byId.get(id);
      const c = app.map?.camera;
      const canvas = document.querySelector('canvas.surface');
      if (!it || !c || !canvas || it.kind !== 'pin') return null;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (it.x - c.cx) * c.s + r.width / 2, y: r.top + r.height / 2 - (it.y - c.cy) * c.s };
    },
    pins() {
      const s = (window as unknown as { __mapperScene?: import('./core/scene').Scene }).__mapperScene;
      return s ? s.items.filter((i) => i.kind === 'pin').map((i) => ({ id: i.id, element: i.element })) : [];
    },
  },
});

void app.route();
