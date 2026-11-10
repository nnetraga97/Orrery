# Code-shaped planets and towns

The landed planet is a visual IDE: code should fill the view. Each method/function region owns an island, with a coastline, height and town derived from its code. Regions cover the globe. The library body supplies the ground/ocean palette through `planetGroundSample` and `sampleGround`; land uses vertex colours and a simple ocean sphere. Library relief, normal maps and detail textures do not shape callable planets. Files without functions retain their gas or asteroid bodies.

`planet-terrain.js` builds the surface and supplies `heightAt`, region sites and ownership. Picking, radial town frames, roads, ports and overlays use that surface. `incremental-towns.js` packs each town into its region using the spherical builder, retains unchanged per-town renderers and rebases their source views. Small distant towns keep a silhouette at every statement position in one shared overview batch; selecting a town prepares its detailed buildings.

Fresh landing starts with a low oblique view along the first populated lane of the town with the most statements; remembered selections are retained. An explicit source location instead focuses its exact statement. Display → Whole planet provides the overview. Town dragging, saved pins, the placement grid, engineered pads and settlement cuts have been removed. Old placement fields are ignored; file/town identity keys remain valid.

## Source and debugger contracts

- `layout-identity.js` and `galaxy-memory.ts` preserve file/town identity across supported edits, renames and restarts. Identity is independent of old placement recipes.
- `source-index.js` and `source-navigation.ts` retain exact, approximate, stale and unmapped results. Ambiguous or stale records never acquire guessed statement positions.
- Breakpoints, paused variables, runtime positions, evidence and captured stack frames resolve through the same source index and town/lot frames. Debug footprints outline statement lots on the curved surface.
- Directed calls retain path lines and optional illustrative ships, anchored to call sites and town ports. Routes are sampled once with terrain clearance. They are structural relationships, separate from runtime evidence; there are no monorails.

## Orbit and loading

The constellation keeps its library sphere. Between 8.5 and 7.5 body radii, a short crossfade introduces the code surface; late builds also ease in. The transition uses image compositing, then the landed scene shares the main depth buffer through its scaled camera. Towns rise out of the ground after the handoff. Explicit source navigation and live edits preserve their existing selection/publication contracts.

The former pad design and its historical verification are recorded in [the implementation report](planet-towns-progress.md). Current verification commands are in [Verification](../verification.md).

Call-route lines show incoming and outgoing calls for the selected or hovered town, plus routes associated with exact captured stack or trace locations. External and unresolved calls show only for the selected town. With no selection, hover or capture, there are no route lines. Terrain-following hops use local surface distance and town extent; optional illustrative ships share those curves and remain capped at 24.
