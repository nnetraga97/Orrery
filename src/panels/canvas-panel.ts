// A flat rectangle in the room whose picture is drawn on a 2D canvas, and which takes pinches. A pinch or a mouse
// click arrives as a pointer event with the hit's texture coordinate (event.uv); the panel maps it to the region under
// it (src/core/panel-hit.ts) and calls onPress, onHover or onDrag.
//
// A panel made with `window` options is a window (docs/visual-style.md): a glass panel with a title in small capitals,
// a close mark, and a short grab bar beneath it. Pinching the bar and moving the hand moves the window, which keeps
// 0.5-1.4 m from the seat and turns smoothly to face the head. (The window is moved through the panel's own pointer
// events, with pointer capture, rather than a grab component: a grab component on the window's entity would take every
// pinch on the window, including those meant for its buttons.)
import {
  CanvasTexture,
  Matrix4,
  DoubleSide,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RayInteractable,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import type { Entity, Ray, WebGLRenderer, World } from '@iwsdk/core';
import { Panel } from '../components/panel.ts';
import { clampReach } from '../core/layout.ts';
import { regionAt, uvToPixel } from '../core/panel-hit.ts';
import { playSound } from '../state/commands.ts';
import type { HitRegion } from '../core/panel-hit.ts';
import type { Vec3 } from '../core/table-frame.ts';
import { closeMark, glassPanel, grabBar, THEME } from './paint.ts';

/** A pinch that moves less than this on the panel is a press, not a drag. */
const PRESS_METRES = 0.02;
/** Style pixels per metre: the reference sheet's chat window is 340 px for 0.40 m. */
export const STYLE_PX_PER_M = 850;
/** The strip under a window that holds its grab bar, in style pixels. */
const BAR_STRIP = 26;
const REACH = { min: 0.5, max: 1.4 };
const APPEAR_SECONDS = 0.25;
const TURN_RATE = 6;

export type DrawPanel = (ctx: CanvasRenderingContext2D, width: number, height: number) => HitRegion[];

interface PointerLike {
  uv?: { x: number; y: number };
  pointerId: number;
  distance: number;
  point: Vector3;
  ray: Ray;
}
type Listenable = {
  addEventListener(type: string, listener: (e: unknown) => void): void;
  setPointerCapture(id: number): void;
  releasePointerCapture(id: number): void;
};

export interface WindowOptions {
  /** The title in small capitals; a function is read at each redraw. */
  title: string | (() => string);
  hue?: string | (() => string);
  closable?: boolean;
  movable?: boolean;
}

export interface CanvasPanelOptions {
  name: string;
  widthPx: number;
  heightPx: number;
  widthM: number;
  heightM: number;
  renderer: WebGLRenderer;
  window?: WindowOptions;
}

/** Every panel by name, for the test hook (where a region is in the room). */
export const PANELS = new Map<string, CanvasPanel>();

export class CanvasPanel {
  canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  readonly mesh: Mesh;
  readonly window: WindowOptions | null;
  /** Canvas pixels per style pixel. */
  readonly u: number;
  entity: Entity | null = null;
  regions: HitRegion[] = [];
  hovered: string | null = null;
  /** Set once the user has moved the window by its bar: its owner stops placing it. */
  moved = false;
  /** The seat's eye, for the reach limit while moving. */
  eye: Vec3 = [0, 1.2, 0];
  onPress: (id: string) => void = () => {};
  onHover: (id: string | null) => void = () => {};
  onDrag: (dxPx: number, dyPx: number) => void = () => {};
  /** A pinch began on a region (for press-and-hold controls such as the microphone). */
  onPressStart: (id: string) => void = () => {};
  /** That pinch ended (let go, the hand was lost, or the window hid), wherever the ray is by then. */
  onPressEnd: (id: string) => void = () => {};
  /** Where the current pinch began on the canvas, or null between pinches. */
  pinchStart: [number, number] | null = null;
  private held: string | null = null;
  /** Pressing the close mark; by default it hides the window. */
  onClose: () => void = () => (this.visible = false);
  /** Called after the user moves the window. */
  onMoved: () => void = () => {};
  private widthPx: number;
  private heightPx: number;
  private widthM: number;
  private heightM: number;
  private lastDraw: DrawPanel | null = null;
  private down: { x: number; y: number; startX: number; startY: number } | null = null;
  /** Where the owning pointer aimed last before a pinch (canvas pixels), and the region the pinch pressed. */
  private readonly aim: [number, number] = [0, 0];
  private aimed = false;
  private pressed: string | null = null;
  /** The pointer that owns this window's hover and pinch. */
  private owner: number | null = null;
  /** Canvas pixels a pinch may move and still be a press: 2 cm on the panel. */
  private readonly dragPx: number;
  // Pixels moved since the pinch began: a pinch that moved further is a drag, and its closing click is swallowed.
  private travel = 0;
  private moving: { pointerId: number; distance: number; offset: Vector3 } | null = null;
  private appear = 1;
  private shown = true;
  private readonly look = new Quaternion();
  private readonly lookTarget = new Quaternion();
  private readonly scratch = new Vector3();
  private readonly planeDir = new Vector3();
  private readonly planeInverse = new Matrix4();

  constructor(options: CanvasPanelOptions) {
    const { name, widthPx, heightPx, widthM, heightM, renderer } = options;
    this.window = options.window ?? null;
    this.widthPx = widthPx;
    this.heightPx = heightPx;
    this.widthM = widthM;
    this.heightM = heightM;
    this.u = widthPx / widthM / STYLE_PX_PER_M;
    this.dragPx = PRESS_METRES * (widthPx / widthM);
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.setupTexture(renderer);
    // Windows always sit between the user and the model, so they draw over it: text stays readable where a card
    // overlaps the globe.
    const material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: DoubleSide,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), material);
    this.mesh.name = `panel-${name}`;
    PANELS.set(name, this);
    this.mesh.renderOrder = 30;
    this.layout();
    const at = (event: unknown): [number, number] | null => {
      const uv = (event as PointerLike).uv;
      return uv ? uvToPixel(uv.x, uv.y, this.canvas.width, this.canvas.height) : null;
    };
    const target = this.mesh as unknown as Listenable;
    const id = (e: unknown) => (e as PointerLike).pointerId;
    // Two hand rays can rest on one window. The pinching hand owns the window until it lets go; otherwise the ray that
    // reached it last owns the hover, until it leaves.
    const owns = (e: unknown) => this.owner == null || this.owner === id(e);
    target.addEventListener('pointermove', e => {
      if (this.moving) {
        // Only the hand that took the bar moves the window.
        if (id(e) === this.moving.pointerId) this.moveWith(e as PointerLike);
        return;
      }
      if (!owns(e)) return;
      this.owner = id(e);
      // While pinched the pointer is captured, and its ray may leave the window (a gaze pinch follows the hand): the
      // drag is measured where that ray meets the window's plane.
      const p = this.down ? this.onPlane(e as PointerLike) : at(e);
      if (!p) return;
      if (!this.down) {
        this.aim[0] = p[0];
        this.aim[1] = p[1];
        this.aimed = true;
      }
      if (this.down) {
        // Net distance from where the pinch began decides press or drag; a jittering ray adds nothing.
        this.travel = Math.max(this.travel, Math.hypot(p[0] - this.down.startX, p[1] - this.down.startY));
        this.onDrag(p[0] - this.down.x, p[1] - this.down.y);
        this.down.x = p[0];
        this.down.y = p[1];
      }
      this.setHovered(regionAt(this.regions, p[0], p[1])?.id ?? null);
    });
    target.addEventListener('pointerdown', e => {
      if (this.down && this.owner !== id(e)) return;
      this.owner = id(e);
      const p = this.onPlane(e as PointerLike);
      // Drags are measured in the press's own frame (with gaze, IWSDK moves the pointer onto the pinching hand for the
      // length of the pinch); what is pressed is what the pointer was aiming at just before.
      this.down = p ? { x: p[0], y: p[1], startX: p[0], startY: p[1] } : null;
      this.travel = 0;
      const aim = this.aimed ? this.aim : p;
      this.pressed = aim ? (regionAt(this.regions, aim[0], aim[1])?.id ?? null) : null;
      this.pinchStart = aim ? [aim[0], aim[1]] : null;
      if (this.pressed && this.pressed !== 'grab' && this.pressed !== 'close') {
        this.endHold();
        this.held = this.pressed;
        this.onPressStart(this.pressed);
      }
      const event = e as PointerLike;
      if (p && this.window?.movable && this.pressed === 'grab') {
        this.moving = {
          pointerId: event.pointerId,
          distance: event.distance,
          offset: new Vector3().copy(this.mesh.position).sub(event.point),
        };
        this.down = null;
        this.redrawLast();
      }
      // Keep the pinch's events on this window until it ends.
      target.setPointerCapture(event.pointerId);
    });
    target.addEventListener('pointerup', e => {
      if (this.owner != null && id(e) !== this.owner) return;
      this.down = null;
      this.pinchStart = null;
      this.endHold();
      if (this.moving) {
        this.travel = this.dragPx + 1; // the closing click is not a press
        this.endMove();
      }
    });
    // A hand lost mid-pinch sends pointercancel and no pointerup.
    target.addEventListener('pointercancel', e => {
      if (this.owner != null && id(e) !== this.owner) return;
      this.down = null;
      this.pinchStart = null;
      this.endHold();
      this.travel = this.dragPx + 1;
      this.endMove();
    });
    target.addEventListener('pointerleave', e => {
      if (this.moving || (this.owner != null && id(e) !== this.owner)) return;
      this.down = null;
      this.owner = null;
      this.aimed = false;
      this.setHovered(null);
    });
    target.addEventListener('click', e => {
      if (this.owner != null && id(e) !== this.owner) return;
      if (this.travel > this.dragPx) return;
      const region = this.pressed;
      this.pressed = null;
      if (!region || region === 'grab') return;
      playSound('press');
      if (region === 'close' && this.window?.closable) this.onClose();
      else this.onPress(region);
    });
  }

  private setupTexture(renderer: WebGLRenderer) {
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.texture.generateMipmaps = true;
    this.texture.minFilter = LinearMipmapLinearFilter;
  }

  /** The canvas size and the plane: the glass area, plus the grab bar's strip below a window. */
  private layout() {
    const strip = this.window ? Math.round(BAR_STRIP * this.u) : 0;
    this.canvas.width = this.widthPx;
    this.canvas.height = this.heightPx + strip;
    const stripM = (strip / this.heightPx) * this.heightM;
    const geometry = new PlaneGeometry(this.widthM, this.heightM + stripM);
    // The mesh's origin stays at the centre of the glass.
    geometry.translate(0, -stripM / 2, 0);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
  }

  /** Changes the glass height, keeping the window's top edge where it is (the card grows downward). */
  resize(heightPx: number, heightM: number) {
    if (heightPx === this.heightPx) return;
    const shift = (heightM - this.heightM) / 2;
    this.heightPx = heightPx;
    this.heightM = heightM;
    this.layout();
    // A canvas that changes size needs a new texture.
    const renderer = { capabilities: { getMaxAnisotropy: () => this.texture.anisotropy } } as WebGLRenderer;
    this.texture.dispose();
    this.texture = new CanvasTexture(this.canvas);
    this.setupTexture(renderer);
    (this.mesh.material as MeshBasicMaterial).map = this.texture;
    this.scratch.set(0, -shift, 0).applyQuaternion(this.mesh.quaternion);
    this.mesh.position.add(this.scratch);
  }

  get glassHeightM() {
    return this.heightM;
  }

  private setHovered(id: string | null) {
    if (id === this.hovered) return;
    this.hovered = id;
    if (id) playSound('hover');
    this.onHover(id);
    if (this.window && (id === 'close' || id === 'grab' || this.lastHoverWasFrame)) this.redrawLast();
    this.lastHoverWasFrame = id === 'close' || id === 'grab';
  }
  private lastHoverWasFrame = false;
  /** A panel attached under another entity turns with it rather than toward the head. */
  private followsParent = false;

  private endHold() {
    const held = this.held;
    this.held = null;
    if (held) this.onPressEnd(held);
  }

  private endMove() {
    if (!this.moving) return;
    this.moving = null;
    this.redrawLast();
  }

  /** Where the event's ray meets the window's plane, in canvas pixels (null if it runs parallel to it). */
  private onPlane(event: PointerLike): [number, number] | null {
    const ray = event.ray;
    if (!ray) return null;
    this.mesh.updateWorldMatrix(true, false);
    const local = this.scratch.copy(ray.origin),
      dir = this.planeDir.copy(ray.direction);
    this.mesh.worldToLocal(local);
    this.planeInverse.copy(this.mesh.matrixWorld).invert();
    dir.transformDirection(this.planeInverse);
    if (Math.abs(dir.z) < 1e-6) return null;
    const t = -local.z / dir.z;
    const x = local.x + dir.x * t,
      y = local.y + dir.y * t;
    return [(x / this.widthM + 0.5) * this.widthPx, ((this.heightM / 2 - y) / this.heightM) * this.heightPx];
  }

  private moveWith(event: PointerLike) {
    const m = this.moving!;
    this.scratch.copy(event.ray.direction).multiplyScalar(m.distance).add(event.ray.origin).add(m.offset);
    const p = clampReach(this.eye, [this.scratch.x, this.scratch.y, this.scratch.z], REACH.min, REACH.max);
    this.mesh.position.set(p[0], p[1], p[2]);
    this.moved = true;
    this.onMoved();
  }

  /** Puts the panel in the world as an entity that takes rays. */
  attach(world: World, parent?: Entity) {
    if (this.entity) return this;
    this.followsParent = !!parent;
    this.entity = world.createTransformEntity(this.mesh, parent ? { parent } : undefined);
    this.entity.addComponent(RayInteractable);
    this.entity.addComponent(Panel, { name: this.mesh.name });
    return this;
  }

  redraw(draw: DrawPanel) {
    this.lastDraw = draw;
    const ctx = this.ctx,
      w = this.widthPx,
      h = this.heightPx,
      u = this.u;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.window) {
      this.regions = draw(ctx, w, h);
    } else {
      const hue = (typeof this.window.hue === 'function' ? this.window.hue() : this.window.hue) ?? THEME.line;
      const title = typeof this.window.title === 'function' ? this.window.title() : this.window.title;
      glassPanel(ctx, 0, 0, w, h, u, { title, hue, titleRoom: w - 14 * u - (this.window.closable ? 44 * u : 14 * u) });
      const regions = draw(ctx, w, h);
      if (this.window.closable) regions.push(closeMark(ctx, 0, 0, w, u, this.hovered === 'close'));
      if (this.window.movable) {
        grabBar(ctx, w / 2, h + 10 * u, u, this.hovered === 'grab' || !!this.moving);
        regions.push({ id: 'grab', x: w / 2 - 70 * u, y: h + 2 * u, w: 140 * u, h: 22 * u });
      }
      this.regions = regions;
    }
    this.texture.needsUpdate = true;
  }

  private redrawLast() {
    if (this.lastDraw && this.mesh.visible) this.redraw(this.lastDraw);
  }

  /** Turns the window smoothly toward a point (the head) and runs its appear fade. Call once a frame. */
  tick(delta: number, head?: Vector3) {
    const material = this.mesh.material as MeshBasicMaterial;
    if (this.shown && this.appear < 1) {
      this.appear = Math.min(1, this.appear + delta / APPEAR_SECONDS);
      material.opacity = this.appear;
    }
    if (head && this.mesh.visible) {
      if (this.followsParent) return;
      const before = this.look.copy(this.mesh.quaternion);
      this.mesh.lookAt(head);
      this.lookTarget.copy(this.mesh.quaternion);
      this.mesh.quaternion.copy(before).slerp(this.lookTarget, Math.min(1, delta * TURN_RATE));
    }
  }

  /** Faces a point at once (for the first placement). */
  face(head: Vector3) {
    this.mesh.lookAt(head);
  }

  set visible(on: boolean) {
    if (!on) {
      this.down = null;
      this.pinchStart = null;
      this.endHold();
      this.owner = null;
      this.endMove();
    }
    if (on && !this.mesh.visible) {
      this.appear = 0;
      (this.mesh.material as MeshBasicMaterial).opacity = 0;
    }
    this.shown = on;
    this.mesh.visible = on;
  }
  get visible() {
    return this.mesh.visible;
  }

  /** The centre of a region in the room, or null if the panel has no such region. For tests. */
  worldOf(id: string): Vector3 | null {
    const r = this.regions.find(x => x.id === id);
    if (!r) return null;
    const px = r.x + r.w / 2,
      py = r.y + r.h / 2;
    this.mesh.updateWorldMatrix(true, false);
    return new Vector3((px / this.widthPx - 0.5) * this.widthM, this.heightM / 2 - (py / this.heightPx) * this.heightM, 0).applyMatrix4(this.mesh.matrixWorld);
  }

  dispose() {
    this.entity?.dispose();
    this.entity = null;
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}

