# Planet loading and future traffic

Planet construction and vehicle updates have different lifetimes and budgets. A planet is expensive static data; a vehicle should only advance along an existing route. Source relationships describe potential connections, not observed execution.

## Implemented boundaries

- `planet-terrain.js` builds regions around the semantic district and neighborhood anchors, then computes borders, terrain, normals and the inspector map. `planet-worker.js` runs this CPU work outside the rendering thread and transfers typed geometry buffers back. See [Semantic planets](semantic-planets.md) for what the layout represents.
- `planet-build.js` retains immutable terrain data in an LRU cache capped at 32 MiB of estimated payload. The complete construction inputs form the key, so changed source topology or appearance cannot reuse stale geometry. GPU objects, camera positions and running vehicles are never cached there.
- Each detail owns an `AbortController`. Leaving or switching aborts its worker and cooperative town construction, disposes partial town resources, and prevents results from attaching to an obsolete host. Workers terminate after completion or cancellation. Failures appear in the loading panel.
- Town layout, placement and road construction yield at explicit boundaries on a six-millisecond budget. Building batches are exposed in groups of up to three per frame to spread shader and buffer uploads. This is a cooperative budget, not a guarantee: source parsing, individual geometry operations and driver work can still produce longer frames.
- Call routes connect spherical town sites and ports. Selection, hover and exact captures choose visible lines; external/unresolved routes require selection. Path lines and at most 24 illustrative ships share low, terrain-following polylines with hull clearance; animation never resamples the terrain. There are no monorails.
- Detail distance checks run after body motion and camera following. A delayed frame cannot compare a new body position with the previous camera position and spuriously destroy/rebuild the planet.

Terrain data is cached; town layouts and call route tables rebuild on a revisit. This avoids caching mutable AST layout, scene handles and model references together. Further caching should use an explicit immutable layout format keyed by source revision and layout version.

## Future runtime-driven traffic

A future runtime-driven traffic implementation should consume route records, rather than calling town construction from a vehicle update. Existing structural traffic is not execution evidence. Separate the following:

1. **Evidence:** normalized source/trace events with stable file and method identifiers, source revision, call/return correlation, execution context and timestamps. Unresolved targets stay unresolved. Geometry does not decide which call actually happened.
2. **Simulation:** fixed-step time, a bounded spawn queue, vehicle state (`routeId`, distance, speed, phase), route reservations and arrival/return events. Pause/speed controls change simulation time. Frame stalls must not cause an unbounded catch-up loop.
3. **Presentation:** interpolate simulation positions into instanced vehicle batches. Draw only relevant vehicles and routes. Camera/LOD changes must not spawn, terminate or reroute calls; world motion is applied through the existing local-to-world host transform.

Keep route data immutable for a source revision. A changed revision needs a new route graph and an explicit policy for in-flight calls; never silently mutate a path under moving vehicles. Spaceport, ground-road and call links should share endpoint identities, units and distance semantics before multi-mode scheduling is added.

The current renderer supplies terrain/route construction and distance sampling. It does not implement a live trace receiver, a global traffic scheduler, reservations, or a large-fleet performance guarantee.

## Verification

The planet-library and planet-appearance Electron checks cover asset loading, picking,
and orbital/surface rendering. Verify transport routes and the full navigation flow
in the Electron window as described in [Verification](verification.md).

## Continuous scene transitions

The constellation keeps the library sphere; the landed surface is shaped by the code.

- Method islands, heights and borders come from `planet-terrain.js`. Library ground/ocean colours tint vertex-colour land and an ocean sphere; landed code surfaces load no library relief or detail maps.
- Every method town is packed at its region site, oriented radially. Incremental edits retain unchanged town renderers and rebase source ranges. Saved pads and pins are ignored without invalidating identity memory; dragging and settlement controls are removed.
- A short crossfade runs from 8.5 to 7.5 body radii using image compositing. Once fully visible, the detail shares the main depth buffer through its scaled camera; near-surface depth slicing is preserved. Towns rise over 0.9 seconds.
- Landing looks obliquely across the start region, or at the statement requested by source navigation. Display → Whole planet pulls back to the globe.

Explicit land actions start preparation immediately and approach over 1.8 seconds. Town focus and exit
use 1.6-second moves. Camera easing has zero velocity and acceleration at its endpoints, spherical
interpolation remains stable across opposite hemispheres, and retargeting inherits the active flight's
velocity with a bounded correction. Frame deltas are capped during flights to avoid a catch-up jump
after a slow frame. Orbit-control inertia is cleared before scripted movement.

User drag/scroll increments a navigation revision and cancels the active flight. An asynchronous planet
load only starts its requested auto-focus if that revision still matches. The sidebar width animates on
desktop, with renderer dimensions and camera aspect synchronized on every frame; narrow screens use
an inspector overlay so the canvas retains its width.


## Industrial planet rendering

The detail terrain uses flat buildable interiors and lowered shores around method regions. One ocean
sphere covers the channels. Town placement and ship clearance share a sea-level floor, keeping
roads, stations, and vehicles above the water. Source-sized regions and statement identity stay intact.

Five factory silhouettes in `industrial-kit.js` merge their colored machine parts into one geometry
per role. Towns instance those meshes; the replaced asset roles are excluded from GLB loading. Other
kit materials are cloned per detail and disposed with the town, preserving the shared asset cache.
Navigable terrain keeps shader-based surface detail. Constellation planets use the
[planet library](../viewer/assets/planets/README.md): Perilune material maps and
optimized Tripo globes, instanced by asset, material part and detail tier. Texture
decoding and mesh fitting happen once per asset in a view, and a completed load swaps
only that asset's batch. Each frame packs visible bodies into their tier: above ~40 px
radius (30 px to drop back) a globe draws full geometry, below it a 24×16 sphere, and
under a quarter pixel nothing. File paths select appearances independently of snapshot
indices; per-frame instance ids and bounds drive raycasting. Expired deletion ghosts
leave between frames. Landing uses code-derived coastlines, heights and region borders, with towns on every region. While a planet is open, fleet ships bound for it
book a town-port bay and hand off to a port arrival at three planet radii.

Atmospheres are analytic: the shell shader finds each view ray's closest approach to
the body, adds limb haze over the disc and a falloff beyond it, and weights both by the
scene sun. Cloud layers drift in simulation time. Catalog `polarFill` rows mirror
texture over source no-data caps; the shader flips the mirrored normal-map slope and
fades the last degrees toward the adjoining band's colour.

Seen from across the galaxy, the agent cannon, sky island and context district are a
few hundred meshes. Meshes under 1.5 px move to a layer the camera does not render or
raycast; invisible pick proxies stay. Dependency ship hulls under 1.5 px skip their
instance and keep the engine glint, which is also their pointer target.

## Colour

`viewer/scene/color-space.js` enables colour management before palette creation and owns all migration tuning in `COLOR`: sRGB display output, AgX exposure, physical light scaling and environment strength. Albedo, emissive, clouds and colour canvases are sRGB; normal, roughness and other data maps remain untagged (`NoColorSpace`), and GLTFLoader retains its native texture tags. The procedural sky bakes linear half-float radiance, supplies a per-view PMREM, and shares that environment with landed planets; intermediate detail rendering stays linear HDR until its output pass. Custom colour shaders include tone-mapping and output conversion, with emissive effects explicitly opting out of tone mapping. See [Colour migration](design/colour-migration.md) for calibration values, shader decisions and pending visual review.
