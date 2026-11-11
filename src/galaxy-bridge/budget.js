// The XR app's draw budget (docs/plans/m3-m4-agent-and-polish.md, Task 18: at most 300 draw calls and 750,000
// triangles): the copied scene is asked for its light rig models, a few ship hulls at a time, and a lighter island.
// Switches added to the copied code by tools/migrate/apply-patches.mjs; the flat reference view keeps everything.
import { IslandDetail } from '../../galaxy/viewer/agents/sky-island.js';
import { FleetLimits } from '../../galaxy/viewer/galaxy/constellation-fleet.js';
import { RiggedAssets } from '../../galaxy/viewer/scene/rigged-assets.js';

/** Ship hulls drawn at once; the rest show as engine glints, which are also their pointer targets. */
export const VISIBLE_HULLS = 6;

export function applyHeadsetBudget() {
  RiggedAssets.preferLod(true);
  FleetLimits.visible = VISIBLE_HULLS;
  IslandDetail.full = false;
}
