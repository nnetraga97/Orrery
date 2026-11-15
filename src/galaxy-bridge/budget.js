// The XR app's draw budget (docs/plans/m3-m4-agent-and-polish.md, Task 18: at most 300 draw calls and 750,000
// triangles): the copied scene is asked for its light rig models and a few ship hulls at a time. The island keeps every
// modelled building (the owner's choice: blocks read as a heap); the headset asset tier simplifies those models instead
// (tools/assets/build-assets.mjs). Switches added to the copied code by tools/migrate/apply-patches.mjs; the flat
// reference view keeps everything.
import { IslandMotion } from '../../galaxy/viewer/agents/sky-island.js';
import { RoadCars } from '../../galaxy/viewer/traffic/road-vehicles.js';
import { TrafficRules } from '../../galaxy/viewer/traffic/traffic.js';
import { PortShips } from '../../galaxy/viewer/traffic/port-traffic.js';
import { FleetLimits } from '../../galaxy/viewer/galaxy/constellation-fleet.js';
import { RiggedAssets } from '../../galaxy/viewer/scene/rigged-assets.js';
import { StarLimits } from '../../galaxy/viewer/galaxy/star-bodies.js';
import * as THREE from '@iwsdk/core';
import { starShrink } from '../core/star-limit.ts';

/** Ship hulls drawn at once; the rest show as engine glints, which are also their pointer targets. */
export const VISIBLE_HULLS = 6;

export function applyHeadsetBudget() {
  RiggedAssets.preferLod(true);
  FleetLimits.visible = VISIBLE_HULLS;
  // At a seated user's scale the island's idle motions (propellers, smoke, fans, lanterns, the relay dish) read as noise.
  IslandMotion.idle = false;
  // Road cars are a few millimetres long on a landed globe: the town kit's light cars, not the detailed models.
  RoadCars.detailed = false;
  // Traffic that says something: one car for each planned path through a function, overview ships only on the
  // selected file's lanes, and a ship at a port only when its route is picked from the function's list.
  TrafficRules.perPath = true;
  FleetLimits.background = false;
  PortShips.scheduled = false;
}

/** Where the viewer's head is, in the room (the galaxy system keeps it current). */
export const viewerEye = new THREE.Vector3(0, 1.2, 0);
const starCentre = new THREE.Vector3();

/**
 * Keeps a star from filling the room: one whose disc, seen from the head, is wider than a few degrees shrinks away
 * (src/core/star-limit.ts). That is the landed file's own star, metres across beside the globe and behind the windows.
 * `matrix` is the star's in the model's space and `scene` the model, whose pose in the room is last frame's.
 */
export function limitStars() {
  StarLimits.shrink = (matrix, scene) => {
    starCentre.setFromMatrixPosition(matrix).applyMatrix4(scene.matrixWorld);
    return starShrink(matrix.getMaxScaleOnAxis() * scene.scale.x, starCentre.distanceTo(viewerEye));
  };
}
