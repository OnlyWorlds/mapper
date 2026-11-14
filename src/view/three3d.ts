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
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Raycaster,
  RGBAFormat,
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
import { clipToNear, type Projector } from '../core/hit3d';
import type { Scene } from '../core/scene';
import type { ItemKind, LineItem, PinItem, ZoneItem } from '../core/types';
import { MAX_SIDE, type Picture } from './picture';
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
}

const PIN_PX = 9;
const RING_PX = 11.5;
const SELECT_PX = 17;
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
  private frame3: Frame3D = { groundZ: 0, depth: 0 };
  private textures = { dot: roundTexture(null), ring: roundTexture(0.3) };
  /** What the list built: disposed and made again only when the list or the theme changes. */
  private built: { scene: Scene; theme: Theme; objects: (Mesh | LineSegments | Points)[] } | null = null;
  /** The view pass's marks, made again on every render (a handful of points and segments). */
  private marks: (LineSegments | Points)[] = [];
  private ground: { mesh: Mesh; url: string | null; bitmap: ImageBitmap | null; texture: Texture | null } | null = null;
  private maxTexture: number;
  private lostHandler: (e: Event) => void;
  private disposed = false;
  /** The camera's matrices as last rendered, for projections between renders. */
  private projDirty = true;
  draws = 0;
  lastDrawMs = 0;
  drewPicture = false;
  /** Called when the ground's picture came without CORS and is not drawn in 3D. */
  onGroundRefused: (() => void) | null = null;

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
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = false;
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

  resize(view: View, dpr: number): void {
    this.view = view;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(view.w, view.h, false);
    this.camera.aspect = view.w / Math.max(1, view.h);
    this.camera.updateProjectionMatrix();
    this.projDirty = true;
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
    const d = (r / Math.sin(Math.min(vfov * free, hfov) / 2)) * 0.92;
    const el = (32 * Math.PI) / 180;
    this.controls.target.copy(c);
    this.camera.position.set(c.x, c.y - d * Math.cos(el), c.z + d * Math.sin(el));
    this.controls.minDistance = r * 0.03;
    this.controls.maxDistance = r * 8;
    this.controls.update();
    this.clip();
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
    if (this.built && this.built.scene === scene && this.built.theme === theme) return;
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
      objects.push(Object.assign(new LineSegments(segmentsGeometry(segs), new LineBasicMaterial({ color: l.color, transparent: true, opacity: Math.max(0.25, l.alpha) })), { userData: { kind: 'line' } }));
    }

    // Stems from each Pin down (or up) to the ground's height, so a height reads.
    const pins = scene.items.filter((it): it is PinItem => it.kind === 'pin');
    const stems: number[] = [];
    for (const p of pins) if (p.z !== gz) stems.push(p.x, p.y, p.z, p.x, p.y, gz);
    if (stems.length) {
      const l = css(theme.line);
      objects.push(Object.assign(new LineSegments(segmentsGeometry(stems), new LineBasicMaterial({ color: l.color, transparent: true, opacity: Math.max(0.12, l.alpha * 0.4) })), { userData: { kind: 'pin' } }));
    }

    // Pins: a ring in the ring colour under a disc in the group's colour, a constant size on screen.
    if (pins.length) {
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
    this.built = { scene, theme, objects };
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
    ring(pinsOf(pass.marked), pass.theme.accent, MARK_PX);
    ring(pinsOf(pass.selection), pass.theme.accent, SELECT_PX);
    const hov = pass.hover && !pass.selection.has(pass.hover) ? [pass.hover] : [];
    ring(pinsOf(hov), pass.theme.hover, SELECT_PX);
    const sel = lineSegs(pass.selection);
    if (sel.length) add(new LineSegments(segmentsGeometry(sel), new LineBasicMaterial({ color: css(pass.theme.accent).color, depthTest: false })));
    const hl = lineSegs(hov);
    if (hl.length) add(new LineSegments(segmentsGeometry(hl), new LineBasicMaterial({ color: css(pass.theme.hover).color, depthTest: false })));
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
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
