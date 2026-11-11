// Runs the copied galaxy inside IWSDK: opens a dataset through the bridge, attaches the galaxy's scene to the world,
// steps the scene kit every frame and poses the model in the air from the kit's virtual camera.
import { Quaternion, Vector3, createSystem } from '@iwsdk/core';
import type { Entity, Object3D } from '@iwsdk/core';
import { GalaxyRoot } from '../components/galaxy-root.ts';
import { DEFAULT_SEAT } from '../core/layout.ts';
import { coreOf, fitOverview } from '../core/overview-fit.ts';
import type { ViewBox } from '../core/overview-fit.ts';
import { emptyPose, focusedPoseInto, tablePoseInto } from '../core/table-frame.ts';
import type { TableAnchor, Vec3 } from '../core/table-frame.ts';
import { createLabelLayer } from '../galaxy-bridge/label-layer.ts';
import type { LabelLayer } from '../galaxy-bridge/label-layer.ts';
import { createOverlayLayer } from '../galaxy-bridge/overlay-layer.ts';
import type { OverlayLayer } from '../galaxy-bridge/overlay-layer.ts';
import { bridgePointer } from '../galaxy-bridge/pointer-bridge.ts';
import { createPointScaler } from '../galaxy-bridge/point-sizes.ts';
import { attachCannon, fileIndex, galaxyState, installActions, openGalaxy } from '../galaxy-bridge/galaxy-session.js';
import type { GalaxyView } from '../galaxy-bridge/galaxy-session.js';
import { applyHeadsetBudget } from '../galaxy-bridge/budget.js';
import { outlinePinnedTown } from '../galaxy-bridge/town-outline.ts';
import { preferWindowsForGaze } from '../galaxy-bridge/gaze-priority.ts';
import { flushXrFrames, installXrFrames } from '../galaxy-bridge/xr-frames.ts';
import { createXrHost } from '../galaxy-bridge/xr-host.ts';
import type { XrHost } from '../galaxy-bridge/xr-host.ts';
import {
  codeCardOpen,
  codeRequest,
  codeView,
  error,
  hovered,
  landedPath,
  loading,
  paused,
  phase,
  pinned,
  selectedPath,
  startupMs,
} from '../state/app-state.ts';
import { connectCommands, openDataset } from '../state/commands.ts';
import { headObject } from './head.ts';
import { createRoom } from './room.ts';

// Where the model floats: an invisible point in the air in front of the seat, a little below a seated eye, pitched 20°
// down from level so its far side tilts up toward the user. There is no table under it.
const PITCH = (-20 * Math.PI) / 180;
export const TABLE_ANCHOR: TableAnchor = {
  position: [0, 1.05, -0.95],
  orientation: [Math.sin(PITCH / 2), 0, 0, Math.cos(PITCH / 2)],
  width: 1.0,
  minScale: 0.0005,
  maxScale: 5,
};

// A landed planet stays a globe this wide (the owner's choice), however close the copied code flies.
export const LANDED_GLOBE_DIAMETER = 0.64;
// Where a landed globe's centre floats: a little below a seated eye.
export const LANDED_CENTER: Vec3 = [0, 1.1, -0.95];
const ANCHOR_EASE_SECONDS = 0.6;
/** How often, while landed, to look for newly built road cars to hide. */
const CAR_SWEEP_SECONDS = 0.5;
// The opening view: the galaxy fills the headset's view edge to edge. Its core (CORE_SHARE of its planets and asteroids,
// nearest its centre) fills this box of directions from the seat, with the anchor OPENING_DEPTH metres in front; the
// outermost bodies spill past the edges. A headset sees about ±50° to the side; the glasses (±37°) need a head turn.
const OPENING_BOX: ViewBox = { yaw: [-48, 48], pitch: [-55, 25] };
const CORE_SHARE = 0.8;
const OPENING_DEPTH = 0.8;
/** The project the app opens on. */
export const DEMO_DATASET = 'editor-core';

export class GalaxySystem extends createSystem({}) {
  host!: XrHost;
  private entity: Entity | null = null;
  private loadToken = 0;
  private points: ReturnType<typeof createPointScaler> | null = null;
  private labels!: LabelLayer;
  private overlays!: OverlayLayer;
  private landed = false;
  private unbridge: (() => void) | null = null;
  private head!: Vector3;
  private gaze!: Vector3;
  private headTurn!: Quaternion;
  /** Frames to keep looking for the copied code's pin fill after the selected town changes (it is built a moment later). */
  private outlineFrames = 0;
  private carSweep = 0;
  // Road cars on a 0.64 m globe are 2-5 mm long and cost about 920,000 triangles: hidden from the bridge.
  private readonly hideCar = (o: Object3D) => {
    if (o.visible && o.name.startsWith('road-car:')) o.visible = false;
  };

  init() {
    // Light rigs, a few ship hulls and a lighter island, within the headset's draw budget.
    applyHeadsetBudget();
    this.head = new Vector3();
    this.gaze = new Vector3();
    this.headTurn = new Quaternion();
    installXrFrames(this.renderer);
    preferWindowsForGaze(this.input.xr);
    createRoom(this.world);
    this.labels = createLabelLayer(this.world);
    this.overlays = createOverlayLayer();
    this.host = createXrHost({
      renderer: this.renderer,
      anchor: TABLE_ANCHOR,
      labels: this.labels,
      overlays: this.overlays,
    });
    installActions(this.host, { selected: path => (selectedPath.value = path) });
    let lastRegion: number | null = null;
    this.cleanupFuncs.push(
      codeView.subscribe(view => {
        const region = view?.selectedRegion ?? null;
        if (region === lastRegion) return;
        lastRegion = region;
        this.outlineFrames = 30;
      }),
      connectCommands({
        openDataset: name => void this.open(name),
        selectFile: path => {
          const i = path == null ? -1 : fileIndex(path);
          this.host.actions.selectFile(i < 0 ? null : i);
        },
        landOn: (path, line = null) => {
          const i = fileIndex(path);
          if (i >= 0) this.host.actions.enterPlanet(i, { line });
        },
        leavePlanet: () => this.host.actions.exitPlanet(),
        goHome: () => {
          if (galaxyState.view?.landed) this.host.actions.exitPlanet();
          this.host.actions.selectFile(null, { fly: false });
          this.host.kit?.home();
        },
      }),
    );
    // The app opens on the demo project; ?dataset=<name> opens another (the Settings tab lists them in the next plan).
    openDataset(new URLSearchParams(location.search).get('dataset') || DEMO_DATASET);
  }

  /** Whether a constellation is built and attached. */
  get ready() {
    return this.entity != null;
  }

  async open(name: string) {
    const token = ++this.loadToken;
    phase.value = 'loading';
    error.value = null;
    selectedPath.value = landedPath.value = null;
    pinned.value = hovered.value = codeRequest.value = null;
    codeCardOpen.value = false;
    loading.value = { title: 'Opening project', detail: name };
    this.detach();
    try {
      // The cannon and its island are heavy: they join after the galaxy's first frame (update).
      const view = await openGalaxy(this.host, name, { cannon: false, isCurrent: () => token === this.loadToken });
      if (!view || token !== this.loadToken) return;
      const kit = this.host.kit!;
      this.entity = this.world.createTransformEntity(kit.scene);
      this.entity.addComponent(GalaxyRoot);
      this.unbridge = bridgePointer(this.world, kit.scene, kit);
      this.overlays.attach(kit.scene);
      this.points = createPointScaler(kit.scene);
      this.scene.background = kit.sky;
      this.scene.environment = kit.environment;
      phase.value = 'overview';
      this.fitPending = true;
      this.cannonPending = view;
    } catch (failure) {
      if (token !== this.loadToken) return;
      console.error(failure);
      error.value = `Could not open ${name}: ${(failure as Error).message}`;
      phase.value = 'idle';
    } finally {
      if (token === this.loadToken) loading.value = null;
    }
  }

  private cannonPending: GalaxyView | null = null;
  private cannonNext: GalaxyView | null = null;
  private pausedAt: number | null = null;
  private pausedFor = 0;
  private focus: Vec3 = [0, 0, 0];
  /** The model's pose, rewritten every frame. */
  private pose = emptyPose();
  // The opening view's anchor, fitted to the project's galaxy (fitToRoom); TABLE_ANCHOR until then.
  private base: TableAnchor = { ...TABLE_ANCHOR, position: [...TABLE_ANCHOR.position] as Vec3 };
  // The anchor in use: eased between the opening view's anchor and the landed globe's centre.
  private anchor: TableAnchor = { ...TABLE_ANCHOR, position: [...TABLE_ANCHOR.position] as Vec3 };
  private ease = 0;
  /** Set when a project opens: fit its galaxy on the first frame its bodies are placed. */
  private fitPending = false;

  /**
   * Sizes and moves the opening view's anchor so the galaxy's core, seen from the seat, fills OPENING_BOX
   * (src/core/overview-fit.ts). Once per project: orbit and dolly then work from it as before. Comets are left out.
   */
  private fitToRoom(kit: NonNullable<XrHost['kit']>) {
    const home = kit.overview?.();
    if (!home || !kit.bodyPos || !kit.bodyKind) return;
    const points: Vec3[] = [];
    for (let i = 0; i < galaxyState.nodes.length; i++) {
      const kind = kit.bodyKind(i);
      if (kind !== 'planet' && kind !== 'asteroid') continue;
      const p = kit.bodyPos(i);
      if (p) points.push([p.x, p.y, p.z]);
    }
    const virtual = kit.virtual();
    const camera = {
      position: [home.position.x, home.position.y, home.position.z] as Vec3,
      target: [home.target.x, home.target.y, home.target.z] as Vec3,
      up: [...virtual.up] as Vec3,
      fovDegrees: virtual.fovDegrees,
    };
    const start: TableAnchor = { ...TABLE_ANCHOR, position: [TABLE_ANCHOR.position[0], TABLE_ANCHOR.position[1], -OPENING_DEPTH] };
    const fit = fitOverview(coreOf(points, CORE_SHARE), camera, start, DEFAULT_SEAT.eye, OPENING_BOX, { maxGrow: 8 });
    this.base.width = this.anchor.width = fit.width;
    this.base.position = fit.position;
  }

  private easeAnchor(delta: number) {
    const k = Math.min(1, delta / ANCHOR_EASE_SECONDS);
    this.ease += ((this.landed ? 1 : 0) - this.ease) * k * 4;
    if (Math.abs((this.landed ? 1 : 0) - this.ease) < 1e-3) this.ease = this.landed ? 1 : 0;
    const e = this.ease * this.ease * (3 - 2 * this.ease);
    for (let i = 0; i < 3; i++)
      this.anchor.position[i] = this.base.position[i] + (LANDED_CENTER[i] - this.base.position[i]) * e;
  }

  /** While landed: the whole globe, its centre on the anchor, turned as the virtual camera sees it. */
  private landedPose(kit: NonNullable<XrHost['kit']>) {
    const i = kit.pinned;
    if (i == null || !kit.bodyPos || !kit.bodySize) return tablePoseInto(kit.virtual(), this.anchor, this.pose);
    const centre = kit.bodyPos(i);
    this.focus[0] = centre.x;
    this.focus[1] = centre.y;
    this.focus[2] = centre.z;
    return focusedPoseInto(kit.virtual(), this.anchor, this.focus, LANDED_GLOBE_DIAMETER / (2 * kit.bodySize(i)), this.pose);
  }

  /** Publishes the phase and the landed file when the view lands or leaves. */
  private publishLanding() {
    const view = galaxyState.view;
    const landed = !!view?.landed;
    if (landed === this.landed) return;
    this.landed = landed;
    const i = galaxyState.selected;
    landedPath.value = landed && i != null ? galaxyState.nodes[i].path : null;
    phase.value = landed ? 'landed' : 'overview';
  }

  private detach() {
    this.unbridge?.();
    this.unbridge = null;
    this.overlays.attach(null);
    this.landed = false;
    this.entity?.dispose();
    this.entity = null;
    this.points = null;
    // The old kit's sky and environment are disposed with its view.
    this.scene.background = null;
    this.scene.environment = null;
  }

  update(delta: number, time: number) {
    // Paused (the session hidden or blurred): the galaxy's time stops, and resumes where it left off.
    if (paused.peek()) {
      if (this.pausedAt == null) this.pausedAt = time;
      return;
    }
    if (this.pausedAt != null) {
      this.pausedFor += time - this.pausedAt;
      this.pausedAt = null;
    }
    const now = (time - this.pausedFor) * 1000;
    flushXrFrames(now);
    const kit = this.host.kit;
    if (!kit || !this.entity) return;
    kit.tick(now);
    if (this.fitPending) {
      this.fitPending = false;
      this.fitToRoom(kit);
    }
    // After the first frame with the galaxy: note the start-up time, then bring in the cannon.
    // (on the next frame of this loop: a browser need not run window frames while a session presents).
    if (this.cannonNext) {
      const view = this.cannonNext;
      this.cannonNext = null;
      if (galaxyState.view === view) attachCannon(view, this.host);
    }
    if (this.cannonPending) {
      if (startupMs.peek() == null) startupMs.value = Math.round(performance.now());
      this.cannonNext = this.cannonPending;
      this.cannonPending = null;
    }
    this.publishLanding();
    this.easeAnchor(delta);
    const pose = this.landed ? this.landedPose(kit) : tablePoseInto(kit.virtual(), this.anchor, this.pose);
    const group = kit.scene;
    group.position.set(pose.position[0], pose.position[1], pose.position[2]);
    group.quaternion.set(pose.orientation[0], pose.orientation[1], pose.orientation[2], pose.orientation[3]);
    group.scale.setScalar(pose.scale);
    this.points?.update(pose.scale, delta);
    const head = headObject(this.renderer, this.player, this.camera);
    head.getWorldPosition(this.head);
    this.gaze.set(0, 0, -1).applyQuaternion(head.getWorldQuaternion(this.headTurn));
    this.labels.update(this.head, this.gaze, pose);
    if (this.outlineFrames > 0) {
      this.outlineFrames--;
      if (outlinePinnedTown(group) > 0) this.outlineFrames = 0;
    }
    if (this.landed) {
      this.carSweep += delta;
      if (this.carSweep >= CAR_SWEEP_SECONDS) {
        this.carSweep = 0;
        group.traverse(this.hideCar);
      }
    }
  }
}
