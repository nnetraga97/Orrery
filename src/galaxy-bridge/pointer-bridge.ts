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
  volume.name = 'galaxy-hit-volume';
  volume.position.set(...HIT_VOLUME.center);
  // Windows (the chat, cards, the code card) may sit inside this volume; any window on the ray wins over the galaxy.
  (volume as unknown as { pointerEventsOrder: number }).pointerEventsOrder = -1;
  const entity = world.createTransformEntity(volume);
  entity.addComponent(RayInteractable);

  const toModel = (event: RayEvent) => {
    inverse.copy(group.matrixWorld).invert();
    return ray.copy(event.ray).applyMatrix4(inverse);
  };
  // Each pointer (hand, mouse) is passed with its id: the kit keeps one ray per pointer.
  const move = (event: unknown) => kit.pointerMove(toModel(event as RayEvent), (event as RayEvent).pointerId);
  const leave = (event: unknown) => kit.pointerLeave((event as RayEvent).pointerId);
  const click = (event: unknown) => kit.pointerClick(toModel(event as RayEvent), (event as RayEvent).pointerId);
  // The pointer-event types are not part of three's Object3D event map, hence the loose listener type.
  const target = volume as unknown as {
    addEventListener(type: string, listener: (event: unknown) => void): void;
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerleave', leave);
  target.addEventListener('click', click);
  return () => {
    entity.dispose();
    volume.geometry.dispose();
    material.dispose();
  };
}
