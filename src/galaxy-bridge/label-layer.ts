// Scene labels as sprites facing the viewer. The copied code defines labels (text, a model-space position, a colour,
// optional click); src/core/labels.ts decides which show and how big; this layer keeps a pool of sprites in the room
// and draws each one's text on its own small canvas, redrawing only when the text changes. Labels are micro labels
// (docs/visual-style.md): small capitals in `line` on an `ink` backing; the copied code's per-label colours are not
// used, so warm colours stay reserved for faults and attention.
import {
  CanvasTexture,
  Group,
  Quaternion,
  RayInteractable,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from '@iwsdk/core';
import type { Entity, Intersection, Raycaster, World } from '@iwsdk/core';
import { chooseLabelsInto, createLabelWork, DEFAULT_LABEL_LIMITS } from '../core/labels.ts';
import { THEME } from '../core/theme.ts';
import { loadFonts } from '../panels/fonts.ts';
import { microLabel, microLabelWidth } from '../panels/paint.ts';
import type { LabelCandidate } from '../core/labels.ts';
import type { Pose, Vec3 } from '../core/table-frame.ts';
import type { Vector3Like } from '../ports/host.ts';
import type { LabelDefinition } from '../ports/scene-kit.ts';

/** Labels shown at once (lowered from 32 for the headset's draw budget: each is a draw call). */
const POOL = 24;
const CANVAS_W = 512,
  CANVAS_H = 96,
  PAD = 18,
  LABEL_PX = 46;

interface Label {
  definition: LabelDefinition;
  xf?: (v: Vector3Like) => void;
  gate?: () => boolean;
}

interface Slot {
  sprite: Sprite;
  entity: Entity;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  text: string;
  color: string;
  label: Label | null;
  clickable: boolean;
  textWidth: number;
}

export function createLabelLayer(world: World) {
  const root = new Group();
  root.name = 'scene-labels';
  const rootEntity = world.createTransformEntity(root);
  let fixedLabels: Label[] = [];
  const extraLabels: Label[] = [];

  const v = new Vector3(),
    q = new Quaternion(),
    position = new Vector3();
  // A sprite's own raycast needs a camera. A label is hit where its text is drawn: the ray meets the plane through the
  // sprite facing the head, inside the text's rectangle (sprite.center places that rectangle), widened to at least
  // MIN_TARGET radians so a small label is still a fair target for a hand ray.
  const MIN_TARGET = 0.012;
  const normal = new Vector3(),
    right = new Vector3(),
    up = new Vector3(),
    worldUp = new Vector3(0, 1, 0),
    toPoint = new Vector3();
  const slotRaycast = (slot: Slot) =>
    function (this: Sprite, raycaster: Raycaster, intersects: Intersection[]) {
      if (!slot.label || !this.visible) return;
      this.getWorldPosition(v);
      normal.copy(head).sub(v);
      const toHead = normal.length();
      if (toHead < 1e-6) return;
      normal.divideScalar(toHead);
      const facing = raycaster.ray.direction.dot(normal);
      if (facing > -1e-6) return;
      const t = toPoint.copy(v).sub(raycaster.ray.origin).dot(normal) / facing;
      if (t < raycaster.near || t > raycaster.far) return;
      right.crossVectors(worldUp, normal).normalize();
      up.crossVectors(normal, right);
      toPoint.copy(raycaster.ray.direction).multiplyScalar(t).add(raycaster.ray.origin).sub(v);
      const x = toPoint.dot(right),
        y = toPoint.dot(up);
      const height = this.scale.y,
        halfText = ((slot.textWidth / CANVAS_W) * this.scale.x) / 2,
        margin = Math.max(0, (MIN_TARGET * t - height) / 2);
      const bottom = -this.center.y * height - margin,
        top = (1 - this.center.y) * height + margin;
      if (Math.abs(x) > halfText + margin || y < bottom || y > top) return;
      intersects.push({ distance: t, point: toPoint.add(v).clone(), object: this } as Intersection);
    };

  const slots: Slot[] = [];
  for (let k = 0; k < POOL; k++) {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.renderOrder = 20;
    sprite.visible = false;
    const entity = world.createTransformEntity(sprite, { parent: rootEntity });
    const slot: Slot = { sprite, entity, canvas, texture, text: '', color: '', label: null, clickable: false, textWidth: 0 };
    sprite.raycast = slotRaycast(slot);
    sprite.addEventListener('click', () => {
      const d = slot.label?.definition;
      if (d?.onClick) d.onClick();
      else d?.action?.onClick();
    });
    slots.push(slot);
  }

  function draw(slot: Slot, text: string, color: string) {
    const ctx = slot.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    let shown = text;
    const room = CANVAS_W - PAD * 2;
    if (microLabelWidth(ctx, shown, LABEL_PX) > room) {
      while (shown.length > 1 && microLabelWidth(ctx, shown + '…', LABEL_PX) > room) shown = shown.slice(0, -1);
      shown += '…';
    }
    const width = Math.min(room, microLabelWidth(ctx, shown, LABEL_PX));
    ctx.globalAlpha = THEME.inkAlpha;
    ctx.fillStyle = THEME.ink;
    ctx.fillRect(0, 14, PAD * 2 + width, CANVAS_H - 28);
    ctx.globalAlpha = 1;
    microLabel(ctx, shown, PAD, CANVAS_H / 2 + LABEL_PX * 0.36, LABEL_PX, THEME.line);
    slot.text = text;
    slot.color = color;
    slot.textWidth = PAD * 2 + width;
    slot.texture.needsUpdate = true;
  }
  // Labels drawn before the fonts arrived are drawn again once they have.
  void loadFonts().then(() => {
    for (const slot of slots) if (slot.text) draw(slot, slot.text, slot.color);
  });

  // Per-frame scratch, reused.
  const candidates: LabelCandidate[] = [];
  const work = createLabelWork();
  const live: Label[] = [];
  const worldPos: Vec3[] = [];
  const head = new Vector3(),
    gaze: Vec3 = [0, 0, -1];

  const positionOf = (label: Label, pose: Pose, out: Vector3) => {
    const pos = label.definition.pos;
    const p = typeof pos === 'function' ? pos() : pos;
    out.set(p.x, p.y, p.z);
    if (label.xf) label.xf(out);
    q.set(pose.orientation[0], pose.orientation[1], pose.orientation[2], pose.orientation[3]);
    return out
      .applyQuaternion(q)
      .multiplyScalar(pose.scale)
      .add(position.set(pose.position[0], pose.position[1], pose.position[2]));
  };

  // Adds one label to the frame's candidates if it is visible; returns the new count.
  function collect(label: Label, pose: Pose, n: number) {
    const d = label.definition;
    if ((label.gate && !label.gate()) || (d.visible && !d.visible())) return n;
    positionOf(label, pose, v);
    const wp = (worldPos[n] ||= [0, 0, 0]);
    wp[0] = v.x;
    wp[1] = v.y;
    wp[2] = v.z;
    v.sub(head);
    const distance = Math.max(1e-6, v.length());
    v.divideScalar(distance);
    const c = (candidates[n] ||= { direction: [0, 0, -1], distance: 1, priority: 0, avoidOverlap: true });
    c.direction[0] = v.x;
    c.direction[1] = v.y;
    c.direction[2] = v.z;
    c.distance = distance;
    c.priority = d.priority || 0;
    c.avoidOverlap = !!d.avoidOverlap;
    c.group = d.group;
    c.maxVisible = d.maxVisible;
    live[n] = label;
    return n + 1;
  }

  return {
    root,
    setLabels(list: LabelDefinition[]) {
      fixedLabels = list.map(definition => ({ definition }));
    },
    addLabels(list: LabelDefinition[], xf?: (v: Vector3Like) => void, gate?: () => boolean) {
      const made = list.map(definition => ({ definition, xf, gate }));
      extraLabels.push(...made);
      return () => {
        for (const label of made) {
          const i = extraLabels.indexOf(label);
          if (i >= 0) extraLabels.splice(i, 1);
        }
      };
    },
    /** Once per frame: choose, place and size the labels. */
    update(headPosition: Vector3, gazeDirection: Vector3, pose: Pose) {
      head.copy(headPosition);
      gaze[0] = gazeDirection.x;
      gaze[1] = gazeDirection.y;
      gaze[2] = gazeDirection.z;
      let n = 0;
      for (const label of fixedLabels) n = collect(label, pose, n);
      for (const label of extraLabels) n = collect(label, pose, n);
      live.length = n;
      const count = chooseLabelsInto(candidates, n, gaze, DEFAULT_LABEL_LIMITS, work);
      for (let k = 0; k < POOL; k++) {
        const slot = slots[k],
          pick = k < count ? work.chosen[k] : null;
        if (!pick) {
          slot.sprite.visible = false;
          slot.label = null;
          if (slot.clickable) {
            slot.entity.removeComponent(RayInteractable);
            slot.clickable = false;
          }
          continue;
        }
        const label = live[pick.index],
          d = label.definition;
        slot.label = label;
        const text = d.action ? `${d.text} ${d.action.label()}` : d.text;
        if (text !== slot.text || (d.col || '') !== slot.color) draw(slot, text, d.col || '');
        const wp = worldPos[pick.index];
        slot.sprite.position.set(wp[0], wp[1], wp[2]);
        slot.sprite.scale.set((pick.height * CANVAS_W) / CANVAS_H, pick.height, 1);
        // Centred on its point horizontally; above it unless the definition asks to be centred vertically.
        slot.sprite.center.set(slot.textWidth / 2 / CANVAS_W, d.centered ? 0.5 : 0);
        slot.sprite.visible = true;
        const clickable = !!(d.onClick || d.action);
        if (clickable !== slot.clickable) {
          if (clickable) slot.entity.addComponent(RayInteractable);
          else slot.entity.removeComponent(RayInteractable);
          slot.clickable = clickable;
        }
      }
    },
  };
}

export type LabelLayer = ReturnType<typeof createLabelLayer>;
