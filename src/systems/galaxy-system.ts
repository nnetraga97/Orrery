// Runs the copied galaxy inside IWSDK: opens a dataset through the bridge, attaches the galaxy's scene to the world,
// steps the scene kit every frame and poses the model on the table from the kit's virtual camera.
import { createSystem } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { GalaxyRoot } from '../components/galaxy-root.ts';
import { tablePose } from '../core/table-frame.ts';
import type { TableAnchor } from '../core/table-frame.ts';
import { createPointScaler } from '../galaxy-bridge/point-sizes.ts';
import { fileIndex, galaxyState, installActions, openGalaxy } from '../galaxy-bridge/galaxy-session.js';
import { createXrHost } from '../galaxy-bridge/xr-host.ts';
import type { XrHost } from '../galaxy-bridge/xr-host.ts';
import { error, landedPath, loading, phase, selectedPath } from '../state/app-state.ts';
import { connectCommands, openDataset } from '../state/commands.ts';

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

export class GalaxySystem extends createSystem({ roots: { required: [GalaxyRoot] } }) {
  host!: XrHost;
  private entity: Entity | null = null;
  private loadToken = 0;
  private points: ReturnType<typeof createPointScaler> | null = null;

  init() {
    this.host = createXrHost({ renderer: this.renderer, anchor: TABLE_ANCHOR });
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
    openDataset(new URLSearchParams(location.search).get('dataset') || 'editor-core');
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

  private detach() {
    this.entity?.dispose();
    this.entity = null;
    this.points = null;
  }

  update(delta: number, time: number) {
    const kit = this.host.kit;
    if (!kit || !this.entity) return;
    kit.tick(time * 1000);
    const pose = tablePose(kit.virtual(), TABLE_ANCHOR);
    const group = kit.scene;
    group.position.set(pose.position[0], pose.position[1], pose.position[2]);
    group.quaternion.set(pose.orientation[0], pose.orientation[1], pose.orientation[2], pose.orientation[3]);
    group.scale.setScalar(pose.scale);
    this.points?.update(pose.scale, delta);
  }
}
