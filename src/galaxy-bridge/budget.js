// The XR app's draw budget (docs/plans/m3-m4-agent-and-polish.md, Task 18: at most 300 draw calls and 750,000
// triangles): the copied scene is asked for its light rig models and a few ship hulls at a time. The island keeps every
// modelled building (the owner's choice: blocks read as a heap); the headset asset tier simplifies those models instead
// (tools/assets/build-assets.mjs). Switches added to the copied code by tools/migrate/apply-patches.mjs; the flat
// reference view keeps everything.
import { IslandMotion } from '../../galaxy/viewer/agents/sky-island.js';
import { RoadCars } from '../../galaxy/viewer/traffic/road-vehicles.js';
import { FleetLimits } from '../../galaxy/viewer/galaxy/constellation-fleet.js';
import { RiggedAssets } from '../../galaxy/viewer/scene/rigged-assets.js';

/** Ship hulls drawn at once; the rest show as engine glints, which are also their pointer targets. */
export const VISIBLE_HULLS = 6;

export function applyHeadsetBudget() {
  RiggedAssets.preferLod(true);
  FleetLimits.visible = VISIBLE_HULLS;
  // At a seated user's scale the island's idle motions (propellers, smoke, fans, lanterns, the relay dish) read as noise.
  IslandMotion.idle = false;
  // Road cars are a few millimetres long on a landed globe: the town kit's light cars, not the detailed models.
  RoadCars.detailed = false;
}
