// Small readers of a served body's plain keys. They read what a row says, never what a reader of
// the SDK derives (map space, layouts and links are the SDK's).
import type { Row } from './types';

/** A link as served: an id string, or an expanded object with an id. */
export function linkId(v: unknown): string | null {
  if (typeof v === 'string' && v) return v;
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') return (v as { id: string }).id;
  return null;
}

export function str(row: Row | undefined | null, key: string): string | null {
  const v = row?.[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

export function whole(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isId(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

/** A picture is drawn only from an `https:` address. */
export function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Code point order, the order the SDK's readers sort ids in. */
export function cp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Names in a reading order: case and accents folded, then code point order as the tie. */
export function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) || cp(a, b);
}
