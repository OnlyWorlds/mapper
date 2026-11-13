// The public worlds the walks read, and the ids they press.
export const MOPPETOPIA = '0695db52-5433-7332-8000-db7fe10da375';
export const SIKELIA = '49501a68-179b-4a3c-8eaf-7f46f73d5fd2';
export const M_MAP = '069620b8-a566-7850-8000-2afcac2701e5'; // MoppetopiaMap, a picture
export const M_SPACE = '01a1206b-efde-7a5c-8956-d0b871776154'; // Moppetopia Space Map, a picture
export const M_LAYOUT = '01a1ccc7-9797-7f0a-adb2-568adf5dcd60'; // Moppetopia: layout, a layout with a depth
export const S_BIG = '3be1f73c-f903-4e76-bb10-08c51439ca68'; // Sikelia, a picture of 8000 by 5700
export const S_LAYOUT = '01a1cce7-b11c-7cbe-816d-50e3e66308c2'; // Sikelia: layout
// Elements with Pins on more than one Map, read from the worlds by their Pin lists.
export const M_ELEMENT = '0695db83-8ce7-7510-8000-5f44d31b8f79'; // Puddleton: MoppetopiaMap and the layout
export const S_ELEMENT = 'd384447b-530c-4bc5-890d-1507404b069a'; // Heloros: four Maps
/** A camera the walk opens by address. */
export const AT = '1200,800,600';

/** The key a request is held under: its path and its query, sorted. */
export function keyOf(url) {
  const u = new URL(url);
  const q = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${u.pathname.replace(/\/+$/, '/')}?${new URLSearchParams(q)}`;
}
