// The scene kit the copied scene code runs in (`T`, returned by galaxy/viewer/scene/scene3d.js). Every member listed in
// the plan's "What the scene code expects". The constellation adds its own members to T afterwards (land, leave,
// update, overview, landed, ...); those are not part of this contract. Three.js objects are typed structurally so this
// file stays free of packages.
import type { ContextItem, Vector3Like } from './host.ts';

export interface Object3DLike {
  add(...objects: unknown[]): unknown;
  remove(...objects: unknown[]): unknown;
  [member: string]: unknown;
}
export interface CameraLike {
  position: Vector3Like & { set(x: number, y: number, z: number): unknown; copy(v: Vector3Like): unknown };
  up: Vector3Like;
  fov: number;
  aspect: number;
  near: number;
  far: number;
  updateMatrixWorld(force?: boolean): void;
  updateProjectionMatrix(): void;
  [member: string]: unknown;
}
export interface ControlsLike {
  target: Vector3Like & { copy(v: Vector3Like): unknown };
  update(delta?: number): boolean | void;
  [member: string]: unknown;
}

/** A frame callback: called with the scene time in seconds. */
export type FrameCallback = (t: number) => void;
/** A moving local frame (a body's origin and scale). */
export type FrameOf = () => { origin: Vector3Like; scale: number };

export interface LabelDefinition {
  text: string;
  pos: Vector3Like | (() => Vector3Like);
  col?: string;
  cls?: string;
  visible?: () => boolean;
  avoidOverlap?: boolean;
  priority?: number;
  group?: string;
  maxVisible?: number;
  centered?: boolean;
  /** The radius (model units) of the body this label names: the label sits just above it instead of on it. */
  clear?: number;
  /** A multiple of the usual label height: a label that matters more is written larger. */
  scale?: number;
  onClick?: () => void;
  action?: { label: () => string; title?: string; onClick: () => void };
}

/** Another clickable thing: objects to test and what each hit describes. */
export interface Picker {
  objects(): unknown[];
  describe(hit: unknown): ContextItem | null;
}

/** A landed planet's scene in its own frame. */
export interface Overlay {
  scene: Object3DLike;
  camera: CameraLike;
  frame(): { origin: Vector3Like; scale: number };
  sync(): void;
  opacity: number;
  sharedDepth?: boolean;
  nearWorld?(): number;
  [member: string]: unknown;
}

export interface FlyOptions {
  cam?: Vector3Like | null;
  arc?: boolean;
  frame?: FrameOf | null;
  duration?: number;
}

export interface SceneKitPort {
  scene: Object3DLike;
  camera: CameraLike;
  controls: ControlsLike;
  onFrame: FrameCallback[];
  beforeCamera: FrameCallback[];
  afterCamera: FrameCallback[];
  flyTo(p: Vector3Like, dist: number, options?: FlyOptions): void;
  readonly navigationRevision: number;
  addLabels(list: LabelDefinition[], xf?: (v: Vector3Like) => void, gate?: () => boolean): () => void;
  setLabels(list: LabelDefinition[]): void;
  addPicker(picker: Picker): () => void;
  setPick(
    mesh: unknown,
    map: (hit: unknown) => number | null,
    posOf: (i: number) => Vector3Like,
    options?: { highlight?: (i: number | null, posOf: (i: number) => Vector3Like) => void; follow?: boolean; flyDist?: number },
  ): void;
  setFollowing(on: boolean): void;
  readonly following: boolean;
  readonly flying: boolean;
  interruptNavigation(source?: string): void;
  setPickBlock(block: ((ray: unknown) => boolean) | null): void;
  setMarkerHidden(on: boolean): void;
  select(i: number | null, options?: { fly?: boolean }): void;
  prepareTexture(texture: unknown): Promise<void>;
  prepareDraw(object: unknown, camera: unknown, target: unknown, checkpoint: (heavy?: boolean) => Promise<unknown>): Promise<void>;
  clearControlMotion(): void;
  cancelFlight(): void;
  addOverlay(overlay: Overlay): () => void;
  isSelectionClick(event: unknown): boolean;
  navigation: unknown;
  anchorOf(i: number): { x: number; y: number } | null;
  readonly pinned: number | null;
  highlight(i: number | null, posOf: (i: number) => Vector3Like): void;
  bodyFrame(i: number): FrameOf;
  runFrameCallbacks(callbacks: FrameCallback[], t: number, scope?: string): void;
  frameErrors: unknown;
  resize(): void;
  setTint(tint: ((i: number | null) => void) | null): void;
  stop(): void;
}
