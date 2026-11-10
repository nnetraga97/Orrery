// Runs the copied galaxy inside IWSDK: opens a dataset through the bridge, attaches the galaxy's scene to the world,
// steps the scene kit every frame and poses the model on the table from the kit's virtual camera.
import { Quaternion, Vector3, createSystem } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { GalaxyRoot } from '../components/galaxy-root.ts';
import { focusedPose, tablePose } from '../core/table-frame.ts';
import type { TableAnchor, Vec3 } from '../core/table-frame.ts';
import { createLabelLayer } from '../galaxy-bridge/label-layer.ts';
import type { LabelLayer } from '../galaxy-bridge/label-layer.ts';
import { createOverlayLayer } from '../galaxy-bridge/overlay-layer.ts';
import type { OverlayLayer } from '../galaxy-bridge/overlay-layer.ts';
import { bridgePointer } from '../galaxy-bridge/pointer-bridge.ts';
import { createPointScaler } from '../galaxy-bridge/point-sizes.ts';
import { fileIndex, galaxyState, installActions, openGalaxy } from '../galaxy-bridge/galaxy-session.js';
import { createXrHost } from '../galaxy-bridge/xr-host.ts';
import type { XrHost } from '../galaxy-bridge/xr-host.ts';
import { error, landedPath, loading, phase, selectedPath } from '../state/app-state.ts';
import { connectCommands, openDataset } from '../state/commands.ts';
import { headObject } from './head.ts';
import { createRoom } from './room.ts';

// Where the model sits: above the table in front of the seat, pitched 30° down from level so its far edge tilts up
// toward the user.
const PITCH = (-30 * Math.PI) / 180;
export const TABLE_ANCHOR: TableAnchor = {
  position: [0, 0.85, -0.55],
  orientation: [Math.sin(PITCH / 2), 0, 0, Math.cos(PITCH / 2)],
  width: 0.8,
  minScale: 0.0005,
  maxScale: 4,
};

// A landed planet stays a globe this wide on the table (the owner's choice), however close the copied code flies.
export const LANDED_GLOBE_DIAMETER = 0.64;
// Where a landed globe's centre sits: resting on the table top (0.83 m), a little further back than the overview so
// its top stays inside the narrower glasses view for a seated user.
export const LANDED_CENTER: Vec3 = [0, 0.83 + LANDED_GLOBE_DIAMETER / 2 + 0.01, -0.75];
const ANCHOR_EASE_SECONDS = 0.6;

export class GalaxySystem extends createSystem({ roots: { required: [GalaxyRoot] } }) {
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

  init() {
    this.head = new Vector3();
    this.gaze = new Vector3();
    this.headTurn = new Quaternion();
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
    this.cleanupFuncs.push(
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
    // ?dataset=<name> opens a project at once; without it the project picker (PickerSystem) offers the choice.
    const requested = new URLSearchParams(location.search).get('dataset');
    if (requested) openDataset(requested);
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
    loading.value = { title: 'Opening project', detail: name };
    this.detach();
    try {
      await openGalaxy(this.host, name);
      if (token !== this.loadToken) return;
      const kit = this.host.kit!;
      this.entity = this.world.createTransformEntity(kit.scene);
      this.entity.addComponent(GalaxyRoot);
      this.unbridge = bridgePointer(this.world, kit.scene, kit);
      this.overlays.attach(kit.scene);
      this.points = createPointScaler(kit.scene);
      this.scene.background = kit.sky;
      this.scene.environment = kit.environment;
      phase.value = 'overview';
    } catch (failure) {
      if (token !== this.loadToken) return;
      console.error(failure);
      error.value = `Could not open ${name}: ${(failure as Error).message}`;
      phase.value = 'idle';
    } finally {
      if (token === this.loadToken) loading.value = null;
    }
  }

  private focus: Vec3 = [0, 0, 0];
  // The anchor in use: eased between the table anchor (overview) and the landed globe's centre.
  private anchor: TableAnchor = { ...TABLE_ANCHOR, position: [...TABLE_ANCHOR.position] as Vec3 };
  private ease = 0;

  private easeAnchor(delta: number) {
    const k = Math.min(1, delta / ANCHOR_EASE_SECONDS);
    this.ease += ((this.landed ? 1 : 0) - this.ease) * k * 4;
    if (Math.abs((this.landed ? 1 : 0) - this.ease) < 1e-3) this.ease = this.landed ? 1 : 0;
    const e = this.ease * this.ease * (3 - 2 * this.ease);
    for (let i = 0; i < 3; i++)
      this.anchor.position[i] = TABLE_ANCHOR.position[i] + (LANDED_CENTER[i] - TABLE_ANCHOR.position[i]) * e;
  }

  /** While landed: the whole globe on the table, its centre on the anchor, turned as the virtual camera sees it. */
  private landedPose(kit: NonNullable<XrHost['kit']>) {
    const i = kit.pinned;
    if (i == null || !kit.bodyPos || !kit.bodySize) return tablePose(kit.virtual(), this.anchor);
    const centre = kit.bodyPos(i);
    this.focus[0] = centre.x;
    this.focus[1] = centre.y;
    this.focus[2] = centre.z;
    return focusedPose(kit.virtual(), this.anchor, this.focus, LANDED_GLOBE_DIAMETER / (2 * kit.bodySize(i)));
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
  }

  update(delta: number, time: number) {
    const kit = this.host.kit;
    if (!kit || !this.entity) return;
    kit.tick(time * 1000);
    this.publishLanding();
    this.easeAnchor(delta);
    const pose = this.landed ? this.landedPose(kit) : tablePose(kit.virtual(), this.anchor);
    const group = kit.scene;
    group.position.set(pose.position[0], pose.position[1], pose.position[2]);
    group.quaternion.set(pose.orientation[0], pose.orientation[1], pose.orientation[2], pose.orientation[3]);
    group.scale.setScalar(pose.scale);
    this.points?.update(pose.scale, delta);
    const head = headObject(this.renderer, this.player, this.camera);
    head.getWorldPosition(this.head);
    this.gaze.set(0, 0, -1).applyQuaternion(head.getWorldQuaternion(this.headTurn));
    this.labels.update(this.head, this.gaze, pose);
  }
}
