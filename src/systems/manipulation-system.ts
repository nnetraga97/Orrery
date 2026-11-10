// Hands turn and zoom the model by moving the virtual camera (src/core/orbit.ts); the model's pose follows from it.
// One pinch dragged in the air over empty space orbits; two pinches moving apart or together dolly. A pinch that moves
// less than 2 cm in all is a click, which the pointer bridge already handles. In a browser tab the mouse does the
// same: drag on empty space orbits, the wheel dollies.
import { Hovered, Vector3, createSystem } from '@iwsdk/core';
import { Panel } from '../components/panel.ts';
import { dollyFromSpread, orbitFromDrag } from '../core/orbit.ts';
import { GalaxySystem } from './galaxy-system.ts';

const CLICK_METRES = 0.02;
const SENSITIVITY = 1;
// Mouse: pixels of drag per metre of hand travel, and wheel pixels per e-fold of zoom.
const PX_PER_METRE = 2000,
  WHEEL_PX = 600,
  CLICK_PX = 4;

type Side = 'left' | 'right';
const SIDES: readonly Side[] = ['left', 'right'];

interface HandDrag {
  active: boolean;
  /** The pinch began over something pickable: it is a click, never an orbit. */
  onTarget: boolean;
  orbiting: boolean;
  travel: number;
  last: Vector3;
}

export class ManipulationSystem extends createSystem({ hoveredPanels: { required: [Panel, Hovered] } }) {
  private hands!: Record<Side, HandDrag>;
  private position!: Vector3;
  private other!: Vector3;
  private spread = 0;
  private dollying = false;

  init() {
    const hand = (): HandDrag => ({ active: false, onTarget: false, orbiting: false, travel: 0, last: new Vector3() });
    this.hands = { left: hand(), right: hand() };
    this.position = new Vector3();
    this.other = new Vector3();
    this.bindMouse();
  }

  private get kit() {
    return this.world.getSystem(GalaxySystem)?.host.kit ?? null;
  }

  /** The ray is over a panel or something the scene picks: the pinch belongs to it, not to the model. */
  private overTarget() {
    return !!this.kit?.pointing || this.queries.hoveredPanels.entities.size > 0;
  }

  private handPosition(side: Side, out: Vector3) {
    return this.player.gripSpaces[side].getWorldPosition(out);
  }

  update() {
    const kit = this.kit;
    const pads = this.input.xr.gamepads;
    if (!kit) return;
    const left = pads.left,
      right = pads.right;
    const leftOn = !!left?.getSelecting(),
      rightOn = !!right?.getSelecting();
    for (const side of SIDES) {
      const pad = side === 'left' ? left : right;
      const drag = this.hands[side];
      if (pad?.getSelectStart()) {
        drag.active = true;
        drag.onTarget = this.overTarget();
        drag.orbiting = false;
        drag.travel = 0;
        kit.swallowClick(false);
        this.handPosition(side, drag.last);
      } else if (drag.active && !(side === 'left' ? leftOn : rightOn)) drag.active = false;
    }
    if (leftOn && rightOn && this.hands.left.active && this.hands.right.active) {
      this.handPosition('left', this.position);
      this.handPosition('right', this.other);
      const spread = Math.max(1e-3, this.position.distanceTo(this.other));
      if (!this.dollying) {
        this.dollying = true;
        this.spread = spread;
        // Neither pinch is a click now.
        kit.swallowClick(true);
        this.hands.left.orbiting = this.hands.right.orbiting = false;
      } else {
        // Applied frame by frame, the factors multiply to dollyFromSpread(spread at the second pinch, spread now).
        kit.dolly(dollyFromSpread(spread, this.spread));
        this.spread = spread;
      }
      this.handPosition('left', this.hands.left.last);
      this.handPosition('right', this.hands.right.last);
      return;
    }
    this.dollying = false;
    for (const side of SIDES) {
      const drag = this.hands[side];
      if (!drag.active || drag.onTarget) continue;
      this.handPosition(side, this.position);
      const dx = this.position.x - drag.last.x,
        dy = this.position.y - drag.last.y;
      drag.travel += Math.hypot(dx, dy, this.position.z - drag.last.z);
      drag.last.copy(this.position);
      if (!drag.orbiting && drag.travel < CLICK_METRES) continue;
      if (!drag.orbiting) {
        drag.orbiting = true;
        kit.swallowClick(true);
      }
      const { dAzimuth, dPolar } = orbitFromDrag(dx, dy, SENSITIVITY);
      kit.orbit(dAzimuth, dPolar);
    }
  }

  // In a browser tab: drag on empty space orbits, the wheel dollies.
  private bindMouse() {
    const canvas = this.renderer.domElement;
    let down = false,
      onTarget = false,
      moved = 0,
      lastX = 0,
      lastY = 0;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || this.renderer.xr.isPresenting) return;
      down = true;
      onTarget = this.overTarget();
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      this.kit?.swallowClick(false);
    };
    const onMove = (e: PointerEvent) => {
      if (!down || onTarget) return;
      const dx = e.clientX - lastX,
        dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.hypot(dx, dy);
      if (moved < CLICK_PX) return;
      const kit = this.kit;
      if (!kit) return;
      kit.swallowClick(true);
      const { dAzimuth, dPolar } = orbitFromDrag(dx / PX_PER_METRE, -dy / PX_PER_METRE, SENSITIVITY);
      kit.orbit(dAzimuth, dPolar);
    };
    const onUp = () => {
      down = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (this.renderer.xr.isPresenting) return;
      e.preventDefault();
      this.kit?.dolly(Math.exp(e.deltaY / WHEEL_PX));
    };
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    this.cleanupFuncs.push(() => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    });
  }
}
