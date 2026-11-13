// The flat camera: a centre in the Map's frame (origin bottom-left, y up) and a scale in CSS
// pixels per Map unit. The address holds it as `at=<x>,<y>,<span>`, the span being Map units across
// the view's shorter side, so every screen shows the same area.

export interface Camera {
  cx: number;
  cy: number;
  /** CSS pixels per Map unit. */
  s: number;
}

export interface View {
  w: number;
  h: number;
}

/** What floats over the map's edges (CSS pixels): a fit keeps the frame inside the rest. */
export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSET: Inset = { top: 0, right: 0, bottom: 0, left: 0 };

export function fit(frameW: number, frameH: number, v: View, pad = 0.94, inset: Inset = NO_INSET): Camera {
  const aw = Math.max(40, v.w - inset.left - inset.right);
  const ah = Math.max(40, v.h - inset.top - inset.bottom);
  let s = Math.min(aw / frameW, ah / frameH) * pad;
  if (!(s > 0 && Number.isFinite(s))) s = 1;
  // The frame's centre lands at the centre of the free area, not of the whole view.
  const dx = (inset.left - inset.right) / 2;
  const dy = (inset.top - inset.bottom) / 2;
  return { cx: frameW / 2 - dx / s, cy: frameH / 2 + dy / s, s };
}

export function toScreen(c: Camera, v: View, x: number, y: number): [number, number] {
  return [(x - c.cx) * c.s + v.w / 2, v.h / 2 - (y - c.cy) * c.s];
}

export function toMap(c: Camera, v: View, sx: number, sy: number): [number, number] {
  return [(sx - v.w / 2) / c.s + c.cx, (v.h / 2 - sy) / c.s + c.cy];
}

/** Zoom by a factor, keeping the Map point under (sx, sy) where it is. */
export function zoomAt(c: Camera, v: View, sx: number, sy: number, factor: number, limits: [number, number]): Camera {
  const s = Math.min(limits[1], Math.max(limits[0], c.s * factor));
  const [mx, my] = toMap(c, v, sx, sy);
  return { s, cx: mx - (sx - v.w / 2) / s, cy: my - (v.h / 2 - sy) / s };
}

export function panBy(c: Camera, dx: number, dy: number): Camera {
  return { s: c.s, cx: c.cx - dx / c.s, cy: c.cy + dy / c.s };
}

/** The scale limits for a frame: from a tenth of the fit to forty times it. */
export function limitsFor(frameW: number, frameH: number, v: View): [number, number] {
  const f = fit(frameW, frameH, v, 1).s;
  return [f / 10, f * 40];
}

export interface At {
  x: number;
  y: number;
  span: number;
}

export function atOf(c: Camera, v: View): At {
  return { x: Math.round(c.cx), y: Math.round(c.cy), span: Math.max(1, Math.round(Math.min(v.w, v.h) / c.s)) };
}

export function cameraFromAt(at: At, v: View): Camera {
  return { cx: at.x, cy: at.y, s: Math.min(v.w, v.h) / at.span };
}

/** Centre on a point at a scale a few times the fit, for the element view's mark. */
export function centreOn(frameW: number, frameH: number, v: View, x: number, y: number, times = 3): Camera {
  const f = fit(frameW, frameH, v).s;
  return { cx: x, cy: y, s: f * times };
}
