// The dock at the table's edge and the palm menu: the same four buttons (Home, Code, Agent, Help). The palm menu shows
// 8 cm off the left palm while the palm faces the head (within 40°, held 0.3 s), and is pressed with the right hand's
// ray. state.palmMenu switches it off.
import { Quaternion, Vector3, createSystem } from '@iwsdk/core';
import { iconPaths } from '../galaxy-bridge/icons.ts';
import { CanvasPanel } from '../panels/canvas-panel.ts';
import { DOCK, DOCK_BUTTONS, PALM_MENU, drawDock } from '../panels/draw-dock.ts';
import type { DockButton } from '../panels/draw-dock.ts';
import { agentOpen, codePageOpen, palmMenu } from '../state/app-state.ts';
import { goHome, showHelp, toggleAgent, toggleCode } from '../state/commands.ts';
import { headPosition } from './head.ts';
import { PLACEMENTS, place } from './panel-system.ts';

const PALM_COS = Math.cos((40 * Math.PI) / 180),
  PALM_HOLD = 0.3,
  PALM_LIFT = 0.08;
/** The palm's outward normal in the left grip space (confirmed in the emulator: see Task 16 notes). */
export const LEFT_PALM_AXIS = new Vector3(1, 0, 0);

export class DockSystem extends createSystem({}) {
  private dock!: CanvasPanel;
  private palm!: CanvasPanel;
  private icons: Record<string, string[]> = {};
  private held = 0;
  private head!: Vector3;
  private grip!: Vector3;
  private normal!: Vector3;
  private toHead!: Vector3;
  private turn!: Quaternion;

  init() {
    this.head = new Vector3();
    this.grip = new Vector3();
    this.normal = new Vector3();
    this.toHead = new Vector3();
    this.turn = new Quaternion();
    for (const b of DOCK_BUTTONS) this.icons[b.icon] = iconPaths(b.icon);
    const press = (id: string) => {
      const button = id as DockButton;
      if (button === 'home') goHome();
      else if (button === 'code') toggleCode();
      else if (button === 'agent') toggleAgent();
      else if (button === 'help') showHelp();
    };
    this.dock = new CanvasPanel({ name: 'dock', ...DOCK, renderer: this.renderer }).attach(this.world);
    place(this.dock, PLACEMENTS.dock);
    this.palm = new CanvasPanel({ name: 'palm-menu', ...PALM_MENU, renderer: this.renderer }).attach(this.world);
    this.palm.visible = false;
    for (const panel of [this.dock, this.palm]) {
      panel.onPress = press;
      panel.onHover = () => this.draw();
    }
    this.cleanupFuncs.push(
      codePageOpen.subscribe(() => this.draw()),
      agentOpen.subscribe(() => this.draw()),
      () => {
        this.dock.dispose();
        this.palm.dispose();
      },
    );
  }

  private draw() {
    const on = { code: codePageOpen.peek(), agent: agentOpen.peek() };
    this.dock.redraw((ctx, w, h) => drawDock(ctx, w, h, { hovered: this.dock.hovered, on, icons: this.icons }));
    this.palm.redraw((ctx, w, h) => drawDock(ctx, w, h, { hovered: this.palm.hovered, on, icons: this.icons }));
  }

  update(delta: number) {
    const facing = palmMenu.peek() && this.renderer.xr.isPresenting && this.palmFacesHead();
    this.held = facing ? this.held + delta : 0;
    const show = this.held >= PALM_HOLD;
    this.palm.visible = show;
    if (show) {
      this.palm.mesh.position.copy(this.grip).addScaledVector(this.normal, PALM_LIFT);
      this.palm.mesh.lookAt(this.head);
    }
  }

  /** Whether the left palm's normal is within 40° of the direction to the head (fills grip, normal and head). */
  private palmFacesHead() {
    const grip = this.player.gripSpaces.left;
    if (!grip) return false;
    grip.getWorldPosition(this.grip);
    this.normal.copy(LEFT_PALM_AXIS).applyQuaternion(grip.getWorldQuaternion(this.turn));
    headPosition(this.renderer, this.player, this.camera, this.head);
    this.toHead.copy(this.head).sub(this.grip).normalize();
    return this.normal.dot(this.toHead) >= PALM_COS;
  }
}
