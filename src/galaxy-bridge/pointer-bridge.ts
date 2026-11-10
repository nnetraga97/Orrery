// Pointer events on the galaxy (a hand ray in a headset, the mouse in a browser tab) -> the copied picking code. The
// event's ray is carried into the model's own space and handed to the scene kit, whose existing logic then calls
// host.actions.showHover and host.actions.selectFile. One Ray and one Matrix4, reused: nothing is allocated per event.
//
// IWSDK's ray does not test the copied objects themselves: they include sprites, whose raycast needs a camera the
// pointer library does not supply (it throws and aborts every event), and building IWSDK's per-mesh search trees over
// the whole galaxy is costly. Instead an invisible hit volume around the table model takes the events, and the kit
// does the actual picking with the ray, as on the desktop.
import { BoxGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Ray, RayInteractable } from '@iwsdk/core';
import type { Object3D, World } from '@iwsdk/core';
import type { XrSceneKit } from './scene-kit.js';

/**
 * The hit volume: the space over the table the model can occupy (room metres, axis-aligned). The overview frames the
 * model off-centre (measured: x -0.47..0.64, y 0.79..1.08, z -1.32..-0.36), and a landed globe rests on the table
 * (y 0.84..1.48).
 * Double-sided, so a ray from a hand already inside it still hits.
 */
export const HIT_VOLUME = { center: [0, 1.0, -0.8] as const, size: [1.5, 1.0, 1.3] as const };

interface RayEvent {
  ray: Ray;
}

export function bridgePointer(world: World, group: Object3D, kit: XrSceneKit): () => void {
  const ray = new Ray(),
    inverse = new Matrix4();
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.visible = false;
  const volume = new Mesh(new BoxGeometry(...HIT_VOLUME.size), material);
  volume.name = 'galaxy-hit-volume';
  volume.position.set(...HIT_VOLUME.center);
  const entity = world.createTransformEntity(volume);
  entity.addComponent(RayInteractable);

  const toModel = (event: RayEvent) => {
    inverse.copy(group.matrixWorld).invert();
    return ray.copy(event.ray).applyMatrix4(inverse);
  };
  const move = (event: unknown) => kit.pointerMove(toModel(event as RayEvent));
  const leave = () => kit.pointerLeave();
  const click = (event: unknown) => kit.pointerClick(toModel(event as RayEvent));
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
