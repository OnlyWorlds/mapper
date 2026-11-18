// The 3D surface: a second reader of the same scene list, for a layout map with a depth. Loaded on
// demand (this module and three.js are one chunk the flat tool never fetches). It draws the list
// and the view pass, nothing else: Pins as round points at (x, y, z) in the Map's frame (z up) with
// a stem down to the ground's height, link lines as segments between the Pins' points, the ground's
// picture as a plane at its height with its Zones' outlines on it, and the frame's box. It renders
// on demand, never in a loop, and gives the page its projection, so the pointer asks the list.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MOUSE,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Raycaster,
  RGBAFormat,
  ShaderMaterial,
  Scene as ThreeScene,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GROUP_COLORS, type ElementGroup } from '@onlyworlds/sdk';
import type { View } from '../core/camera';
import { focusOf } from '../core/focus';
import { clipToNear, type Projector } from '../core/hit3d';
import { drawn, ICON_FROM, NEAR_SCALE, OPEN_SCALE, type Drawn, type Lit } from '../core/look3d';
import type { Scene } from '../core/scene';
import type { ItemKind, LineItem, PinItem, ZoneItem } from '../core/types';
import { MAX_SIDE, type Picture } from './picture';
import { iconAtlas, iconMaterial, ringMaterial, sharedLook, type IconAtlas, type SharedLook } from './point-look';
import type { Theme } from './render';

export interface Pass3D {
  selection: ReadonlySet<string>;
  hover: string | null;
  marked: ReadonlySet<string>;
  hidden: ReadonlySet<ItemKind>;
  pictures: ReadonlyMap<string, Picture>;
  theme: Theme;
}

export interface Frame3D {
  /** The ground's height (the layout's `ground_z`, else 0): the plane, its Zones and the stems' feet. */
  groundZ: number;
  /** The Map's depth: the frame's box is this tall. */
  depth: number;
  /**
   * Whether each Pin has a stem to the ground's height. A `by-links-3d` layout has none: its third
   * axis is the method's, not a height above a ground, and thousands of stems hid the Pins below.
   */
  stems: boolean;
}

const PIN_PX = 9;
const RING_PX = 11.5;
/** Up to this many link lines draw at the theme's full strength; past it each fades by the square root of the count. */
const LINE_FADE_AT = 8;
const SELECT_PX = 17;
/** While a Pin is selected, the points it does not link to draw at this strength (its lines alone show). */
const FOCUS_DIM = 0.16;
const MARK_PX = 23;
const FOV = 45;

/** A round mark as a texture: a disc, or a ring of the given width (as a share of the radius). */
function roundTexture(ring: number | null): DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  const c = (n - 1) / 2;
  const R = n / 2 - 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - c, y - c);
      let a = Math.min(1, Math.max(0, R - d + 0.5));
      if (ring !== null) a = Math.min(a, Math.min(1, Math.max(0, d - R * (1 - ring) + 0.5)));
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new DataTexture(data, n, n, RGBAFormat);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** A CSS colour as three's colour and its alpha (rgba() keeps its alpha apart). */
function css(v: string): { color: Color; alpha: number } {
  const m = /^rgba?\(([^)]+)\)$/i.exec(v.trim());
  if (m) {
    const p = m[1].split(',').map((s) => s.trim());
    const color = new Color(`rgb(${p[0]}, ${p[1]}, ${p[2]})`);
    return { color, alpha: p[3] !== undefined ? Math.max(0, Math.min(1, Number(p[3]))) : 1 };
  }
  const color = new Color();
  try {
    color.setStyle(v);
  } catch {
    color.set(0x888888);
  }
  return { color, alpha: 1 };
}

function pinColor(style: string, theme: Theme): string {
  const g = style.slice(4) as ElementGroup | 'none';
  return g === 'none' ? theme.pinNone : GROUP_COLORS[g]?.[theme.mode] ?? theme.pinNone;
}

/** Points at these places, one colour each or one for all. */
function pointsGeometry(pts: readonly [number, number, number][], colors?: readonly Color[]): BufferGeometry {
  const g = new BufferGeometry();
  const pos = new Float32Array(pts.length * 3);
  pts.forEach(([x, y, z], i) => pos.set([x, y, z], i * 3));
  g.setAttribute('position', new BufferAttribute(pos, 3));
  if (colors) {
    const col = new Float32Array(pts.length * 3);
    colors.forEach((c, i) => col.set([c.r, c.g, c.b], i * 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
  }
  return g;
}

function segmentsGeometry(segs: readonly number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(segs, 3));
  return g;
}

export class Surface3D implements Projector {
  readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private three = new ThreeScene();
  readonly camera = new PerspectiveCamera(FOV, 1, 1, 10);
  private controls: OrbitControls;
  private view: View = { w: 1, h: 1 };
  private scene: Scene | null = null;
  private frame3: Frame3D = { groundZ: 0, depth: 0, stems: true };
  private textures = { dot: roundTexture(null), ring: roundTexture(0.3) };
  /** What the list built: disposed and made again only when the list or the theme changes. */
  private built: { scene: Scene; theme: Theme; icons: boolean; objects: (Mesh | LineSegments | Points)[] } | null = null;
  /** The view pass's marks, made again on every render (a handful of points and segments). */
  private marks: (LineSegments | Points)[] = [];
  /** How the last pass drew, for the walks: the Pins in focus and the lines shown with them, or null. */
  focusShown: { pins: number; lines: number } | null = null;
  private ground: { mesh: Mesh; url: string | null; bitmap: ImageBitmap | null; texture: Texture | null } | null = null;
  private maxTexture: number;
  private lostHandler: (e: Event) => void;
  private disposed = false;
  /** The camera's matrices as last rendered, for projections between renders. */
  private projDirty = true;
  /** CSS pixels the projection's centre sits below the view's: half the overlay at the top, so a fit centres the picture in what the overlays leave free. */
  private lift = 0;
  draws = 0;
  lastDrawMs = 0;
  drewPicture = false;
  /** How many stems the last build drew (for a walk). */
  stemCount = 0;
  /** Called when the ground's picture came without CORS and is not drawn in 3D. */
  onGroundRefused: (() => void) | null = null;

  // The icon look (core/look3d.ts): off until the switch asks for it; the atlas is drawn on first use.
  private icons = false;
  private from: number = ICON_FROM[1];
  private atlas: IconAtlas | null = null;
  private shared: SharedLook | null = null;
  /** The camera's distance when the view was fitted: a point at it is drawn at its base width. */
  private ref = 0;
  private dpr = 1;
  /** The largest point sprite this GPU draws, device px. */
  private maxSprite = 64;
  /** Each lit Pin's light as the last pass drew it (selected 2, reached 1): the press reads the same. */
  private lit = new Map<string, Lit>();

  /** Throws when the browser cannot start WebGL. */
  constructor(
    parent: HTMLElement,
    label: string,
    private onCamera: () => void,
    onLost: () => void,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'surface surface-3d';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', label);
    this.lostHandler = () => {
      if (!this.disposed) onLost();
    };
    this.canvas.addEventListener('webglcontextlost', this.lostHandler);
    parent.prepend(this.canvas);
    try {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'default' });
    } catch (e) {
      this.canvas.removeEventListener('webglcontextlost', this.lostHandler);
      this.canvas.remove();
      throw e;
    }
    this.maxTexture = Math.min(MAX_SIDE, this.renderer.capabilities.maxTextureSize || MAX_SIDE);
    {
      const gl = this.renderer.getContext();
      const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
      if (range && range[1] >= 1) this.maxSprite = range[1];
    }
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = false;
    // Left drag turns; middle or right drag moves; the wheel zooms (a middle drag used to zoom slowly, a second zoom
    // beside the wheel).
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN };
    // A middle press would otherwise start the browser's own autoscroll on Windows.
    this.canvas.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
    this.controls.zoomToCursor = true;
    this.controls.minPolarAngle = 0.02;
    this.controls.maxPolarAngle = Math.PI - 0.02;
    this.controls.addEventListener('change', () => {
      this.clip();
      this.projDirty = true;
      this.onCamera();
    });
  }

  /** The largest picture copy the device takes as a texture. */
  get textureCap(): number {
    return this.maxTexture;
  }

  /** A new list (the page fits the camera; a list never moves it). */
  setScene(scene: Scene, frame: Frame3D): void {
    this.scene = scene;
    this.frame3 = frame;
  }

  /** `top`, the overlay's height now: a fit's lift follows it, so a turned view keeps its place in the free part. */
  resize(view: View, dpr: number, top?: number): void {
    this.view = view;
    if (this.lift > 0 && top !== undefined) this.lift = this.liftFor(top);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(view.w, view.h, false);
    this.dpr = this.renderer.getPixelRatio();
    if (this.shared) this.shared.uDpr.value = this.dpr;
    this.camera.aspect = view.w / Math.max(1, view.h);
    this.offset();
    this.camera.updateProjectionMatrix();
    this.projDirty = true;
  }

  /** Half the overlay's height, the overlay held to 70% of the view as the fit's `free` is. */
  private liftFor(top: number): number {
    return Math.max(0, Math.min(top, this.view.h * 0.7)) / 2;
  }

  /** The projection's centre moved down by `lift`; every screen read goes through the same matrix. */
  private offset(): void {
    const { w, h } = this.view;
    if (this.lift > 0) this.camera.setViewOffset(w, h, 0, -this.lift, w, h);
    else this.camera.clearViewOffset();
  }

  /** The frame's centre and its half-diagonal: what a fit shows. */
  private bounds(): { c: Vector3; r: number } {
    const s = this.scene;
    const w = s?.frame.w ?? 1000;
    const h = s?.frame.h ?? 1000;
    let z0 = Math.min(0, this.frame3.groundZ);
    let z1 = Math.max(this.frame3.depth, this.frame3.groundZ);
    if (s) for (const it of s.items) if (it.kind === 'pin') { if (it.z < z0) z0 = it.z; if (it.z > z1) z1 = it.z; }
    return { c: new Vector3(w / 2, h / 2, (z0 + z1) / 2), r: Math.max(1, Math.hypot(w, h, z1 - z0) / 2) };
  }

  /** Near and far planes follow the camera's distance, so a frame 8000 wide keeps its depth precision. */
  private clip(): void {
    const { r } = this.bounds();
    const d = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = Math.max(0.5, d * 0.01);
    this.camera.far = d + r * 4;
    this.camera.updateProjectionMatrix();
  }

  /** The whole frame in view, seen from the south and above, clear of `top` CSS pixels of overlay. */
  fit(top: number): void {
    const { c, r } = this.bounds();
    const vfov = (FOV * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const free = Math.max(0.3, 1 - top / Math.max(1, this.view.h));
    // The frame's centre stands at the centre of the free part, below the overlays, not of the screen.
    this.lift = this.liftFor(top);
    this.offset();
    const d = (r / Math.sin(Math.min(vfov * free, hfov) / 2)) * 0.92;
    const el = (32 * Math.PI) / 180;
    this.controls.target.copy(c);
    this.camera.position.set(c.x, c.y - d * Math.cos(el), c.z + d * Math.sin(el));
    this.controls.minDistance = r * 0.03;
    this.controls.maxDistance = r * 8;
    this.controls.update();
    this.clip();
    // The icon look grows a point by how much nearer it is than this.
    this.ref = this.camera.position.distanceTo(this.controls.target);
    if (this.shared) this.shared.uRef.value = this.ref;
    this.projDirty = true;
  }

  /** Nearer (f > 1) or farther, toward the target. */
  dolly(f: number): void {
    const off = this.camera.position.clone().sub(this.controls.target).divideScalar(f);
    const len = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, off.length()));
    this.camera.position.copy(this.controls.target).add(off.setLength(len));
    this.controls.update();
  }

  /** Turn round the target: `az` about the up axis, `pol` toward or away from it, in radians. */
  turn(az: number, pol: number): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    const rho = off.length();
    const theta = Math.atan2(off.y, off.x) + az;
    let phi = Math.acos(Math.max(-1, Math.min(1, off.z / rho))) + pol;
    phi = Math.max(this.controls.minPolarAngle, Math.min(this.controls.maxPolarAngle, phi));
    off.set(rho * Math.sin(phi) * Math.cos(theta), rho * Math.sin(phi) * Math.sin(theta), rho * Math.cos(phi));
    this.camera.position.copy(this.controls.target).add(off);
    this.controls.update();
  }

  /** Move the camera and its target together so the point stands at the view's centre. */
  centreOn(x: number, y: number, z: number): void {
    // The view's own centre: the lift is the whole frame's fit, and a placed point keeps its own rule.
    if (this.lift !== 0) {
      this.lift = 0;
      this.offset();
      this.projDirty = true;
    }
    const off = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.set(x, y, z);
    this.camera.position.set(x, y, z).add(off);
    this.controls.update();
  }

  /** Move the camera and target in the view's plane so the point at (sx, sy) on screen stands at (tx, ty). */
  nudge(x: number, y: number, z: number, sx: number, sy: number, tx: number, ty: number): void {
    const p = new Vector3(x, y, z);
    const dist = Math.max(1e-6, p.clone().sub(this.camera.position).dot(this.camera.getWorldDirection(new Vector3())));
    const perPx = (2 * dist * Math.tan(((FOV * Math.PI) / 180) / 2)) / Math.max(1, this.view.h);
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const move = right.multiplyScalar((sx - tx) * perPx).add(up.multiplyScalar((ty - sy) * perPx));
    this.camera.position.add(move);
    this.controls.target.add(move);
    this.controls.update();
  }

  private matrices(): void {
    if (!this.projDirty) return;
    this.camera.updateMatrixWorld();
    this.projDirty = false;
  }

  project(x: number, y: number, z: number): [number, number, number] | null {
    this.matrices();
    const v = new Vector3(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z >= -this.camera.near) return null;
    v.applyMatrix4(this.camera.projectionMatrix);
    if (v.z > 1) return null;
    return [((v.x + 1) / 2) * this.view.w, ((1 - v.y) / 2) * this.view.h, (v.z + 1) / 2];
  }

  projectSegment(a: [number, number, number], b: [number, number, number]): [[number, number], [number, number]] | null {
    this.matrices();
    const toCam = (p: [number, number, number]) => new Vector3(...p).applyMatrix4(this.camera.matrixWorldInverse).toArray() as [number, number, number];
    const cut = clipToNear(toCam(a), toCam(b), this.camera.near * 1.001);
    if (!cut) return null;
    const s = (c: [number, number, number]): [number, number] => {
      const v = new Vector3(...c).applyMatrix4(this.camera.projectionMatrix);
      return [((v.x + 1) / 2) * this.view.w, ((1 - v.y) / 2) * this.view.h];
    };
    return [s(cut[0]), s(cut[1])];
  }

  onPlane(sx: number, sy: number, z: number): [number, number] | null {
    this.matrices();
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2((sx / this.view.w) * 2 - 1, 1 - (sy / this.view.h) * 2), this.camera);
    const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), -z), new Vector3());
    return hit ? [hit.x, hit.y] : null;
  }

  /** What the list holds, as three's objects (made again only when the list or the theme changes). */
  private build(scene: Scene, theme: Theme): void {
    if (this.built && this.built.scene === scene && this.built.theme === theme && this.built.icons === this.icons) return;
    this.clearBuilt();
    const objects: (Mesh | LineSegments | Points)[] = [];
    const gz = this.frame3.groundZ;
    this.renderer.setClearColor(css(theme.bg).color, 1);

    // The frame's box: the Map's width, height and depth.
    const box = new LineSegments(new EdgesGeometry(new BoxGeometry(scene.frame.w, scene.frame.h, Math.max(1, this.frame3.depth))), new LineBasicMaterial({ color: css(theme.zone).color, transparent: true, opacity: 0.22 }));
    box.position.set(scene.frame.w / 2, scene.frame.h / 2, this.frame3.depth / 2);
    box.userData.kind = 'frame';
    objects.push(box);

    // Zones: their outlines on the ground's plane; polygons in the zone colour, lines as roads.
    const polys: number[] = [];
    const roads: number[] = [];
    for (const it of scene.items) {
      if (it.kind !== 'zone') continue;
      const z = it as ZoneItem;
      const out = z.shape === 'polygon' ? polys : roads;
      const n = z.points.length;
      const last = z.shape === 'polygon' ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const [ax, ay] = z.points[i];
        const [bx, by] = z.points[(i + 1) % n];
        out.push(ax, ay, gz, bx, by, gz);
      }
    }
    if (polys.length) objects.push(Object.assign(new LineSegments(segmentsGeometry(polys), new LineBasicMaterial({ color: css(theme.zone).color })), { userData: { kind: 'zone' } }));
    if (roads.length) objects.push(Object.assign(new LineSegments(segmentsGeometry(roads), new LineBasicMaterial({ color: css(theme.road).color })), { userData: { kind: 'zone' } }));

    // Link lines between the Pins' points.
    const segs: number[] = [];
    for (const it of scene.items) if (it.kind === 'line') segs.push(it.ax, it.ay, it.az, it.bx, it.by, it.bz);
    if (segs.length) {
      const l = css(theme.line);
      // Many lines over one another add up to a white sheet (Sikelia's thousands): each line fades as
      // their number grows, by the square root, never below a floor, so the points stay the picture.
      // A line writes no depth, so it never hides a point behind it.
      const n = segs.length / 6;
      const opacity = Math.max(0.02, Math.min(l.alpha, l.alpha * LINE_FADE_AT / Math.sqrt(n)));
      objects.push(Object.assign(new LineSegments(segmentsGeometry(segs), new LineBasicMaterial({ color: l.color, transparent: true, opacity, depthWrite: false })), { userData: { kind: 'line' } }));
    }

    // Stems from each Pin down (or up) to the ground's height, so a height reads.
    const pins = scene.items.filter((it): it is PinItem => it.kind === 'pin');
    const stems: number[] = [];
    if (this.frame3.stems) for (const p of pins) if (p.z !== gz) stems.push(p.x, p.y, p.z, p.x, p.y, gz);
    this.stemCount = stems.length / 6;
    if (stems.length) {
      const l = css(theme.line);
      objects.push(Object.assign(new LineSegments(segmentsGeometry(stems), new LineBasicMaterial({ color: l.color, transparent: true, opacity: Math.max(0.12, l.alpha * 0.4) })), { userData: { kind: 'pin' } }));
    }

    // Pins: a ring in the ring colour under a disc in the group's colour, a constant size on screen;
    // in the icon look one set of points that grow as they near and turn into their icons.
    if (pins.length && this.icons && this.shared) {
      const cache = new Map<string, Color>();
      const pos = new Float32Array(3 * pins.length);
      const col = new Float32Array(4 * pins.length);
      const icon = new Float32Array(pins.length);
      pins.forEach((p, i) => {
        let c = cache.get(p.style);
        if (!c) cache.set(p.style, (c = css(pinColor(p.style, theme)).color));
        pos.set([p.x, p.y, p.z], 3 * i);
        col.set([c.r, c.g, c.b, 1], 4 * i);
        icon[i] = this.iconOf(p);
      });
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('aCol', new BufferAttribute(col, 4));
      g.setAttribute('aIcon', new BufferAttribute(icon, 1));
      const pts = new Points(g, iconMaterial(this.shared, PIN_PX, 1, 0, true));
      pts.renderOrder = 2;
      pts.userData.kind = 'pin';
      objects.push(pts);
    } else if (pins.length) {
      const pts = pins.map((p) => [p.x, p.y, p.z] as [number, number, number]);
      const ring = new Points(pointsGeometry(pts), new PointsMaterial({ size: RING_PX, sizeAttenuation: false, map: this.textures.dot, color: css(theme.pinRing).color, transparent: true, alphaTest: 0.05 }));
      ring.renderOrder = 1;
      ring.userData.kind = 'pin';
      const cache = new Map<string, Color>();
      const colors = pins.map((p) => {
        let c = cache.get(p.style);
        if (!c) cache.set(p.style, (c = css(pinColor(p.style, theme)).color));
        return c;
      });
      const dots = new Points(pointsGeometry(pts, colors), new PointsMaterial({ size: PIN_PX, sizeAttenuation: false, map: this.textures.dot, vertexColors: true, transparent: true, alphaTest: 0.05 }));
      dots.renderOrder = 2;
      dots.userData.kind = 'pin';
      objects.push(ring, dots);
    }
    for (const o of objects) this.three.add(o);
    this.built = { scene, theme, icons: this.icons, objects };
  }

  private clearBuilt(): void {
    if (!this.built) return;
    for (const o of this.built.objects) {
      this.three.remove(o);
      o.geometry.dispose();
      (o.material as { dispose(): void }).dispose();
    }
    this.built = null;
  }

  /** The ground's plane: its picture's largest copy the device takes, or blank until one lands. */
  private placeGround(scene: Scene, pass: Pass3D): void {
    const pic = scene.items.find((it) => it.kind === 'picture');
    if (!pic || pic.kind !== 'picture' || pass.hidden.has('picture')) {
      if (this.ground) this.ground.mesh.visible = false;
      this.drewPicture = false;
      return;
    }
    const [x, y, w, h] = pic.rect;
    if (!this.ground || this.ground.url !== pic.url) {
      this.dropGround();
      // The ground never hides: drawn first, writing no depth, from both sides, so every Pin, stem,
      // line and outline (above it, on it or buried under it) draws over it and answers as drawn.
      const mat = new MeshBasicMaterial({ color: css(pass.theme.frame).color, side: DoubleSide, depthWrite: false });
      const mesh = new Mesh(new PlaneGeometry(w, h), mat);
      mesh.renderOrder = -1;
      this.three.add(mesh);
      this.ground = { mesh, url: pic.url, bitmap: null, texture: null };
    }
    const g = this.ground;
    g.mesh.visible = true;
    g.mesh.position.set(x + w / 2, y + h / 2, this.frame3.groundZ);
    const picture = pass.pictures.get(pic.url);
    if (picture?.plain) {
      // Read without CORS: WebGL may not upload it (it would sample black). Blank, and said.
      this.drewPicture = false;
      this.onGroundRefused?.();
      return;
    }
    let best: ImageBitmap | null = null;
    for (const l of picture?.levels ?? []) if (l.w <= this.maxTexture && l.h <= this.maxTexture) best = l.bitmap;
    if (!best && picture?.levels.length) best = picture.levels[0].bitmap;
    if (best && best !== g.bitmap) {
      g.texture?.dispose();
      const t = new Texture(best);
      t.flipY = false; // an ImageBitmap is uploaded as it is: the plane's v runs bottom-up, so the copy is read top-down
      t.repeat.set(1, -1);
      t.offset.set(0, 1);
      t.colorSpace = SRGBColorSpace;
      t.generateMipmaps = true;
      t.needsUpdate = true;
      const mat = g.mesh.material as MeshBasicMaterial;
      mat.map = t;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
      g.bitmap = best;
      g.texture = t;
    }
    this.drewPicture = !!g.texture;
  }

  private dropGround(): void {
    if (!this.ground) return;
    this.three.remove(this.ground.mesh);
    this.ground.mesh.geometry.dispose();
    (this.ground.mesh.material as MeshBasicMaterial).dispose();
    this.ground.texture?.dispose();
    this.ground = null;
  }

  /** The view pass: rings for the marked, the selected and the hovered Pins; their lines in the accent. */
  private placeMarks(scene: Scene, pass: Pass3D): void {
    for (const m of this.marks) {
      this.three.remove(m);
      m.geometry.dispose();
      (m.material as { dispose(): void }).dispose();
    }
    this.marks = [];
    this.lit.clear();
    const add = (o: LineSegments | Points) => {
      o.renderOrder = 5;
      this.marks.push(o);
      this.three.add(o);
    };
    const pinsOf = (ids: Iterable<string>) => {
      const out: [number, number, number][] = [];
      for (const id of ids) {
        const it = scene.byId.get(id);
        if (it?.kind === 'pin' && !pass.hidden.has('pin')) out.push([it.x, it.y, it.z]);
      }
      return out;
    };
    const ring = (pts: [number, number, number][], color: string, size: number) => {
      if (!pts.length) return;
      add(new Points(pointsGeometry(pts), new PointsMaterial({ size, sizeAttenuation: false, map: this.textures.ring, color: css(color).color, transparent: true, alphaTest: 0.05, depthTest: false })));
    };
    const lineSegs = (ids: Iterable<string>) => {
      const segs: number[] = [];
      for (const id of ids) {
        const it = scene.byId.get(id);
        if (it?.kind === 'line' && !pass.hidden.has('line')) segs.push((it as LineItem).ax, it.ay, it.az, it.bx, it.by, it.bz);
        else if (it?.kind === 'zone' && !pass.hidden.has('zone')) {
          const n = it.points.length;
          const last = it.shape === 'polygon' ? n : n - 1;
          for (let i = 0; i < last; i++) {
            const [ax, ay] = it.points[i];
            const [bx, by] = it.points[(i + 1) % n];
            segs.push(ax, ay, this.frame3.groundZ, bx, by, this.frame3.groundZ);
          }
        }
      }
      return segs;
    };
    // A selected Pin is a focus: only its own lines show, in the accent, and the Pins they reach keep
    // their colour while every other point dims. Empty space, or the Pin pressed again, gives the
    // whole picture back (the selection empties).
    const focus = pass.hidden.has('pin') ? null : focusOf(scene, pass.selection);
    const on = focus !== null;
    for (const o of this.built?.objects ?? []) {
      const kind = o.userData.kind;
      if (kind !== 'pin' && kind !== 'line') continue;
      if (o.material instanceof ShaderMaterial) {
        // The icon look's Pins: their own strength, the shader's.
        o.material.uniforms.uFade.value = on ? FOCUS_DIM : 1;
        continue;
      }
      const m = o.material as PointsMaterial | LineBasicMaterial;
      if (m.userData.full === undefined) m.userData.full = m.opacity;
      // The whole picture's lines hide in a focus; its Pins and stems dim.
      if (kind === 'line') o.visible = o.visible && !on;
      else m.opacity = on ? m.userData.full * FOCUS_DIM : m.userData.full;
    }
    this.focusShown = null;
    if (focus) {
      const { segs, near } = focus;
      if (segs.length && !pass.hidden.has('line')) add(new LineSegments(segmentsGeometry(segs), new LineBasicMaterial({ color: css(pass.theme.accent).color, transparent: true, opacity: 0.85, depthTest: false })));
      const pts: [number, number, number][] = [];
      const colors: Color[] = [];
      const reached: PinItem[] = [];
      const chosen: PinItem[] = [];
      for (const id of near) {
        const it = scene.byId.get(id);
        if (it?.kind !== 'pin') continue;
        pts.push([it.x, it.y, it.z]);
        colors.push(css(pinColor((it as PinItem).style, pass.theme)).color);
        (pass.selection.has(id) ? chosen : reached).push(it as PinItem);
      }
      if (this.icons && this.shared) {
        // The icon look: only what is lit glows, over the dimmed rest; the selected Pins drawn last, on top.
        for (const p of reached) this.lit.set(p.id, 1);
        for (const p of chosen) this.lit.set(p.id, 2);
        if (reached.length) add(this.iconPointsOf(reached, NEAR_SCALE, 1, pass.theme));
        if (chosen.length) add(this.iconPointsOf(chosen, OPEN_SCALE, 2, pass.theme));
      } else if (pts.length) {
        add(new Points(pointsGeometry(pts), new PointsMaterial({ size: RING_PX, sizeAttenuation: false, map: this.textures.dot, color: css(pass.theme.pinRing).color, transparent: true, alphaTest: 0.05, depthTest: false })));
        add(new Points(pointsGeometry(pts, colors), new PointsMaterial({ size: PIN_PX, sizeAttenuation: false, map: this.textures.dot, vertexColors: true, transparent: true, alphaTest: 0.05, depthTest: false })));
      }
      this.focusShown = { pins: pts.length, lines: pass.hidden.has('line') ? 0 : segs.length / 6 };
    }
    const hov = pass.hover && !pass.selection.has(pass.hover) ? [pass.hover] : [];
    if (this.icons && this.shared) {
      // The icon look: a selected Pin's light is its glow and its whitened rim; the mark and the hover
      // ring the point as it is drawn now, clear of its edge.
      this.ringsOf(pass.marked, scene, pass, pass.theme.accent, MARK_PX, 6, 2, add);
      this.ringsOf(hov, scene, pass, pass.theme.hover, SELECT_PX, 3, 2.5, add);
    } else {
      ring(pinsOf(pass.marked), pass.theme.accent, MARK_PX);
      ring(pinsOf(pass.selection), pass.theme.accent, SELECT_PX);
      ring(pinsOf(hov), pass.theme.hover, SELECT_PX);
    }
    const sel = lineSegs(pass.selection);
    if (sel.length) add(new LineSegments(segmentsGeometry(sel), new LineBasicMaterial({ color: css(pass.theme.accent).color, depthTest: false })));
    const hl = lineSegs(hov);
    if (hl.length) add(new LineSegments(segmentsGeometry(hl), new LineBasicMaterial({ color: css(pass.theme.hover).color, depthTest: false })));
  }

  // ---- the look: dots or icons

  /**
   * Dots (the fixed-size Pins) or icons: a point grows as it nears and turns into its type's icon at
   * `from` CSS px. False where the browser cannot draw the icons (the view stays in dots). Drawn on
   * the next render.
   */
  look(icons: boolean, from: number): boolean {
    if (this.disposed) return false;
    if (icons && !this.atlas) {
      this.atlas = iconAtlas();
      if (this.atlas) {
        this.shared = sharedLook(this.atlas);
        this.shared.uMaxSprite.value = this.maxSprite;
      }
    }
    const on = icons && !!this.shared;
    this.from = from;
    if (this.shared) {
      this.shared.uFrom.value = from;
      this.shared.uRef.value = this.ref;
      this.shared.uDpr.value = this.dpr;
    }
    if (on !== this.icons) {
      this.icons = on;
      this.clearBuilt();
    }
    this.projDirty = true;
    return on === icons;
  }

  get iconsOn(): boolean {
    return this.icons;
  }

  get iconFrom(): number {
    return this.from;
  }

  /** A Pin's cell in the atlas, or -1 (no type, or none with an icon: it stays a dot). */
  private iconOf(p: PinItem): number {
    if (!p.elementType || !this.atlas) return -1;
    return this.atlas.index.get(p.elementType.toLowerCase()) ?? -1;
  }

  /** A Pin as the icon look draws it now: its width, a body or a dot, the radius the press reads. */
  drawnOf(p: PinItem): Drawn {
    this.matrices();
    const v = new Vector3(p.x, p.y, p.z).applyMatrix4(this.camera.matrixWorldInverse);
    return drawn({ base: PIN_PX, lit: this.lit.get(p.id) ?? 0, ref: this.ref, depth: -v.z, dpr: this.dpr, maxSprite: this.maxSprite, from: this.from, hasIcon: this.iconOf(p) >= 0 });
  }

  /** The press's disc for a Pin in the icon look (pick3d's `disc`), or undefined in dots. */
  get disc(): ((p: PinItem) => { r: number; layer: number }) | undefined {
    if (!this.icons) return undefined;
    return (p) => ({ r: this.drawnOf(p).r, layer: this.lit.get(p.id) ?? 0 });
  }

  /** Lit Pins of the icon look, drawn over the dimmed rest: reached (lit 1) or selected (lit 2). */
  private iconPointsOf(pins: readonly PinItem[], scale: number, lit: 1 | 2, theme: Theme): Points {
    const pos = new Float32Array(3 * pins.length);
    const col = new Float32Array(4 * pins.length);
    const icon = new Float32Array(pins.length);
    pins.forEach((p, k) => {
      const c = css(pinColor(p.style, theme)).color;
      pos.set([p.x, p.y, p.z], 3 * k);
      col.set([c.r, c.g, c.b, 1], 4 * k);
      icon[k] = this.iconOf(p);
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aCol', new BufferAttribute(col, 4));
    g.setAttribute('aIcon', new BufferAttribute(icon, 1));
    return new Points(g, iconMaterial(this.shared!, PIN_PX, scale, lit, false));
  }

  /** A ring round each of these Pins as drawn now: `gap` CSS px clear of its edge, never smaller than `least`. */
  private ringsOf(ids: Iterable<string>, scene: Scene, pass: Pass3D, color: string, least: number, gap: number, line: number, add: (o: Points) => void): void {
    if (pass.hidden.has('pin')) return;
    for (const id of ids) {
      const it = scene.byId.get(id);
      if (it?.kind !== 'pin') continue;
      const size = Math.min(Math.max(least, 2 * (this.drawnOf(it).r + gap + line)), this.maxSprite / this.dpr);
      add(new Points(pointsGeometry([[it.x, it.y, it.z]]), ringMaterial(css(color).color, size, line, this.dpr)));
    }
  }

  /** How many shown Pins are drawn as their icon now (0 in dots), for a walk. */
  iconCount(): number {
    const s = this.scene;
    if (!this.icons || !s) return 0;
    let n = 0;
    for (const it of s.items) if (it.kind === 'pin' && this.project(it.x, it.y, it.z) && this.drawnOf(it).icon) n++;
    return n;
  }

  /** The renderer this view draws with, as the browser names it (a walk's bench says which machine it timed). */
  gpu(): string {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  }

  /**
   * Draws the last pass's picture this many times and answers the milliseconds each took, each waited
   * for: a one-pixel read waits for the frame to be drawn (`finish` alone did not, in Chromium).
   */
  bench(frames: number): number {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    this.renderer.render(this.three, this.camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let k = 0; k < frames; k++) {
      this.renderer.render(this.three, this.camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return (performance.now() - t0) / Math.max(1, frames);
  }

  render(pass: Pass3D): void {
    if (this.disposed) return;
    const t0 = performance.now();
    this.draws++;
    const scene = this.scene;
    if (scene) {
      this.build(scene, pass.theme);
      for (const o of this.built?.objects ?? []) {
        const k = o.userData.kind as ItemKind | 'frame';
        o.visible = k === 'frame' || !pass.hidden.has(k);
      }
      this.placeGround(scene, pass);
      this.placeMarks(scene, pass);
    }
    this.renderer.render(this.three, this.camera);
    this.projDirty = true;
    this.lastDrawMs = performance.now() - t0;
  }

  /** Everything three holds is given back, and the context is let go on purpose (one context at a time). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.lostHandler);
    this.controls.dispose();
    this.clearBuilt();
    this.dropGround();
    for (const m of this.marks) {
      m.geometry.dispose();
      (m.material as { dispose(): void }).dispose();
    }
    this.marks = [];
    this.textures.dot.dispose();
    this.textures.ring.dispose();
    this.atlas?.tex.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
