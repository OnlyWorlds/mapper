// The 3D view's Pins as their element types' icons: a point grows as it nears the camera and, from
// 16 px wide, turns into its type's icon on a dark disc (below that, and where a browser cannot draw
// the icons, a dot). Pure: the sizes the shader draws and the press reads.

/** Where a dot turns into its icon, in CSS pixels. */
export const ICON_AT = 16;
/** How far a point grows or shrinks with nearness: its depth against the depth the view was fitted at. */
export const GROW_MIN = 0.75;
export const GROW_MAX = 5;
/** No point is drawn wider than this, in CSS pixels. */
export const POINT_MAX_PX = 48;
/** A selected Pin and the Pins its links reach, drawn this much larger, and lit. */
export const OPEN_SCALE = 1.5;
export const NEAR_SCALE = 1.25;
/** How far a lit point's glow reaches, in radii: a selected Pin's, a reached Pin's. */
export const OPEN_GLOW = 1.55;
export const NEAR_GLOW = 1.35;
/** A dot's edge as a share of its point's radius: the shader draws it there and the press reads it there. */
export const DOT_EDGE = 0.8;

/** A Pin's light: 0 none, 1 reached by a selected Pin's links, 2 selected. */
export type Lit = 0 | 1 | 2;

export const scaleOf = (lit: Lit): number => (lit === 2 ? OPEN_SCALE : lit === 1 ? NEAR_SCALE : 1);
export const glowOf = (lit: Lit): number => (lit === 2 ? OPEN_GLOW : lit === 1 ? NEAR_GLOW : 1);

/**
 * A point's width in CSS pixels in the icon look: `base` times its lit scale, grown by nearness
 * (`ref / depth`: the camera's distance when the view was fitted over the point's distance in front of
 * the camera), held to [GROW_MIN, GROW_MAX] and to POINT_MAX_PX. The vertex shader sums the same.
 */
export function pointPx(base: number, scale: number, ref: number, depth: number): number {
  const k = ref > 0 && depth > 0 ? Math.min(GROW_MAX, Math.max(GROW_MIN, ref / depth)) : 1;
  return Math.min(POINT_MAX_PX, base * scale * k);
}

export interface Drawn {
  /** The point's width, CSS pixels, after the GPU's largest sprite. */
  px: number;
  /** Drawn as its icon (a body), or as a dot. */
  icon: boolean;
  /** The radius of what is drawn (the body, or the dot's edge), CSS pixels: what the press reads. */
  r: number;
}

/**
 * A point as the icon look draws it: its width at this depth, held so that its sprite (body and glow,
 * in device pixels) fits the GPU's largest point (`maxSprite`), as the shader holds it; an icon from
 * `from` CSS pixels when its type has one, else a dot whose edge is DOT_EDGE of its radius.
 */
export function drawn(o: { base: number; lit: Lit; ref: number; depth: number; dpr: number; maxSprite: number; from: number; hasIcon: boolean }): Drawn {
  const px = Math.min(pointPx(o.base, scaleOf(o.lit), o.ref, o.depth), o.maxSprite / (glowOf(o.lit) * o.dpr));
  const icon = o.hasIcon && px >= o.from;
  return { px, icon, r: (px / 2) * (icon ? 1 : DOT_EDGE) };
}
