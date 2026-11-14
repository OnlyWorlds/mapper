// The shapes the scene list is made of. Every pixel the map draws comes from a Scene's items
// (the list) or from the view pass (labels placed, hover, selection, marks), never anywhere else.

/** A served body, as the API serves it: an object with a string id. */
export type Row = { id: string; [k: string]: unknown };

/** The item kinds. A Marker is no kind: it is a vertex of its Zone's item. */
export type ItemKind = 'picture' | 'zone' | 'pin' | 'line' | 'label';

interface ItemBase {
  /** Made from served ids only: `pin:<id>`, `zone:<zone>@<map>`, `line:<a>~<b>`, `picture:<map>`, `label:<anchor>`. */
  id: string;
  kind: ItemKind;
  /** The element the item stands for, or null (a picture, a line, a Pin placing nothing). */
  element: string | null;
  /** The Map whose frame the geometry was written in (the ground's for a ground item). */
  source: string;
  /** Where the source frame sits in the opened Map's frame: [0, 0] for the Map's own items. */
  offset: [number, number];
  /** A drawing key: items of one style draw in one batch. */
  style: string;
}

export interface PictureItem extends ItemBase {
  kind: 'picture';
  url: string;
  /** In the opened Map's frame: x, y (bottom-left), width, height. */
  rect: [number, number, number, number];
}

export interface ZoneItem extends ItemBase {
  kind: 'zone';
  element: string;
  shape: 'polygon' | 'line';
  /** In the opened Map's frame, the outline's order as the format has it. */
  points: [number, number][];
  bbox: [number, number, number, number];
  /** A polygon's area in Map units (0 for a line). */
  area: number;
}

export interface PinItem extends ItemBase {
  kind: 'pin';
  pin: string;
  elementType: string | null;
  x: number;
  y: number;
  z: number;
}

export interface LineEdge {
  source: string;
  field: string;
  target: string;
}

export interface LineItem extends ItemBase {
  kind: 'line';
  element: null;
  /** The two elements, a < b in code point order. */
  a: string;
  b: string;
  /** The Pin items drawn at each end. */
  aPin: string;
  bPin: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** The two Pins' heights, for the 3D view (flat never reads them). */
  az: number;
  bz: number;
  edges: LineEdge[];
}

export interface LabelItem extends ItemBase {
  kind: 'label';
  /** The item the label stands beside, and answers the pointer as. */
  anchor: string;
  text: string;
  /** The element's degree in this Map's graph: higher shows first, ties by text. */
  rank: number;
  x: number;
  y: number;
}

export type Item = PictureItem | ZoneItem | PinItem | LineItem | LabelItem;

/** What a body read gives a name for: the element's name and type as served, or nothing seen. */
export interface ElementInfo {
  id: string;
  type: string | null;
  name: string | null;
  /** Served with `hidden: true`. */
  hidden: boolean;
  /** Served as a stub (`known_of: true`). */
  knownOf: boolean;
}
