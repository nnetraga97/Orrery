// Pointer events on the galaxy (a hand ray in a headset, the mouse in a browser tab) -> the copied picking code. The
// event's ray is carried into the model's own space and handed to the scene kit, whose existing logic then calls
// host.actions.showHover and host.actions.selectFile. One Ray and one Matrix4, reused: nothing is allocated per event.
//
// IWSDK's ray does not test the copied objects themselves: they include sprites, whose raycast needs a camera the
// pointer library does not supply (it throws and aborts every event), and building IWSDK's per-mesh search trees over
// the whole galaxy is costly. Instead an invisible hit volume around the floating model takes the events, and the kit
// does the actual picking with the ray, as on the desktop.
import { BoxGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Ray, RayInteractable } from '@iwsdk/core';
import type { Object3D, World } from '@iwsdk/core';
import type { XrSceneKit } from './scene-kit.js';

/**
 * The hit volume: the space in front of the seat the model can occupy (room metres, axis-aligned), with a margin. The
 * overview frames the model off-centre (measured at the floating anchor: x -0.38..0.75, y 1.02..1.38,
 * z -1.63..-0.88), and a landed globe floats around [0, 1.10, -0.95] (x ±0.32, y 0.78..1.42, z -1.27..-0.63).
 * Double-sided, so a ray from a hand already inside it still hits.
 */
/** The hit volume's object name (gaze-priority.ts tells it apart from windows). */
export const HIT_VOLUME_NAME = 'galaxy-hit-volume';
export const HIT_VOLUME = { center: [0.15, 1.1, -1.15] as const, size: [1.5, 0.8, 1.2] as const };

interface RayEvent {
  ray: Ray;
  pointerId: number;
}

export function bridgePointer(world: World, group: Object3D, kit: XrSceneKit): () => void {
  const ray = new Ray(),
    inverse = new Matrix4();
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.visible = false;
  const volume = new Mesh(new BoxGeometry(...HIT_VOLUME.size), material);
  volume.name = HIT_VOLUME_NAME;
  volume.position.set(...HIT_VOLUME.center);
  // Windows (the chat, cards, the code card) may sit inside this volume; any window on the ray wins over the galaxy.
  (volume as unknown as { pointerEventsOrder: number }).pointerEventsOrder = -1;
  const entity = world.createTransformEntity(volume);
  entity.addComponent(RayInteractable);

  const toModel = (worldRay: Ray) => {
    inverse.copy(group.matrixWorld).invert();
    return ray.copy(worldRay).applyMatrix4(inverse);
  };
  // Each pointer (a hand, the gaze, the mouse) is passed with its id: the kit keeps one ray per pointer.
  //
  // A click picks along the ray the pointer was aiming with just before the pinch began, not the click event's own
  // ray. With gaze, IWSDK moves the gaze pointer onto the pinching hand for the length of the pinch (so a drag follows
  // the hand), and the press, release and click events carry that hand ray, which no longer points at what the eyes
  // chose. For a hand ray the two are the same, give or take the pinch's own jitter. While a pinch is held, the
  // pointer's moves do not change the hover either.
  const aimed = new Map<number, Ray>(),
    pressed = new Set<number>();
  const move = (event: unknown) => {
    const e = event as RayEvent;
    if (pressed.has(e.pointerId)) return;
    let r = aimed.get(e.pointerId);
    if (!r) aimed.set(e.pointerId, (r = new Ray()));
    r.copy(e.ray);
    kit.pointerMove(toModel(e.ray), e.pointerId);
  };
  const down = (event: unknown) => pressed.add((event as RayEvent).pointerId);
  const up = (event: unknown) => pressed.delete((event as RayEvent).pointerId);
  const leave = (event: unknown) => {
    const id = (event as RayEvent).pointerId;
    pressed.delete(id);
    aimed.delete(id);
    kit.pointerLeave(id);
  };
  const click = (event: unknown) => {
    const e = event as RayEvent;
    pressed.delete(e.pointerId);
    kit.pointerClick(toModel(aimed.get(e.pointerId) ?? e.ray), e.pointerId);
  };
  // The pointer-event types are not part of three's Object3D event map, hence the loose listener type.
  const target = volume as unknown as {
    addEventListener(type: string, listener: (event: unknown) => void): void;
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerdown', down);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
  target.addEventListener('pointerleave', leave);
  target.addEventListener('click', click);
  return () => {
    entity.dispose();
    volume.geometry.dispose();
    material.dispose();
  };
}
