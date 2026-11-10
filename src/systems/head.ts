// Where the viewer's head is: the player's head in a headset, the page camera in a browser tab.
import type { Object3D, Vector3, WebGLRenderer } from '@iwsdk/core';

export function headObject(renderer: WebGLRenderer, player: { head: Object3D }, camera: Object3D): Object3D {
  return renderer.xr.isPresenting ? player.head : camera;
}

export function headPosition(renderer: WebGLRenderer, player: { head: Object3D }, camera: Object3D, out: Vector3) {
  return headObject(renderer, player, camera).getWorldPosition(out);
}
