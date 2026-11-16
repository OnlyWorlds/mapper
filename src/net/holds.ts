// The hold's storage on this device: IndexedDB, its own quota, apart from the sign-in's round trip in
// localStorage (a picture of thousands of points there would crowd it out). Two stores: the points,
// and each hold's write time (so the budget is kept without reading every picture back).
import type { HoldBackend, HoldValue } from '../core/hold';

export const HOLD_DB = 'mapper-holds';
const POINTS = 'points';
const TIMES = 'times';

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((ok, no) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error ?? new Error('storage'));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((ok, no) => {
    tx.oncomplete = () => ok();
    tx.onabort = () => no(tx.error ?? new Error('storage'));
    tx.onerror = () => no(tx.error ?? new Error('storage'));
  });
}

let opened: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (opened) return opened;
  const p = new Promise<IDBDatabase>((ok, no) => {
    if (typeof indexedDB === 'undefined') return no(new Error('no storage'));
    const req = indexedDB.open(HOLD_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(POINTS);
      req.result.createObjectStore(TIMES);
    };
    req.onsuccess = () => {
      const d = req.result;
      // Another tab's newer version: this one lets go, and opens again on its next use.
      d.onversionchange = () => {
        d.close();
        opened = null;
      };
      ok(d);
    };
    req.onerror = () => no(req.error ?? new Error('no storage'));
    req.onblocked = () => no(new Error('storage blocked'));
  });
  // A failed open is tried again on the next press.
  opened = p.catch((e) => {
    opened = null;
    throw e;
  });
  return opened;
}

export async function openHolds(): Promise<HoldBackend> {
  const d = await db();
  return {
    async get(key) {
      return done(d.transaction(POINTS, 'readonly').objectStore(POINTS).get(key));
    },
    async put(key, value: HoldValue) {
      const tx = d.transaction([POINTS, TIMES], 'readwrite');
      tx.objectStore(POINTS).put(value, key);
      tx.objectStore(TIMES).put(value.at, key);
      await finished(tx);
    },
    async list() {
      const store = d.transaction(TIMES, 'readonly').objectStore(TIMES);
      const [keys, times] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
      return keys.map((k, i) => ({ key: String(k), at: Number(times[i]) || 0 }));
    },
    async delete(key) {
      const tx = d.transaction([POINTS, TIMES], 'readwrite');
      tx.objectStore(POINTS).delete(key);
      tx.objectStore(TIMES).delete(key);
      await finished(tx);
    },
  };
}
