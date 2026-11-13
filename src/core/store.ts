// The world store: every body read, by id, as served. Bodies are kept for the tab across Maps, so
// a second Map never reads an element again. A row's version moves only when its body changed,
// which is what a derived graph is kept against.
import { linkId } from './rows';
import type { Row } from './types';

export class WorldStore {
  private rows = new Map<string, Row>();
  private type = new Map<string, string>();
  private ver = new Map<string, number>();
  private json = new Map<string, string>();
  private byMap = { pin: new Map<string, Set<string>>(), marker: new Map<string, Set<string>>() };
  private n = 0;
  /** Ids asked for by id and not served: this reader cannot see them (or they are not there). */
  readonly unseen = new Set<string>();

  /** Keep rows of one type; answers how many were new or changed. */
  put(type: string, rows: readonly Row[]): number {
    let changed = 0;
    for (const r of rows) {
      if (!r || typeof r.id !== 'string' || !r.id) continue;
      const j = JSON.stringify(r);
      if (this.json.get(r.id) === j) continue;
      const old = this.rows.get(r.id);
      if (old && (type === 'pin' || type === 'marker')) this.unindex(type, old);
      this.rows.set(r.id, r);
      this.type.set(r.id, type);
      this.json.set(r.id, j);
      this.ver.set(r.id, ++this.n);
      this.unseen.delete(r.id);
      if (type === 'pin' || type === 'marker') this.index(type, r);
      changed++;
    }
    return changed;
  }

  private index(type: 'pin' | 'marker', r: Row) {
    const m = linkId(r.map);
    if (!m) return;
    let s = this.byMap[type].get(m);
    if (!s) this.byMap[type].set(m, (s = new Set()));
    s.add(r.id);
  }

  private unindex(type: 'pin' | 'marker', r: Row) {
    const m = linkId(r.map);
    if (m) this.byMap[type].get(m)?.delete(r.id);
  }

  get(id: string): Row | undefined {
    return this.rows.get(id);
  }

  has(id: string): boolean {
    return this.rows.has(id);
  }

  typeOf(id: string): string | undefined {
    return this.type.get(id);
  }

  version(id: string): number {
    return this.ver.get(id) ?? 0;
  }

  ofType(type: string): Row[] {
    const out: Row[] = [];
    for (const [id, t] of this.type) if (t === type) out.push(this.rows.get(id)!);
    return out;
  }

  /** The Pins or Markers held whose `map` names this Map. */
  onMap(type: 'pin' | 'marker', mapId: string): Row[] {
    const s = this.byMap[type].get(mapId);
    return s ? [...s].map((id) => this.rows.get(id)!) : [];
  }

  get size(): number {
    return this.rows.size;
  }
}
