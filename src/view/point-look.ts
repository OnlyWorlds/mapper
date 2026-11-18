// The icon look's drawing (core/look3d.ts holds its sizes): a point grows as it nears the camera;
// under the threshold it is a dot in its colour with a lighter rim, from the threshold a body: a dark
// disc, a rim in its colour and its element type's icon at 72% of its width. Only what is lit glows:
// a selected Pin at 1.5 times its size with its rim halfway to white, the Pins its links reach at 1.25.
// Still one draw for every Pin and no loop: the 22 types' icons are drawn once onto one picture (the
// atlas), and each point carries the number of its own icon. Adapted from the OnlyWorlds dashboard's
// own icon look, so the two pages draw the same.
import { CanvasTexture, Color, LinearFilter, LinearMipmapLinearFilter, NormalBlending, ShaderMaterial, type IUniform } from 'three';
import { DOT_EDGE, GROW_MAX, GROW_MIN, ICON_AT, NEAR_GLOW, OPEN_GLOW, POINT_MAX_PX } from '../core/look3d';
import { TYPE_ICON_PATHS } from './type-icons';

/** A number as a GLSL float literal (`1` is not a float there). */
const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

const CELL = 128;
const PAD = 14;
const COLS = 8;
const DISC = '#0b1118';

export interface IconAtlas {
  readonly tex: CanvasTexture;
  /** A type's cell in the atlas; a type with no icon has none (its points stay dots). */
  readonly index: ReadonlyMap<string, number>;
  readonly cols: number;
  readonly rows: number;
}

/**
 * Every type's icon in white on one picture, one cell each, or null where the browser cannot draw a
 * path. All 22 at once, so a type that arrives with a later read has its icon too.
 */
export function iconAtlas(): IconAtlas | null {
  const kinds = Object.keys(TYPE_ICON_PATHS).sort();
  if (!kinds.length || typeof Path2D !== 'function') return null;
  const cols = Math.min(COLS, kinds.length);
  const rows = Math.ceil(kinds.length / cols);
  const cv = document.createElement('canvas');
  cv.width = cols * CELL;
  cv.height = rows * CELL;
  const c = cv.getContext('2d');
  if (!c) return null;
  c.fillStyle = '#ffffff';
  const k = (CELL - 2 * PAD) / 960;
  const index = new Map<string, number>();
  kinds.forEach((t, i) => {
    const x = (i % cols) * CELL + PAD;
    const y = Math.floor(i / cols) * CELL + PAD;
    // The icons' viewBox is 0 -960 960 960.
    c.setTransform(k, 0, 0, k, x, y + 960 * k);
    c.fill(new Path2D(TYPE_ICON_PATHS[t]));
    index.set(t, i);
  });
  const tex = new CanvasTexture(cv);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return { tex, index, cols, rows };
}

/** The uniforms every point material of one view shares: the atlas, the fitted distance, the screen and the threshold. */
export interface SharedLook {
  uAtlas: IUniform;
  uCols: IUniform<number>;
  uRows: IUniform<number>;
  uPad: IUniform<number>;
  uRef: IUniform<number>;
  uDpr: IUniform<number>;
  uFrom: IUniform<number>;
  uDisc: IUniform<Color>;
  uGrowMin: IUniform<number>;
  uGrowMax: IUniform<number>;
  uMaxPx: IUniform<number>;
  /** The largest point sprite the GPU draws, device px. */
  uMaxSprite: IUniform<number>;
}

export function sharedLook(atlas: IconAtlas): SharedLook {
  return {
    uAtlas: { value: atlas.tex },
    uCols: { value: atlas.cols },
    uRows: { value: atlas.rows },
    uPad: { value: PAD / CELL },
    uRef: { value: 0 },
    uDpr: { value: 1 },
    uFrom: { value: ICON_AT },
    uDisc: { value: new Color(DISC) },
    uGrowMin: { value: GROW_MIN },
    uGrowMax: { value: GROW_MAX },
    uMaxPx: { value: POINT_MAX_PX },
    uMaxSprite: { value: 64 },
  };
}

const VERT = /* glsl */ `
attribute vec4 aCol;
attribute float aIcon;
uniform float uPx, uScale, uRef, uDpr, uLit, uGrowMin, uGrowMax, uMaxPx, uMaxSprite;
varying vec4 vCol;
varying float vIcon;
varying float vBody;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  float k = (uRef > 0.0 && d > 0.0) ? clamp(uRef / d, uGrowMin, uGrowMax) : 1.0;
  float g = uLit > 1.5 ? ${f(OPEN_GLOW)} : (uLit > 0.5 ? ${f(NEAR_GLOW)} : 1.0);
  // The sprite (body and glow) held to what the GPU draws, so a clamp never cuts the body short.
  float body = min(min(uPx * uScale * k, uMaxPx) * uDpr, uMaxSprite / g);
  vBody = body;
  vCol = aCol;
  vIcon = aIcon;
  gl_PointSize = body * g;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uCols, uRows, uPad, uFrom, uLit, uDpr, uFade;
uniform vec3 uDisc;
varying vec4 vCol;
varying float vIcon;
varying float vBody;
void main() {
  float G = uLit > 1.5 ? ${f(OPEN_GLOW)} : (uLit > 0.5 ? ${f(NEAR_GLOW)} : 1.0);
  vec2 p = (gl_PointCoord - 0.5) * 2.0 * G;
  float d = length(p);
  float px = 1.0 / max(vBody * 0.5, 0.5);
  vec3 kind = vCol.rgb;
  bool body = vBody >= uFrom * uDpr && vIcon >= 0.0;
  float edge = body ? 1.0 : ${f(DOT_EDGE)};
  float a = clamp((edge - d) / px + 0.5, 0.0, 1.0);
  // The atlas read outside any branch (its filtering is undefined inside one), its place clamped to the cell.
  vec2 q = p / 0.72;
  float row = floor((max(vIcon, 0.0) + 0.5) / uCols);
  float col = max(vIcon, 0.0) - row * uCols;
  vec2 cell = (clamp(q, -1.0, 1.0) * 0.5 + 0.5) * (1.0 - 2.0 * uPad) + uPad;
  float ink = texture2D(uAtlas, vec2((col + cell.x) / uCols, 1.0 - (row + cell.y) / uRows)).a;
  ink *= step(abs(q.x), 1.0) * step(abs(q.y), 1.0);
  vec3 c;
  if (body) {
    c = mix(uDisc, mix(kind, vec3(1.0), 0.1), ink);
    float rimW = max(0.16, px);
    float rim = clamp((d - (1.0 - rimW)) / px + 0.5, 0.0, 1.0);
    c = mix(c, uLit > 1.5 ? mix(kind, vec3(1.0), 0.5) : kind, rim);
  } else {
    float rimW = max(${f(0.22 * DOT_EDGE)}, px);
    float rim = clamp((d - (${f(DOT_EDGE)} - rimW)) / px + 0.5, 0.0, 1.0);
    c = mix(kind, mix(kind, vec3(1.0), 0.45), rim);
  }
  float g = 0.0;
  if (uLit > 0.5 && d > edge) {
    float t = clamp((d - edge) / (G - edge), 0.0, 1.0);
    g = (uLit > 1.5 ? 0.59 : 0.37) * (1.0 - t) * (1.0 - t);
  }
  float alpha = max(a, g);
  vec3 outc = mix(mix(kind, vec3(1.0), 0.25), c, alpha > 0.0 ? a / alpha : 1.0);
  alpha *= vCol.a * uFade;
  if (alpha < 0.03) discard;
  gl_FragColor = vec4(outc, alpha);
  #include <colorspace_fragment>
}`;

/**
 * One point material of the icon look. `px` is the point's base width in CSS pixels, `scale` its lit
 * growth (1, NEAR_SCALE, OPEN_SCALE), `lit` 0 none, 1 a reached Pin's glow, 2 a selected Pin's. The
 * geometry carries `aCol` (the point's colour and strength) and `aIcon` (its cell in the atlas, -1 for
 * none). `uFade` dims the whole set (a focus dims the Pins it does not reach).
 */
export function iconMaterial(shared: SharedLook, px: number, scale: number, lit: 0 | 1 | 2, depthTest: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...shared, uPx: { value: px }, uScale: { value: scale }, uLit: { value: lit }, uFade: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: NormalBlending,
    depthTest,
    depthWrite: depthTest,
  });
}

const RING_VERT = /* glsl */ `
attribute vec3 aCol;
attribute float aSize, aLine;
uniform float uDpr;
varying vec3 vCol;
varying float vSize, vLine;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vCol = aCol;
  vSize = aSize;
  vLine = aLine;
  gl_PointSize = aSize * uDpr;
}`;

const RING_FRAG = /* glsl */ `
uniform float uDpr;
varying vec3 vCol;
varying float vSize, vLine;
void main() {
  float R = vSize * uDpr * 0.5;
  float r = length(gl_PointCoord - 0.5) * 2.0 * R;
  float w = vLine * uDpr;
  float a = clamp(R - 0.5 - r + 0.5, 0.0, 1.0) * clamp(r - (R - 0.5 - w) + 0.5, 0.0, 1.0);
  if (a < 0.03) discard;
  gl_FragColor = vec4(vCol, a);
  #include <colorspace_fragment>
}`;

/**
 * The rings round points as the icon look draws them (the hover, the element view's mark), each over
 * everything, its own width across (`aSize`, CSS px), line width (`aLine`) and colour (`aCol`), so a
 * fixed-size ring never sits inside a near icon. One material serves every ring of a view: made once,
 * its program is linked once (a material made per frame linked a program on every frame).
 */
export function ringMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uDpr: { value: 1 } },
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}
