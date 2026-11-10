# Planet towns implementation report — 2026-10-18

Work is on `layout-identity`. Earlier follow-ups below include authorized commits and pushes. The source-map and terrain-worker continuations were committed and pushed as `b009836` after explicit authorization. The loading-feedback and planet-relative fit continuations were committed and pushed as `4fa2993`. The terrain-contact continuation was committed and pushed as `dd249be`. The cold-load/edit-budget continuation below is authorized for commit and push on this branch. The pre-existing untracked `.claude/` directory was left alone. No dependencies, CI, lint configuration, test framework, generated images/models, or new screenshot baselines were added.

## Step status and decisions

Steps 1–3 were the starting implementation and were not redone. Step 7 was already implemented at `5fbc7db`; it was retained and exercised by the handoff check.

| Work | Status | Commit | Files touched and decision |
|---|---|---|---|
| Steps 4–5 gaps, plus small-body landing | Done for the requested gaps | `15ff4f5` | `viewer/town-pads.js`, `viewer/towns/towns.js`, `viewer/planet/planet.js`, `viewer/galaxy/asteroids.js`, `viewer/galaxy/constellation.js`. Keep the above-ground pad datum; cap wall drop at 0.24 and use narrow supports. Draw compact overflow towers while retaining full source/plan data. Asteroids and comets receive simple rock/ice landing forms; orbital tumble and tails are not copied. |
| Step 6 incremental updates | Done; large-project measurements recorded below | `a931686`, `daf135e` | `viewer/towns/incremental-towns.js`, `viewer/towns/town-source-view.js`, `viewer/planet/planet.js`, `viewer/towns/towns.js`, `viewer/town-pads.js`, `viewer/planet/planet-worker.js`, `source-model/town-revision.js`, `checks/town-revision.mjs`, `checks/layout-identity-desktop.mjs`. Independently owned draw batches and source indexes survive unrelated edits. Revision views translate source metadata; terrain compilation is reused while town membership stays fixed. Pads retain their geometry, consume reserved growth cells, or overflow locally. Staging never steals old owners before publication. |
| Step 8 directed routes and ships | Done for static routes and captured stacks | `57eda8f`, `c87e0a4` | `viewer/debug/stack-paths.js`, `source-model/debug-records.js`, `source-model/source-index.js`, `viewer/planet/planet.js`, `viewer/galaxy/constellation.js`, `viewer/app/panels/PlanetInspector.tsx`, `viewer/styles/planet-inspector.css`, `checks/source-index.mjs`, `checks/source-index-desktop.mjs`. Display → Captured stack accepts JSON records; numbered recursive invocations, directed arrows, explicit async links, cross-file boundary labels, selection and visibility controls. Invalid captures preserve the previous capture. Stale/ambiguous/unmapped frames remain listed without guessed positions. A bad column cannot spill onto another source line. Capture paths persist independently of ship animation. The original captured-stack implementation is now connected to a first Node/TypeScript runtime adapter; see the runtime follow-up below. |
| Step 9 manual town movement | Built; hands-on acceptance pending | `cd9633f` | `viewer/town-move.js`, `viewer/town-pads.js`, `viewer/planet/planet.js`, `viewer/galaxy/constellation.js`, `viewer/app/galaxy-memory.ts`, `viewer/app/panels/PlanetInspector.tsx`. Select a town, then Display → Move selected town and drag over the surface. Preview checks land, slope, occupied cells/margins and seams. Escape cancels; Undo restores the prior pin/place. Pins persist; undo history lasts for the current landed session and survives its staged updates. Invalid saved pins are retained as unresolved. |
| Step 10 debug view / terrain | Debug view built; new terrain **skipped pending permission** | `f38c4bd` | `viewer/debug/town-debug.js`, `viewer/planet/planet.js`, `viewer/towns/towns.js`, `viewer/app/panels/PlanetInspector.tsx`. Display → Debug layers shows coloured footprints, dashed offshore cells, softened terrain, neutral lights and raised selected markers. Materials are cloned rather than changing the orbital library. No terrain/DEM download was made; 2K/4K migration is pending explicit permission. |
| Step 11 building set | Requested briefs done; generation **skipped by instruction** | `594c46c` | `docs/design/building-briefs.md`. Briefs cover statement buildings, overflow, semantic fixtures and town infrastructure, with a shared Building contract. No image or 3D generation was invoked. |
| Interaction review fixes | Done | `c01d03c` and the final recovery commit | `viewer/planet/planet.js`, `viewer/galaxy/constellation.js`, `viewer/towns/towns.js`, `viewer/traffic/traffic.js`, `viewer/traffic/transport.js`, `viewer/traffic/call-routes.js`, `viewer/app/panels/PlanetInspector.tsx`, `viewer/app/galaxy-memory.ts`. Suppress traffic on overflow towers, make tower hover open method details, retain precise selected elements through debug toggles, preserve selection during publication, reduce endpoint-label overlap, and distinguish current-revision navigation readiness from old-world visibility. Corrupt-layout notices also appear in the planet panel. |

New pads reserve growth cells. A growing town consumes that reservation and re-cuts only its own pad; growth beyond the reservation becomes overflow without moving neighbouring towns. The large-project follow-up uses a 245-file analysis and a 300-method, 5,400-line stress file. A single 5,000-line method and minified input remain separate acceptance cases.

## Verification

`npm run build` and `npm run typecheck` passed. The production build retains Vite's existing browser-externalization warning for the optional `node:url` import in the tree-sitter loader. No dependency was added.

`node scripts/run-checks.mjs layout-memory layout-identity town-revision source-index call-routes planet-grid desktop-workbench` passed **7/7**. The plain-Node town-revision check is registered in the existing runner; source-index coverage includes captured invocation paths and invalid source columns.

All four requested Electron checks passed on the final implementation. The earlier pad run exposed an undefined source-ID lookup; the revision facade now returns null for absent IDs, and the final pad/restart check passed. Final output:

```text
node checks/town-pads-desktop.mjs
{"earth":20,"moon":8}
PASS: towns stand on level pads, on land, and keep their grid placements across a restart.

node checks/planet-handoff-desktop.mjs
[{"asset":"earth","meanAbsDiff":0.67,"pixels":96709},{"asset":"moon","meanAbsDiff":1.32,"pixels":96709}]
PASS: the close-up draws the orbital body with its own materials; the handoff leaves the ground unchanged.

node checks/source-index-desktop.mjs
PASS: exact source lookup, retained indexes, numbered recursion, async boundaries, paused paths and stale captures in Electron.

node checks/layout-identity-desktop.mjs
PASS: method rename, file rename, added method and restart keep the planet look and town anchors.
```

The large-project run below additionally launched through `npm run desktop`, tested real edits in both a 68-town source file and a 300-town fixture, activated/paused ships, and visually inspected captured-stack navigation. Project and chat controls were present. Dragging, project switching, provider-backed chat and full window-resize acceptance still need the separate visual pass; no live provider inference is claimed. No new screenshot test or baseline was written.

## Visual acceptance checklist

1. **Pads / overflow:** land on Earth and Moon. Check shallow retaining walls and narrow supports; select a tower labelled “N statements”, hover it, open its complete plan, and reveal a statement from source. Inspect an asteroid and comet's landed form.
2. **Updates:** edit one method while landed. Keep using the previous world during the update, observe the stale notice, and confirm the replacement retains selection and unchanged pads. Check a failed source load leaves the old world usable. Unchanged town meshes, source indexes and pads should retain object identity.
3. **Routes:** inspect repeated calls, recursion and external/unresolved edges. In Display, enable call ships, then disable animation and confirm the lines remain. Exercise port travel and cancellation. Load a captured stack through Display and select numbered frames; check recursive invocations, explicit async links, cross-file boundaries, stale records and paused paths.
4. **Movement:** use Display → Move selected town; try a valid site, water, steep ground, a seam and another town. Cancel with Escape, commit a valid move, undo, and restart to confirm a committed pin. Edit the source during a drag and confirm it cancels.
5. **Debug:** enable Debug layers and compare footprint colours, offshore dashes, neutral light, terrain contrast and raised selection. Turn it off and check the original materials return. Confirm same-line source selection stays exact.
6. **Briefs / shell:** review `building-briefs.md` before any future generation. Switch projects, open chat controls, inspect source, leave/re-enter a planet and resize the Electron window.


## Follow-up: incremental renderers and numbered stacks

The incremental check now compares actual renderer and pad-owner identities through a method rename, file rename and method insertion. A file move that changes relative-import resolution correctly rebuilds the affected caller. Unchanged source indexes survive a leading-line insertion; their revision views return updated source locations. Retained callback scopes and code labels also rebase. The new captured-stack check loads JSON through the real Electron Display panel, selects a precise same-line frame, checks distinct recursion and explicit async/cross-file links, pauses ships, rejects a duplicate-invocation capture without replacing the previous one, and verifies old evidence becomes stale after an edit.

Implementation choice: town batches have independent ownership, while loaded asset geometry remains shared. This makes local invalidation and cancellation explicit, at the cost of more draw batches than one file-wide batch. The 300-method fixture is now measured below. These measurements do not establish every §13 budget, especially cold construction, warm reveal latency and the 20k-file overview. Captures are supplied by a debugger/exporter or loaded from JSON; static call routes never manufacture observed frames. Each JSON record uses the existing evidence fields (`type: "frame"`, file, 1-based line/optional column or offset, revision, source provenance, invocation ID and non-negative depth; optional session/context/continues). Depth 0 is innermost. The panel exposes the format and current source revision.


## Large-project review

The actual Electron app was launched with `npm run desktop` against an isolated copy of 244 real JS/TS source files from this repository (about 58,000 lines), plus a 300-method, 5,400-line fixture. The analyzer reported 245 files. Measurements used the foreground Electron window at 1440×859 with a 2308×1390 drawing buffer; timings are instrumented rAF intervals, not a GPU benchmark. No screenshot baseline was created.

The largest real file, `viewer/app/codex-chat.ts`, has 68 towns. Editing `acceptThread` rebuilt exactly that renderer and retained the other 67. In the stress file, editing `town150` rebuilt exactly one of 300 renderers while retaining all 300 pad owners, the terrain compilation and the natural body. Captured recursive frames loaded, displayed separate numbers and selected their exact source location. The project control and Chats toggle were present; no renderer errors were reported.

The first larger run exposed a roughly five-second main-thread allocation stall and 27 FPS rendering. The fixes avoid allocation when measured footprints and placements are unchanged, preserve even unsaved overflow placements, move necessary allocation into the cancellable worker, retain town label DOM, and cull hidden town/pad/route groups. Culling uses the full camera before the renderer temporarily splits its depth range. Stack-frame navigation now approaches the selected town from above its surface instead of carrying the prior hemisphere's camera direction through the planet.

Previous large-project measurements (before the performance and placement follow-up below):

| Case | Result |
|---|---|
| Real 68-town source file | 120 FPS, p95 8.5 ms, 532 draw calls at p95 |
| 300-town stress file, idle | 73 FPS, p95 16.8 ms, 917 draw calls at p95 |
| 300-town stress file, ships active | 72 FPS, p95 16.8 ms, 901 draw calls at p95; no sampled long tasks |
| One-town stress-file edit | 1.72 s including analyzer/watch/publication, p95 frame interval 25.9 ms, longest observed main-thread task 63 ms |
| Cold landing preparation | 6.54 s for the real file; 19.62 s for 300 towns |
| Renderer JS heap | About 450 MB at 68 towns and 765 MB at 300 towns after navigating/editing; not GPU or total-process memory |

The final run's surface and tower geometry were visually inspected in the Electron capture, including the numbered recursive frames. The final camera was outside the planet (radius 16.09 versus surface radius 10), with the selected town visible. Those measurements exposed the remaining 63 ms edit task and slow cold construction addressed in the follow-up below. They did not establish full performance-budget compliance; the 20k-file overview and warm reveal limit remain unmeasured. The local edit and retention contract is verified independently of those performance targets.

## Follow-up: edit stalls, cold construction and terrain placement

The remaining edit stall came partly from constructing every invisible debug footprint again on each revision. Debug footprints now build only when enabled, in bounded chunks; ordinary edits do not touch that geometry. Retained source views share cloned subtrees within a town, hidden labels skip source/projection work, and route creation yields between batches. Town construction shares one work deadline across the file, skips unused asset/material/rig setup for compact towers and measurement, and reuses packing measurements for identical shapes. Library planets compile a smaller territory map instead of generating a second detailed procedural surface underneath the unchanged natural body.

The allocator now uses summed-area occupancy checks instead of repeatedly rescanning rejected ranking blocks. Globe-wide territory centres replace the raw semantic anchors that clustered towns in a small cap. Placement tries suitable land, water platforms, then crater-spanning engineered sites before reporting a true allocation overflow. Ocean worlds first shrink only unplaced newcomers to a readable footprint or compact tower; already placed neighbours remain fixed. Pad frames use the centre of the rotated reservation, with conservative cell pitch and clearance so the physical slab stays inside its reserved cells.

Automatic placements use recipe 2 and migrate once, with a visible notice. Pins remain authoritative. A separate persistence defect was found during migration verification: `reconcileTowns` rebuilt identity records without copying their saved place/pin fields. Reconciliation now preserves these fields for ordinary edits, matched renames and restored deletions, and clears the restored tombstone. The previous deterministic restart check alone could not catch this data loss. The pure identity check now explicitly covers place/pin retention.

The existing Earth/Moon desktop pad check now verifies every physical pad corner falls inside its reservation and no reserved cells overlap, as well as ground clearance, on-land placement and restart stability. No new screenshot baseline or framework was added.

Final verification used a fresh isolated 245-file project: 244 real source files (58,424 lines) and the 300-town, 5,400-line stress file, in the actual foreground Electron app launched by `npm run desktop`. At 68 towns every pad was allocated; at 300 towns the cube-face counts were **40 / 60 / 55 / 46 / 44 / 55**, all 300 had allocated footprints, no reserved cell overlapped, and all four physical corners of every pad fell inside its reservation. Compact towers cover about 19.3% of the sphere; the fix distributes them around the globe rather than increasing concrete coverage or covering natural terrain unnecessarily. The 68-town real file retains detailed towns, with nine compact towers.

A separate larger-project run removed the saved placement recipe from both files and supplied an explicit saved pin. All 367 automatic placements migrated, the pin retained its exact face/cell/orientation, reservations remained disjoint, and both files retained every saved placement after restarting Electron. The migration notice appeared on the first landing and did not repeat after restart.

| Final measurement | Result |
|---|---|
| Real 68-town file, first landing | Ready in 2.93 s; 4.59 s including camera flight |
| 300-town file, first landing | Ready in 3.18 s; 4.87 s including camera flight, versus 19.62 s previously |
| 300 towns idle / ships active | 118 / 119 FPS; p95 frame interval 8.8 / 8.9 ms; no sampled long tasks |
| Three consecutive edits to town150 | 1.385 / 1.059 / 1.126 s including watch, analysis and publication; no main-thread task at or above 50 ms in any edit |
| Edit retention | Exactly one renderer replaced each time; all 300 pad owners, 299 other renderers, terrain and natural body retained |
| Edit frame intervals | p95 17.5 / 25.0 / 17.6 ms |

The final Electron capture was inspected: pads stand separately around the surface, numbered recursive frames remain visible/selectable, and project/chat controls remain present. Debug layers built all 300 footprints on demand and restored the original materials when disabled. The real-file edit rebuilt only `acceptThread` and retained the other 67 renderers. No renderer errors were reported.

These measurements demonstrate the requested improvement, not universal frame-budget compliance. First construction still recorded long tasks (314 ms on the first real-file landing and 145 ms on the subsequent 300-town landing); the real-file post-landing sample included a 63 ms task. The three measured stress-file edits had none at or above 50 ms, but their p95 frame intervals still exceed 16.7 ms. The 20k-file overview and warm reveal target remain unmeasured.

Validation on the final code: build and typecheck passed; the seven selected offline check groups passed; all four desktop checks passed (pads, natural-body handoff, source index/captured stacks, layout identity). The migration/restart and repeated-edit measurements above ran separately on the larger project. Changes are in `0550ecd` (placement/pin persistence) and `8033a12` (construction, edit work and globe-wide pad reservations).

## Follow-up: remaining-work items 1–6, terrain and visual emphasis

This refers to the six remaining-work items discussed after the previous delivery, rather than original build steps 1–6. Manual interaction acceptance is deferred at the user's request.

| Remaining-work item | Current status |
|---|---|
| 1. Performance | Partial. Pad geometry now yields between towns and cleans staged resources on cancellation. Detailed town materials compile asynchronously; texture uploads are separated before publication. Source highlighting uses a sliced scanner instead of parsing another full AST. Warm source reveal on a built planet positions the view immediately. The 20k overview and warm reveal have now been measured; cold tasks and edit p95 remain above budget. |
| 2. Manual interaction | Deferred by the user: drag validity, Escape/undo, edit during drag, travel during movement. |
| 3. Edge cases / recovery | Partial. A 248-file Electron project verified a 5,000-statement method, 801 statements on one minified line, corrupt detail height fallback, source-fetch failure/recovery, first-callable appearance, and retargeting during construction. Complete analyzer-failure and rapid project-switch coverage remain. |
| 4. Broader design gaps | Partial. A file retains its assigned gas world when its first callable arrives. Cross-file logical town identity, split/merge inheritance, source-map navigation and the full family of observed debug markers remain. Captured numbered stacks continue to work. |
| 5. Terrain / assets | The requested Earth/Moon material tiers are implemented using existing local Perilune packs: 1K fallback, 2K default and optional 4K under Display. Source/output checksums and dimensions are checked. Only one world retains 4K maps; fixed height/buildability keeps pads stable across visual tiers. No download or building generation occurred. Building briefs remain the deliverable for buildings. |
| 6. Visual acceptance | Partial, with an actual Electron visual pass. Compact towers now retain readable colour in shade, show their method names and avoid overlapping labels. Display scrolls within a compact viewport. 4K, fallback, debug-material restoration, numbered frames and source navigation were exercised; project/chat controls remained present. Manual interaction and live provider chat are still separate acceptance work. |

Terrain detail is transactional: all channels and the height byte count validate before replacing the fallback. A failed 4K load keeps the current material and reports the failure in Display. Switching 4K while debug materials are active refreshes the debug clone. The local Perilune importer also writes the packs' 4K height (and Earth's 4K land mask) as `close.height` / `close.land`. Settlements are placed on, slope-tested against and cut into that relief whenever a world has it; the 1K field remains the orbital silhouette and the fallback. Cell addresses do not depend on the visual material tier. The 4K GPU budget is one retained world (about 128 MiB for three RGBA maps with mipmaps), with two high tiers temporarily possible while switching. The old tier is disposed after successful publication. Existing 2K maps remain available for restoration.

Large-project final measurements used 244 real source files (about 58,600 lines) plus the 300-town fixture. The foreground Electron window was 1440×859, with a 2308×1390 drawing buffer:

| Measurement | Result |
|---|---|
| 68-town real file ready / including flight | 3.04 s / 4.61 s |
| 300-town file ready / including flight | 3.28 s / 4.96 s |
| Cold longest tasks | 142 ms real file; 153 ms stress file — still above the 50 ms budget |
| 300 towns idle / ships | 120 FPS; p95 8.5 / 9.5 ms; no sampled long tasks |
| Three local edits, watch through publication | 1.508 / 1.140 / 1.077 s; no tasks at or above 50 ms |
| Edit p95 | 17.5 / 24.6 / 17.8 ms — still above the 16.7 ms target |
| Retention | Each edit replaces only town150; all 300 pads, 299 other renderers, body and terrain retained |
| Warm reveal, four different locations | 12.9 / 24.4 / 22.5 / 18.9 ms through the next animation frame; exact source lookup; no camera flight |
| Separate 20,000-file overview fixture | 120 FPS, p95 10.3 ms, no detailed planet, no frame errors; about 299 MiB JS heap (not total GPU/process memory) |

The 300-town distribution remains 40 / 60 / 55 / 46 / 44 / 55 across cube faces, with no overlapping reserved cells and no physical pad corner outside its reservation. A separate failed source fetch kept all 300 owners and the body attached, marked lookup stale, and recovered all unchanged renderers on the next valid revision. The 5,000-statement method remained compact with exact navigation at both ends and 5,001 indexed elements. The single-line file retained all 801 indexed elements and exact column lookup. A rapid retarget finished on the requested file without attaching the abandoned detail.

The 4K visual review covered 300 Moon towns and 27 Earth towns in the larger project. All three maps reached 4096×2048 while body/terrain/pad objects and placement values stayed unchanged. Returning to 2K restored 2048×1024 maps. Promoting Earth evicted Moon's high maps. A deliberately blocked 4K request preserved 2K and displayed its failure; corrupt 2K height preserved the 1K fallback. The compact viewport review uses Electron's device-metrics override at 1000×700; it is not a claim about native window-manager interaction.

No new dependency, test framework, screenshot baseline, or generated building was added. Existing check coverage was extended for first-callable appearance and 4K asset provenance/dimensions. Original build step 11's briefs and generation deferral remain unchanged.


Commits for this follow-up:

- `68ff2ba`: first-callable appearance persistence (`viewer/app/galaxy-memory.ts`, `checks/layout-identity-desktop.mjs`).
- `39c2eb6`: terrain tiers, fallback, sliced preparation and immediate warm reveal (`viewer/galaxy/planet-library.js`, `viewer/planet/planet.js`, `viewer/galaxy/constellation.js`, `viewer/towns/incremental-towns.js`, `viewer/town-pads.js`, `viewer/debug/town-debug.js`, `viewer/scene/scene3d.js`, `viewer/app/panels/PlanetInspector.tsx`, the importer, catalog/assets and asset check).
- `c7ebbde`: compact-town readability and bounded Display menu (`viewer/towns/towns.js`, `viewer/styles/planet-inspector.css`).

The 20k overview fixture consists of 20,000 real on-disk JS files with one short function each. It checks overview scale and detail isolation; it does not replace the large real-source project used for landing/edit/recovery measurements.

Final validation: build, typecheck, formatting and whitespace checks passed. The eight selected offline check groups passed. The four required Electron checks ran once on the final implementation and passed:

```text
node checks/town-pads-desktop.mjs
{"earth":20,"moon":8}
PASS: towns stand on level pads, on land, and keep their grid placements across a restart.

node checks/planet-handoff-desktop.mjs
[{"asset":"earth","meanAbsDiff":0.67,"pixels":96709},{"asset":"moon","meanAbsDiff":1.32,"pixels":96709}]
PASS: the close-up draws the orbital body with its own materials; the handoff leaves the ground unchanged.

node checks/source-index-desktop.mjs
PASS: exact source lookup, retained indexes, numbered recursion, async boundaries, paused paths and stale captures in Electron.

node checks/layout-identity-desktop.mjs
PASS: method/file rename, added method, restart and first callable keep the planet look and town anchors.
```

When returning to manual acceptance, compare 2K/4K terrain and debug mode from Display, inspect named compact towers in shade, and check the scrollable Display menu at a small window size. Then use the existing drag/undo and project/chat checklist above. No provider-backed chat inference was part of these checks.


## Follow-up: cold construction and edit frame budgets

Manual interaction acceptance remains deferred. This pass keeps the independent town/pad ownership contract and addresses work still happening on the renderer thread:

- Detailed natural-body sphere generation, relief displacement and seam normals now run in the cancellable planet worker. Typed vertex/index buffers transfer back without rebuilding the sphere on the UI thread. Orbital and landed geometry share the same CPU implementation in `viewer/galaxy/planet-surface.js`.
- Canonical town revisions and resolved call targets also run in the worker. Retained town lookup uses a map instead of searching every prior town for each region.
- Construction checkpoints use a 2 ms work budget. Cold construction uses Chromium's cooperative yield to avoid nested timer clamping; staged town edits yield through an animation frame before continuing. New town and pad groups are culled before their first draw. New labels are registered incrementally but remain gated until commit.
- Landing textures decode to ImageBitmaps before upload, preserving texture orientation and closing bitmap storage on disposal. Natural bodies, close-up ships, and the central scene's large props prepare textures/shaders before becoming visible. The latter were a significant hidden cost: the first landing flight brought the cannon, island, satellite and context buildings into the frustum together.
- The closed town finder no longer constructs its full hidden results list every time the inspector is recreated on an edit. Opening it still exposes the searchable method list.

The final timing run used a fresh isolated **246-file project**: **245 real source files / 58,816 lines**, plus the **300-town / 5,400-line stress file**. It ran in foreground Electron through `npm run desktop`, at 1440×859 CSS pixels and 2308×1390 drawing-buffer pixels. CPU profiles were collected in diagnostic runs; the final timing run had the CPU profiler disabled. These are observed samples, not a universal latency guarantee or a paired benchmark against the earlier profiled measurements.

| Final timing sample | Result |
|---|---|
| Real 68-town file, cold readiness / complete landing | 3.089 s / 3.329 s; longest task 122 ms |
| 300-town file, cold readiness / complete landing | 2.222 s / 3.903 s; longest task 72 ms |
| Real-file steady sample | 104 FPS; p95 16.7 ms; no tasks at or above 50 ms |
| 300-town idle / ships-active samples | 115 / 111 FPS; p95 10.3 / 15.7 ms; no tasks at or above 50 ms |
| Three edits, watch through publication | 1.078 / 0.990 / 0.971 s |
| Three edit p95 frame intervals | 16.8 / 16.7 / 17.1 ms; no tasks at or above 50 ms |
| Warm source reveal | 12.4 / 17.1 / 16.2 / 11.7 ms |

Each stress edit replaced only `town150`, retaining the other 299 renderers, all 300 pad owners, terrain and the natural body. The real-file edit replaced only `acceptThread` and retained 67 renderers. All 300 reservations remained disjoint, every physical pad corner stayed inside its reservation, and distribution remained 40 / 60 / 55 / 46 / 44 / 55 across the six grid faces. Numbered recursive stack paths, selected-town visibility, an outside-surface camera, debug restoration and the project/chat controls passed the automated larger-project exercise with no frame errors.

**Remaining performance work:** cold activation still has 72–122 ms long tasks, and edit p95 is near but not consistently below 16.7 ms. The initial overview warm-up also recorded a 68 ms task. Full cold-task and edit-frame budget compliance is not claimed. Manual drag/undo and hands-on visual acceptance remain for later.

Validation passed: `npm run typecheck`; formatting and whitespace checks; the existing planet-library, town-revision, planet-grid, source-index, layout-identity, planet-appearance and town-port-rig offline checks; and all four required Electron checks (`town-pads-desktop`, `planet-handoff-desktop`, `source-index-desktop`, `layout-identity-desktop`). Handoff image differences remained 0.67 for Earth and 1.32 for Moon. A targeted larger-project regression exercise also verified opening and selecting a town from the lazy finder, 2K/4K terrain switching and debug restoration, blocked-4K recovery, the one-world 4K limit, and compact-window Display scrolling. No new screenshot baseline was added.


## Follow-up: real Node/TypeScript execution

The first live runtime slice connects an owned Node Inspector session to the existing Monaco editor and exact town/building source index. Run and Debug is available in the activity bar. It launches an entry file in the active project, pauses on exceptions, preserves recursive frame identities and reported async boundaries, and supports Continue, Pause, Step Over/Into/Out and Stop. The main process owns the child, loopback Inspector socket and fixed command surface; preload exposes no arbitrary debugger evaluation.

All exceptions is the default because Node can route top-level ES-module failures through internally handled promises before terminating. Uncaught-only is an explicit launch option. A pause is evidence of an exception, not a claim that it is unhandled. Native erasable TypeScript is verified against Node's own stripping output. Compiled JavaScript supports local or inline source maps with embedded source text. A generated file changed since loading, a missing map/source, external code, or an ambiguous source location never receives a guessed building. The editor also compares captured text with its current buffer; unsaved edits count as a mismatch. Source/analysis revision checks remain in force when a planet builds or refreshes.

The sidebar reuses the existing Monaco/workbench implementation: SF system typography, quiet separators, compact exception summary, disclosure controls for launch details/output, and the selected-frame source/building actions above the stack. No decorative status dots or new assets were added. This introduced single-process launch; the next follow-up below adds authored breakpoints, paused property inspection and observed trace ships. Attach, expression evaluation, worker/child debugger sessions and complete execution-history tracing remain future work. The runtime uses Electron's embedded Node, so projects requiring another Node version or custom loaders need a later launch-configuration extension.

Verification: the new `checks/node-debug.cjs` exercises real Inspector exceptions (including top-level ESM), native TypeScript, recursion, async ancestry, compiler-produced source maps, stepping, immutable captured source, stop and old-session rejection. `checks/debug-desktop.mjs` copies more than 249 real source files plus a 302-town runtime fixture (over 62,000 total source lines), launches with `npm run desktop`, verifies editor highlights and exact building selection, rejects an edit made while paused, follows a real `createDebugRecord` failure across source files, and steps mapped TypeScript. Electron captures were visually inspected; they are temporary artifacts, not new screenshot baselines.

The four existing desktop checks passed: town-pads, planet-handoff, source-index and layout-identity. Typecheck/build passed. The full offline suite passed 37/40 checks; `chat-features.cjs` (missing image result), `country-roads.mjs` (undefined packing context) and `rigged-assets.mjs` (Vite worker import in Node) fail identically in an isolated export of starting commit `e632894`. Those pre-existing failures were not changed by this slice. Previous cold-construction/frame-budget limitations and deferred hands-on town-movement acceptance remain as recorded above.


## Follow-up: breakpoints, variables and execution ships

Run and Debug now supports editor-gutter/F9 breakpoint toggles and a toggle for the selected statement building. Breakpoints are kept per project for the app session and reinstalled on relaunch. Node confirms executable positions before a breakpoint is shown as verified; pending, stale-source and non-executable requests remain distinguishable. Compiled TypeScript binds through the existing embedded source maps, including before the entry module executes. No nearby source line is substituted. Building toggles use source columns/ranges so different statements on one line are not treated as the same building.

Paused frames expose local, closure/module/global scopes and `this`, with expandable property trees. Getter/setter descriptors are shown without invoking them; there is no arbitrary expression evaluation or variable mutation. Values belong to the selected invocation and pause. Resume/step immediately invalidates property handles, clears the UI, and rejects late requests; historical async frames explicitly have no live variables. “Inspect frame at building” selects the innermost paused invocation at that exact statement; recursive callers remain individually selectable in the stack. Property output and handle counts are bounded.

A breakpoint can use **Trace ship** mode: the Inspector captures its actual source location and resumes automatically. **Follow execution ship** follows those observations across towns/files. The existing ship asset parks above the exact source building or containing town, travels between observed endpoints, and is cleared on stop, source invalidation, or an unmapped location. Ship travel is interpolated, not evidence that intervening statements executed. This is tracepoint-based debugging and incurs Inspector pause/resume overhead; it is not an uninstrumented continuous profiler or a complete execution history. Rapid observations are coalesced for display. Selecting a different historical/caller frame does not move the ship to that caller as if it were executing.

The actual Electron large-project check includes more than 250 real source files, the original 302-town failure fixture, and a 303-town live module (over 66,000 source lines total). It verifies real breakpoint hits, Monaco markers/F9, `doubled = 14`, nested `value = 7`, getter avoidance, building-based toggle/inspection, tracepoints across two functions while the process stays running, a visible live ship, and stop cleanup. The final editor and ship captures were visually inspected. The native Inspector check also verifies mapped breakpoints, removal, stale-source rejection and expired handles. Typecheck/build and the four established Electron regressions pass. The offline suite remains 37/40 with the same three previously reproduced baseline failures listed above. No dependencies, test framework, screenshot baselines or unrelated `.claude/` files were added or changed.

Still outside this slice: persistent launch/breakpoint files across app restarts, conditional breakpoints, expression watches/assignment, attach, worker/child sessions, arbitrary custom loaders, and complete statement-by-statement execution recording. Prior renderer performance-budget limitations and deferred hands-on town-movement acceptance remain unchanged.


## Follow-up: town identity inheritance and evidence markers

Manual interaction acceptance remains deferred.

**Identity (I-3, §6).** `reconcileTowns` now handles the remaining reconciliation rules. Each town stores a bounded sketch: the 64 smallest distinct hashes of its normalised body lines, with the declared name blanked. After exact id and exact body matches:

- A removed town passes its layout to the new town sharing most of its sampled lines (a split's larger part).
- A new town that inherits from several removed towns keeps the earliest-born layout (a merge). The others stay removed with their own records, so undoing the merge restores both.
- A match needs at least two shared lines covering half of the smaller sample. A tied best match, or several identical removed bodies, inherits nothing.
- A town whose exact body matches one removed town in another file (or a town of a removed file) records `from` and is placed afresh. The old record is retired, so it cannot reappear in two places.

`checks/layout-identity.mjs` covers the split, merge and undo, edited rename, identical-body ambiguity and cross-file move cases.

**Evidence markers (I-7, §11).** `viewer/debug/evidence-markers.js` draws every non-frame record type in its own family. Each marker has a solid copy and a faint copy drawn through terrain and buildings, and is sized to the settlement unit (median deck short side / 10). No marker is wider than about 60% of its building. A selected marker on the far hemisphere gets a limb label. Records resolve only through the source index:

- stale, unmapped and ambiguous precise records stay listed without geometry;
- line-level records mark each statement on their line.

Producers:

- The Node runtime supplies breakpoints (moved out of `runtime-markers.js`) and, while paused, the current position plus any exception. The current position is selected on pause.
- Display → Debug evidence loads any JSON evidence, rejecting the whole file on any invalid record.
- "Git changes since the last commit" asks a new fixed main-process command (`gitChangedLines`, project-scoped, refusing paths outside the project) for changed lines. An untracked file counts as added. Git changes refetch for each new revision; loaded evidence goes stale.

Stack paths and the execution ship were still sized for the previous 3-unit pads and now use the same unit. The key lists the marker families.

Verification: typecheck, `layout-identity`, `layout-memory`, `source-index` and `call-routes` passed. Electron checks passed:

- `source-index-desktop`, extended with mixed evidence, statuses, mesh and colour counts, row selection, rejected files, git changes in a temporary repository, and staleness and refetch after an edit;
- `debug-desktop`, now asserting breakpoint and current-position markers and the paused selection;
- `layout-identity-desktop`, `town-pads-desktop`, `camera-desktop` and `planet-handoff-desktop` (0.83 / 1.40).

A probe confirmed marker scale against buildings and the far-side label in screenshots. The far-side label sits inside the silhouette of irregular small bodies, which are not spheres.

**Still open:**

- source-map navigation for generated/minified files on a landed planet;
- analyzer-failure and rapid project-switch recovery coverage;
- cold-construction long tasks;
- producers for tests, coverage, logs and profiles;
- step 11 building generation, which needs agreement on direction first.


## Follow-up: building style sheet, Mars and Mercury

**Building style sheet.** The user agreed the direction for step 11:

- buildings are silhouette-first;
- state is shown by whole-building transformations of 2–6 large rigid parts (rise, unfold, telescope, rotate); idle buildings are still;
- one sheet governs every role, and the earlier generated buildings are redone to it.

The order runs from a lineup concept, through the statement roles without models, the redone earlier buildings and the fixtures, to infrastructure last. `building-briefs.md` now holds the sheet, plus each statement role's transformation and expanded height. **No image or model was generated**; generation waits for a go-ahead.

**Mars and Mercury.** With the user's approval, two public-domain elevation models were downloaded into Perilune's sources:

- MOLA MEGDR 16 ppd: 33.2 MB, SHA-256 `d18d9b9a…`;
- USGS MESSENGER 665 m DEM: 531 MB, `defce776…`.

Perilune already had their albedo up to 4K. `scripts/import-perilune-planets.mjs` builds both worlds through the same tiers as the Moon:

- 128×64 / 1K / 4K heights over one metre datum per body;
- 2K and 4K normals derived from relief (slope factor fitted to the Moon's normals);
- roughness from albedo;
- 512×256 buildability.

Mercury's relief was a half-turn out from Perilune's albedo. Relief and albedo edges correlate at 0.23 only at a 1023/2048-pixel offset, so the importer rolls it; Mars correlates at 0.32 with no shift. Re-running the importer left Earth, Moon, Jupiter and Venus byte-identical.

Checks:

- `planet-library` covers six bodies, the 4K height sizes the check had missed, elevation provenance, and Mars landmarks (Olympus Mons u16 62009, Hellas 4659; the volcano is steeper than the northern plains);
- `planet-library-desktop` now lands on Mars and Mercury;
- `planet-handoff-desktop` now covers both: Earth 0.83, Moon 2.78, Mars 1.45, Mercury 2.41. The Moon's number rose from 1.40 only because rendezvous hashing now picks a different first Moon file;
- town-pads, layout-identity, planet-appearance and camera Electron checks passed. One layout-identity run timed out in its first landing, then passed twice.

## Follow-up: full-detail road cars and wheel repair

The four user-imported Tripo cars now drive the existing illustrative town roads:
courier, interceptor, utility rover and hauler. The original 89-part Blender import
is preserved, with a packed local snapshot under `.galaxy/vehicle-import/`.
`scripts/export-road-vehicles.py` prepares copies, separates the sheet, centers
and aligns each wheelbase, repairs small mesh boundaries, and atlases each body.
The original uneven wheels and three detached caps are replaced by round tires,
broad treads and cyan hub rings, with separate rolling/steering pivots. The ready
cars are also available in Blender's new `Road Vehicles - Ready` scene and the
local `.galaxy/vehicle-import/road-vehicles.blend` file.

Per the user's instruction, there are **no lower-detail versions or decimation**.
Full-car counts including four wheels are 19,230 / 23,596 / 26,704 / 24,594
triangles. Each design uses one body atlas/material and one shared wheel geometry
and material. `viewer/traffic/road-vehicles.js` instances the four designs in eight draw
batches, alongside the two existing emergency-car batches, and retains the 96-car
cap. Wheels roll by traveled distance and front wheels steer into the sampled
curve. Width fitting keeps wide pods inside the road. Failed car loads fall back
to the existing kit; resource ownership survives leaving and re-entering a planet.

The large-project close-up also exposed older placement/depth problems: fixed
world-space road/paint/car lifts were too large for tiny towns, radial vehicle
normals disagreed with level decks, and slope polygon bias drew planar roads
through nearby cars. Road layers and contact now share the town scale, cars use
the frame's normal, and planar deck frames use constant depth bias. Spherical
surface behavior and the `flat` flag's existing horizon/culling meaning remain
separate.

`checks/road-vehicles-desktop.mjs` launches **npm run desktop** against a 256-file,
65,853-line source copy with a 301-town file. It passed all four actual textured
asset loads, local wheel rolling, bounded instances, deck contact/orientation,
teardown/re-entry, and project/chat controls. Screenshots were inspected in the
actual Electron window. Repeated settled 120-frame samples with 14 active cars measured
8.3–16.6 ms median, 8.9–17.3 ms p95 and up to 17.6 ms maximum; these are particular
views, not a guarantee for 96 visible cars or cold-construction budgets. Captures/logs are temporary outputs,
not new screenshot baselines.

Typecheck/build and the town-roads check passed. The offline suite remains 37/40,
with the same recorded chat-features, country-roads and rigged-assets failures.
The existing town-pads, planet-handoff (Earth/Moon/Mars/Mercury), source-index and
layout-identity Electron regressions also passed.
This changes illustrative structural traffic; observed execution still uses the
separate debugger ship. Opening body panels, suspension articulation and other
vehicle mechanisms are not animated in this slice; the original separate parts
remain available in the Blender snapshot for that work.

## Follow-up: responsive planet entry and first GPU use

Profiling the actual Electron approach on the larger source project exposed
work that the earlier settled-frame samples did not cover:

- `planPads` classified all 884,736 cube-sphere cells on the renderer thread,
  including rotated water-mask and slope sampling. Unprofiled entry blocked for
  159 ms on the real 68-town file and 243–266 ms on the 301-town file.
- Town owners could draw while construction was still running, then hundreds
  of individually batched small towns could appear together. The stress-file
  approach produced repeated 150–219 ms render tasks and 300–325 ms frames.
- `compileAsync` prepared shaders but left geometry/instance buffers for the
  first visible draw. Large terrain attributes and car textures uploaded there.

Terrain suitability and deterministic settlement-center selection now run in a
cancellable worker with the same height field, rotation and land/buildability
rasters as the drawn terrain. Custom callback terrain retains a yielding path.
CPU construction yields through animation frames in four-millisecond slices.
Staged town/pad groups stay hidden until publication, with initial LOD/culling
already set. Distant towns use two shared marker batches; at most 12 visible,
nearby owners show their own buildings/roads. Selected towns take priority,
and exact source navigation awaits their GPU preparation. The markers represent
whole towns and do not invent statement/source mappings. Existing owner objects
and saved placement identities survive incremental revisions.

GPU preparation now spaces texture uploads and individual large terrain buffers
across frames, and performs zero-area warmup draws with the production screen
configuration before publishing meshes. Geometry resolution, attributes and the
four car models remain unchanged. Shared geometry still warms each mesh's own
instance buffers. Car publication waits for preparation; cancellation releases
pending batches.

`checks/planet-zoom-desktop.mjs` measures from before entry through construction,
landing and fleet readiness, without a CPU profiler. On the 258-file,
66,474-line source copy, the final four-millisecond construction run measured:

| Entry | Time to ready | Worst frame | Tasks of at least 50 ms |
| --- | ---: | ---: | ---: |
| Real 68-town file, cold | 4.49 s | 41.5 ms | 0 |
| 301-town file, cold | 8.50 s | 33.3 ms | 0 |
| 301-town file, repeat | 6.26 s | 33.2 ms | 0 |

These are measured views on this machine, not a 16.7 ms guarantee. Large files
still take seconds to construct, and repeat entry still rebuilds GPU owners;
this change removes the large approach freezes while keeping construction
responsive. The regression rejects tasks of 80 ms or more and frames of 100 ms
or more, and covers unique town representations, full-detail car preparation,
rapid cancellation and frame errors. Screenshots and raw traces are temporary
review outputs, not new pixel baselines.

Typecheck/build, worker suitability, full-detail road cars, town pads, four-world
handoff, source-index and layout-identity Electron checks passed. One repeat
layout-identity run timed out after method insertion and passed on rerun.
Temporary upload geometry also now has explicit bounds, avoiding warnings from
treating UV buffers as positions. The offline suite remains 37/40 with
the existing chat-features, country-roads and rigged-assets failures.

## Follow-up: landed source-map navigation (local changes)

The checkout started this continuation at `9361cf5`, including the previously
completed car and responsive-entry changes. The handoff's earlier Git and
performance snapshot was not treated as current. No commit, push, PR, download,
image generation or 3D generation was performed in this continuation.

**Navigation (§9, I-6).** Method and statement inspectors now offer **Open
source**. A generated statement's precise column resolves through a local or
inline source map and opens its authored location in Monaco. The editor's
**Reveal Source in Landed World** command (context menu / command palette) resolves the current authored
point back into the currently landed generated planet. A round trip retains the
particular generated statement that was opened, even if the compiler assigned
several generated positions to its authored point. Moving to another authored
point uses the reverse map and requires exactly one generated position. Ambiguous
or unmapped positions leave the prior world selection intact. Declaration-only
positions can select their exact town without inventing a statement building.

`engine/workspace/source-navigation.cjs` uses Node's built-in source-map consumer
behind a fixed preload/main-process capability. Every read goes through the
existing workspace containment, UTF-8 and size checks, including symlink
containment. Map references and source roots cannot grant access to the network
or another project. Maps are read afresh, with a 2 MB limit and a 100,000-segment
reverse-navigation cap. The generated snapshot must match disk; embedded authored
text must match the workspace file and current editor buffer. Project/view or
analysis changes cancel pending selection. Source navigation does not overwrite
Monaco text, undo history, or a later debugger cursor reveal. Unsaved edits replace
the editor's exact-source notice with a stale-source message.

**Supported scope and limits.** This covers regular local/inline version 3 maps,
including compiler-produced TypeScript maps, with embedded `sourcesContent` and
authored files present in the same workspace project. Missing embedded text is
reported as unverified. Missing/broken maps, missing sources, duplicate source
identities, external/virtual URLs, indexed maps and stale snapshots do not select
guessed source or geometry. Chained maps and opening embedded-only virtual
documents are still open. Reverse navigation accepts exact authored mapping
points; it does not interpolate arbitrary cursor columns. This does not rewrite
analyzer source ranges or add new evidence producers.

**Electron review.** `checks/source-map-desktop.mjs` launches through **npm run
desktop** against a 264-file source copy (64,946 lines), including a generated
file with 802 statements on one line. It opened statement `v400` at authored
line 402, column 3, returned to the same generated element, moved the editor to
the next authored statement and revealed that different generated element.
Removing/restoring the map kept the existing world usable; an unsaved edit could
not choose another building. Editor, selected-building and project/chat-control
screenshots were inspected in the actual Electron window. Captures are temporary
review artifacts, not new screenshot baselines. The final artifact directory is
`/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-source-map-DtlfG1`.

Targeted checks only; no full suite was run. Exact final output/verdict lines:

```text
npm run typecheck
> codebase-viz@0.1.9 typecheck
> tsc -p .

npm run build
✓ built in 1.07s

node checks/workspace-files.cjs
Source navigation: local/inline maps, exact columns, reverse ambiguity, stale sources, unverified revisions and workspace containment passed.
Source navigation: compiler-produced TypeScript source map passed.
Workspace files: lazy tree, natural sort, UTF-8/CRLF/BOM, permissions, conflict detection, scope, binary/size limits and file watching passed.

node scripts/run-checks.mjs source-index
pass  source-index.mjs  (0.2s)

1/1 checks passed.

node checks/source-map-desktop.mjs
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-source-map-DtlfG1","files":264,"lines":64946,"statements":802}
PASS: 802 single-line statements, mapped editor/building round trip, exact columns, missing-map recovery, unsaved-source rejection and project/chat controls in Electron.

node checks/source-index-desktop.mjs
PASS: exact source lookup, retained indexes, numbered recursion, async boundaries, paused paths, stale captures, evidence marker families and git changes in Electron.

node checks/debug-desktop.mjs
PASS
```

Build output above is its final summary line; the debug check also emitted its
existing analyzed-project, pause, building and trace inspection records. Full
temporary logs are `/tmp/source-navigation-build-verified.log`,
`/tmp/source-map-index-regression.log` and `/tmp/source-map-debug-regression.log`.

**Still open:** analyzer-failure and rapid project-switch recovery coverage;
broader cold-task/edit-frame budget compliance (latest entry measurements are in
the preceding follow-up); test/coverage/log/profile producers; the source-map
format/virtual-source extensions above; and step 11 building generation, which
still requires explicit approval. Manual drag/undo acceptance remains deferred.

## Follow-up: preserve call routes across town LOD (local changes)

The responsive-entry cap had coupled semantic visibility to full town meshes.
`isVisible(k)` still means a detailed town is drawn, so traffic and mesh work stay
bounded. A separate cached `isInView(k)` now describes camera/frustum/horizon
visibility. Call routes use that test: a route touching either in-view town stays
drawn even when both towns use summary blocks. External endpoint selection and
the 12-detailed-town cap are unchanged. Pausing illustrative ships keeps the
lines visible.

Evidence moves between its exact building anchor and the actual summary block's
top as LOD changes. Summary labels say "Town overview"; record/source identities,
exact/stale/unmapped statuses and marker families are preserved. Overview colours
and block dimensions are cached rather than allocating colours per town per
frame. Explicit source navigation promotes its town ahead of queued background
town GPU preparation; the current upload completes first, without concurrent
bulk uploads.

The worker's failed-4K path now uses the same detailed fallback heights and size
as `planetSurfaceRadius`, rather than always falling back to the orbital 128×64
field. Blocking Earth's close height file in Electron confirmed both paths use
the same 1024×512 buffer. The permanent **Reveal in world** breadcrumb button
was removed; the editor action remains in its menu/command palette. The larger
source-map check invokes it through Monaco's actual F1 command palette.

**Verification.** Five fresh foreground `planet-zoom-desktop` runs passed, with
no observed tasks at or above 50 ms and worst cold/repeat frames of 25–35 ms.
The reported intermittent failure was not reproduced, and no timing guard was
weakened. A failure now saves `failure.json` with phase, full assertion/stack,
actual/expected values, raw tasks/frames, viewport/focus and runtime state. The
last console line names the failing assertion and artifact directory, so a
truncated stack no longer loses the diagnosis.

The final larger source copy contained 261 files / 67,369 lines, including the
301-town stress case. The real file was the 68-town
`viewer/app/codex-chat.ts`, with 177 inter-town calls plus recursive and external
routes. The regression checks several settlement distances against the towns
actually represented by detailed meshes or summary batches. At the widest tested
view there were 12 detailed and 47 simplified towns, including 42 calls between
distinct simplified towns; none disappeared. All 179 eligible in-view
town/recursive routes were drawn. The 208 total drawn routes also include 29
selected-town external/unresolved routes. Evidence was checked on a summary
block and then on its exact detailed building. Actual Electron screenshots,
including the settlement graph, were inspected; no new pixel baseline was added.
Final artifacts: `/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-A8my05`.

Exact final output/verdict lines (build output is its final summary line):

```text
npm run typecheck
> codebase-viz@0.1.9 typecheck
> tsc -p .

node scripts/run-checks.mjs planet-grid call-routes source-index
pass  source-index.mjs  (0.2s)
pass  planet-grid.mjs  (0.7s)
pass  call-routes.mjs  (0.2s)

3/3 checks passed.

npm run build
✓ built in 1.13s

node checks/planet-zoom-desktop.mjs
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-A8my05","files":261,"lines":67369}
{"name":"cold-real","duration":4564.699999988079,"maxTask":0,"maxFrame":33.30000000000018,"asset":"moon","detailed":9,"overview":2}
{"name":"settlement-review","detailed":12,"simplified":47,"total":307,"localTotal":177,"visible":208,"expected":179,"lost":[],"betweenSummaries":42,"lostBetweenSummaries":0,"markerScope":"town"}
{"name":"cold-301","duration":8950.199999988079,"maxTask":0,"maxFrame":33.30000000000291,"asset":"mars","detailed":6,"overview":3}
{"name":"repeat-301","duration":6742,"maxTask":0,"maxFrame":26.200000000000728,"asset":"mars","detailed":5,"overview":3}
{"name":"terrain-fallback","asset":"earth","size":[1024,512],"expected":[1024,512],"usesDetail":true}
PASS: cold/repeat zoom, bounded town rendering, GPU publication, cancellation. Artifacts: /var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-A8my05

node checks/source-map-desktop.mjs
PASS: 802 single-line statements, mapped editor/building round trip, exact columns, missing-map recovery, unsaved-source rejection and project/chat controls in Electron.

node checks/source-index-desktop.mjs
PASS: exact source lookup, retained indexes, numbered recursion, async boundaries, paused paths, stale captures, evidence marker families and git changes in Electron.

node checks/debug-desktop.mjs
PASS

node checks/layout-identity-desktop.mjs
PASS: method/file rename, added method, restart and first callable keep the planet look and town anchors.
```

`npm run build` passed before desktop verification; each larger zoom/source-map
run also launches through `npm run desktop` and rebuilds. One debugger regression
run timed out while revealing a caller; its rerun passed all phases. The cause
was not established. That check now saves its actual UI/runtime failure state
as well. The full offline suite was not run.

**Still open:** a placement run still starts a worker and clones its terrain
sampling data (about 24 MB for Earth); worker/data reuse is not implemented here.
The earlier intermittent zoom failure remains unconfirmed pending a captured
assertion. The broader recovery, edit-frame-budget, producer and source-map-format
work listed above remains open, and manual interaction/building generation stay
deferred. All changes, including the source-map slice, remain uncommitted on
`layout-identity`; no push or PR was made.


## Resident terrain classification worker — uncommitted follow-up

A landed planet and its staged edits now lease one lazy terrain classification
worker (`viewer/pad-terrain-session.js`). The first classification clones the
immutable height, land and buildability buffers once; later placement requests
send only their centre, anchors, dimensions and suitability thresholds. The
worker also retains the prepared relief sampler, avoiding its full height-field
peak scan on every classification. Renderer/library buffers are never detached.
Other construction workers remain one-shot jobs.

Reuse requires identical buffer/mask identities, dimensions, relief metadata,
peak and inverse orientation. Changed sampling or a failed worker creates a new
session on the next build. Each host releases its own lease: a cancelled or failed
staged edit cannot dispose the visible world's sampler, publication retires the
old lease, and leaving/project replacement terminates the final owner's worker.
Construction failures release their lease even before an inspection API exists.
Request IDs isolate replies; abort rejects promptly, removes queued cancelled
work, and discards the result of an already-running synchronous classification.
A running scan finishes in the worker before the next request, without publishing
the cancelled result. No global worker pool, SharedArrayBuffer or new dependency
was introduced.

Verification used the existing larger project copy (263 source files, 67,684
lines, plus the 301-town stress input already counted in that total). Real
68-town `codex-chat.ts` landing and wider-settlement route checks passed. Two
actual watched edits on Earth's `checks/galaxy-layout.mjs` add/replace an exported
function, forcing placement classification rather than its unchanged-footprint
shortcut. Initial classification plus both edits kept the same worker and one
25,296,896-byte sampling upload. Each published edit had one remaining lease;
the 16,777,216-byte renderer height field stayed attached. Active and queued
abort requests returned AbortError, an active cancelled reply was discarded,
the following classification succeeded, and final exit reported disposed=true,
references=0. Actual Electron screenshots (including `terrain-worker-edits.png`)
were inspected in the artifact directory below.

Exact final outputs:

```text
npm run build
✓ built in 1.20s

npm run typecheck
> codebase-viz@0.1.9 typecheck
> tsc -p .
(exit 0)

node checks/pad-terrain-session.mjs
PASS: resident terrain worker reuse, cancellation, ownership, invalidation and failure cleanup

node scripts/run-checks.mjs planet-grid
pass  planet-grid.mjs  (0.7s)

1/1 checks passed.

node checks/planet-zoom-desktop.mjs
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-o12va3","files":263,"lines":67684}
{"name":"cold-real","duration":4516.099999964237,"maxTask":0,"maxFrame":33.399999999999636,"asset":"moon","detailed":9,"overview":2}
{"name":"settlement-review","detailed":12,"simplified":47,"total":307,"localTotal":177,"visible":208,"expected":179,"lost":[],"betweenSummaries":42,"lostBetweenSummaries":0,"markerScope":"town"}
{"name":"cold-301","duration":9273.300000011921,"maxTask":0,"maxFrame":25,"asset":"mars","detailed":7,"overview":2}
{"name":"repeat-301","duration":6958,"maxTask":0,"maxFrame":33.39999999999782,"asset":"mars","detailed":5,"overview":3}
{"name":"terrain-fallback","asset":"earth","size":[1024,512],"expected":[1024,512],"usesDetail":true}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":1,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":2,"completed":2,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":0,"maxFrame":58.30000000000291}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":2,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":3,"completed":3,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":0,"maxFrame":41.80000000000291}
{"name":"terrain-worker-cancellation","a":"AbortError","b":"AbortError","center":[0.5207980298409286,0.5528712498509386,0.6504635218073866],"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":6,"completed":4,"cancelled":2,"discarded":1,"references":1,"disposed":false,"pending":0}}
PASS: cold/repeat zoom, bounded town rendering, GPU publication, cancellation. Artifacts: /var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-o12va3
```

The first extended check failed because the harness read the asynchronous
sourceContext as a synchronous object. After that fix, the next run passed worker
reuse/edits/cancellation but failed its deliberately blocked-4K assertion: the
new Earth edit phase had already populated the asset cache. Moving the blocked
fallback phase before the full-resolution Earth phase fixed this test-order
error; the final run above passed. Earlier repeat-301 runs recorded 68–79 ms long
tasks and 75–92 ms maximum frames; their existing regression guards passed. The
final run recorded no longtask entries (maxTask=0 means none at least 50 ms),
but edit maximum frames of 58.3 and 41.8 ms still exceed 16.7 ms. This change
removes repeated worker startup/data copies, not every remaining frame spike.
Final build/typecheck and git diff --check passed. No full suite or deferred
manual interaction checks were run.

**Still open:** broader cold/steady/edit frame-budget work, recovery coverage,
additional evidence producers and source-map format support remain as described
above. Building generation and manual interaction acceptance remain deferred.
The worker/data reuse item from the preceding section is now implemented.
All changes remain local on `layout-identity`; no commit, push or PR was made.


## Compact loading feedback — uncommitted follow-up

Initial workspace/scene loading, view regrouping and first planet construction
now show a small status card in the upper-right scene corner with a thin
indeterminate progress bar and the current phase. In response to “less invasive,”
the centred overlay/scrim was removed: there is no dimming, focus trap, modal,
input interception or additional toolbar control. The indicator is at most 240px
wide and has pointer-events:none; the existing System action and Escape still
handle leaving. Its animation respects prefers-reduced-motion. Duplicate initial
“Loading surface” text was removed from the left-hand planet controls.

`viewer/app/scene-loading.ts` gives each load an ownership token. Old completion,
errors and cancellation cannot dismiss a newer load's status. Scene construction
gets a paint before synchronous layout, and the indicator is dismissed after the
new scene has had a paint opportunity. Initial planet phase text follows actual
source, terrain, town/road and selected-town preparation; staged edits keep their
existing last-valid-world update notice instead of showing first-load UI.
There is no invented percentage or artificial minimum loading duration.

Verification: build/typecheck and git diff --check passed. The scratch Electron
check used the existing 263-file larger-project fixture; a controlled 2.5-second
graph response delay allowed capture of actual scene-loading feedback. It checked
planet phases, indicator bounds below 100px height and at most 240px width,
pointer-events:none, ready dismissal, exit and replacement behavior, frame errors,
and the presence of project/chat controls. Real scene-loading and planet-loading
screenshots were inspected. The initial scratch reload probe raced dismissal;
it was replaced with the controlled same-project request. A second assertion
incorrectly expected exitPlanet to close immediately; it now waits for the
existing outward flight/close behavior. Neither scratch failure established an
application defect.

The first zoom regression attempt, before the compact revision, recorded a
215ms task and 225.1ms frame during cold-real; its cause was not established.
The final run with the compact indicator passed without changing thresholds,
including new durable checks for immediate loading visibility, ready dismissal,
and dismissal after leaving. Existing route, evidence, fallback, terrain-worker
reuse and cancellation checks also passed. Edit maximum frames remain 50ms in
this run, so the broader 16.7ms frame target remains open.

Exact final outputs:

```text
npm run build
✓ built in 1.44s

npm run typecheck
> codebase-viz@0.1.9 typecheck
> tsc -p .
(exit 0)

node /tmp/scene-loading-check.mjs
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-loading-ILjqdj","phases":["Reading viewer/app/codex-chat.ts…","Preparing terrain…","Placing towns and connecting roads…","Preparing the selected town…"],"controls":{"project":true,"chats":true,"files":263}}
PASS: scene loading, planet phases, ready dismissal, exit cancellation and superseded loads in larger-project Electron.

node checks/planet-zoom-desktop.mjs
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-AiDm35","files":264,"lines":67735}
{"name":"cold-real","duration":4667.899999976158,"maxTask":0,"maxFrame":33.30000000000018,"asset":"moon","detailed":9,"overview":2}
{"name":"settlement-review","detailed":12,"simplified":47,"total":307,"localTotal":177,"visible":208,"expected":179,"lost":[],"betweenSummaries":42,"lostBetweenSummaries":0,"markerScope":"town"}
{"name":"cold-301","duration":10034,"maxTask":0,"maxFrame":33.29999999999927,"asset":"mars","detailed":5,"overview":4}
{"name":"repeat-301","duration":7785.799999952316,"maxTask":0,"maxFrame":26,"asset":"mars","detailed":6,"overview":2}
{"name":"terrain-fallback","asset":"earth","size":[1024,512],"expected":[1024,512],"usesDetail":true}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":1,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":2,"completed":2,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":0,"maxFrame":50}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":2,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":3,"completed":3,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":0,"maxFrame":50}
{"name":"terrain-worker-cancellation","a":"AbortError","b":"AbortError","center":[0.5207980298409286,0.5528712498509386,0.6504635218073866],"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":6,"completed":4,"cancelled":2,"discarded":1,"references":1,"disposed":false,"pending":0}}
PASS: cold/repeat zoom, bounded town rendering, GPU publication, cancellation. Artifacts: /var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-AiDm35
```

No full suite, downloads or generation ran. Manual interaction acceptance and
the previously listed performance/recovery/producer work remain open. This
loading-feedback change remains local on `layout-identity`; no new commit, push
or PR was made.


## Planet-relative settlement fit — uncommitted follow-up

The fixed town-side/scale cap and settlement-radius cap have been replaced by a
single dimensionless fit policy in `source-model/settlement-fit.js`. It solves
one common town scale with rims and grid spacing included, up to a packed-area
radius of 0.4 planet radii. Individual ordinary decks stay below 0.15 radians
(8.6 degrees) so increasing settlement coverage does not create giant flat
slabs across the planet. `PLANET_R=10` remains only a renderer coordinate unit:
the focused offline check proves that radii 1 and 10 produce identical angular
proportions. Changing the numeral alone would not change the composition.

File entry now frames the actual deck/building bounds with the current camera
FOV and aspect ratio. Selecting a method frames that method's own extent;
explicit source-line/statement navigation still approaches its exact location.
Display → Settlement overview returns to the complete fitted file view. No new
primary toolbar action was added. The terrain's fine-ring count is bounded as
the settlement grows so broader coverage does not multiply GPU uploads.

Recipe 4 migrates automatic placements once. It retains the prior settlement's
bearing, re-addresses old pins on their correct 96/384 grids, and preserves pin
orientation. The resulting centre and scale are persisted. Valid unchanged
footprints no longer move because a new grid-shear estimate requests one extra
reserved cell. The stored unit centre retains its exact components across edits;
normalizing it again changed the last floating-point bits and invalidated
otherwise unchanged placement records. Invalid centre metadata rejects the
layout through the existing recovery path. Pin ownership now survives every
terrain-placement retry, and valid migrated pins save recipe 4. A pin whose
expanded footprint is invalid keeps its original saved pin and is explicitly
unresolved; it is never silently downgraded to an automatic placement.

Actual larger-project before/after probes used the same 263-file fixture and
viewport. The measured furthest-deck angular radius changed as follows:

| File | Towns | Before | After | Unresolved after |
|---|---:|---:|---:|---:|
| viewer/app/codex-chat.ts (Moon) | 68 | 0.384864 rad (22.1°) | 0.744312 rad (42.6°) | 0 |
| RoadTraffic.ts (Mars) | 301 | 0.638909 rad (36.6°) | 0.762321 rad (43.7°) | 0 |

Before/after actual Electron captures were inspected at:
`/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-fit-before-VMBvXF`
and
`/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-fit-after-93s4gq`.
Each directory contains real/stress entry and identical-distance globe views.
The new entry view shows the complete settlement, rather than starting inside
one method. Distant towns still use the existing summaries and become detailed
when approached; no new building assets were generated.

The durable larger-project check copies the current 266-file, 67,926-line source
fixture. It now checks the recipe, ordinary-deck angular bound, every deck's
projected corners fitting inside the entry viewport, no unresolved towns in the
two large fresh cases, and exact retained placements/scale through watched edits.
Call routes remain visible across town LODs. The prior terrain-worker reuse and
loading-indicator checks still pass. Maximum cold/repeat frames in this run were
34.9ms; edit maximum frames were 50ms and 33.3ms. maxTask=0 means no longtask
entries of at least 50ms, not no work. The steady 16.7ms target remains open.

The first restart run exposed a saved footprint being needlessly enlarged by a
new shear estimate; the corrected pad/restart check passed. An added strict edit
comparison then exposed the unit-centre normalization's last-bit drift; the
corrected focused edit probe and full zoom check passed. The first shortened
scratch edit probe omitted the zoom observer setup and failed in the harness;
that was corrected without product changes. The pin migration probe exposed
pin ownership being lost during multiple allocation passes; the product now
retains it independently of retry count. The real Moon pin was correctly found
invalid for its expanded footprint after that correction, and stayed unresolved
at its saved direction. A separate explicitly flat Jupiter fixture verified the
valid-pin path, persisted recipe and exact re-entry. Those are automated seeded
pin checks, not the deferred hands-on drag/undo acceptance.

Exact outputs:

```text
npm run build
✓ built in 1.18s

npm run typecheck
> codebase-viz@0.1.9 typecheck
> tsc -p .
(exit 0)

node checks/settlement-fit.mjs
PASS: planet-relative fit at 1/8/68/301 towns, curvature limits, coordinate invariance, persisted scale and layout schema

node scripts/run-checks.mjs layout-memory layout-identity planet-grid source-index
pass  layout-identity.mjs  (0.3s)
pass  layout-memory.mjs  (0.1s)
pass  source-index.mjs  (0.2s)
pass  planet-grid.mjs  (0.7s)

4/4 checks passed.

node checks/town-pads-desktop.mjs
{"earth":20,"moon":8}
PASS: one compact settlement of level decks, on land, cut into the drawn ground; placements survive a restart.

node checks/layout-identity-desktop.mjs
PASS: method/file rename, added method, restart and first callable keep the planet look and town anchors.

node checks/planet-zoom-desktop.mjs
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-Lmp7QP","files":266,"lines":67926}
{"name":"cold-real","duration":5032.699999988079,"maxTask":0,"maxFrame":34.900000000000546,"asset":"moon","detailed":1,"overview":67}
{"name":"cold-real-fit","recipe":4,"angle":0.7443121915445239,"maxSide":0.14999999999210134,"maxX":0.3467881600585522,"maxY":0.5095233183948223,"unresolved":0}
{"name":"settlement-review","detailed":12,"simplified":23,"total":307,"localTotal":177,"visible":181,"expected":152,"lost":[],"betweenSummaries":13,"lostBetweenSummaries":0,"markerScope":"town"}
{"name":"cold-301","duration":9811,"maxTask":0,"maxFrame":33.29999999999927,"asset":"mars","detailed":1,"overview":300}
{"name":"cold-301-fit","recipe":4,"angle":0.7623212549668595,"maxSide":0.03842487362655941,"maxX":0.3510317500649099,"maxY":0.5680115664497465,"unresolved":0}
{"name":"repeat-301","duration":7553.5,"maxTask":0,"maxFrame":34.89999999999782,"asset":"mars","detailed":1,"overview":300}
{"name":"repeat-301-fit","recipe":4,"angle":0.7623212549668595,"maxSide":0.03842487362655941,"maxX":0.35103175006489024,"maxY":0.5680115664497303,"unresolved":0}
{"name":"terrain-fallback","asset":"earth","size":[1024,512],"expected":[1024,512],"usesDetail":true}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":1,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":2,"completed":2,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":0,"maxFrame":50}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":2,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":3,"completed":3,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":0,"maxFrame":33.299999999995634}
{"name":"terrain-worker-cancellation","a":"AbortError","b":"AbortError","center":[0.5296604311134477,0.5660000000000001,0.6317466483589101],"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":6,"completed":4,"cancelled":2,"discarded":1,"references":1,"disposed":false,"pending":0}}
PASS: cold/repeat zoom, bounded town rendering, GPU publication, cancellation. Artifacts: /var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-Lmp7QP

node /tmp/settlement-fit-migration.mjs
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-fit-migration-yooHGf","key":"t:viewer/app/codex-chat.ts#chatStore.get:method","angle":0.0018416318419429052,"status":"unresolved","place":{"recipe":4,"settlementCenter":[0.3012870509001175,0.9172357110385245,0.2605854242960692],"overflow":false,"face":2,"i":299,"j":157,"orientation":0,"w":11,"h":12,"scale":0.03211991434520371,"width":0.2633832976306704,"height":0.29871520341039454},"normal":[0.44161193927110537,0.8909000719687048,0.10618830848718934],"recipes":[4],"towns":68,"notes":["Updated automatic town placement to fit the planet. Pinned town directions were preserved.","A saved town pin is unresolved. Move it to a valid footprint using Display."],"flat":false,"persistedPin":3,"reentryExact":true}
PASS: recipe-3 migration preserves a manual pin direction and the Display settlement overview works in larger-project Electron.

FIT_FLAT_PIN=1 node /tmp/settlement-fit-migration.mjs
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-fit-migration-6ay3pa","key":"t:viewer/app/codex-chat.ts#chatStore.get:method","angle":0.0018416318419429052,"status":"pinned","place":{"recipe":4,"settlementCenter":[0.3012870509001175,0.9172357110385245,0.2605854242960692],"overflow":false,"face":2,"i":299,"j":157,"orientation":0,"w":11,"h":12,"scale":0.03211991434520371,"width":0.2633832976306704,"height":0.29871520341039454},"normal":[0.44161193927110537,0.8909000719687048,0.10618830848718934],"recipes":[4],"towns":68,"notes":["Updated automatic town placement to fit the planet. Pinned town directions were preserved."],"flat":true,"persistedPin":4,"reentryExact":true}
PASS: recipe-3 migration preserves a manual pin direction and the Display settlement overview works in larger-project Electron.
```

The Display action was exercised through its real Electron control. Build,
typecheck and git diff --check passed. No full suite, downloads or image/3D
generation ran. Broader frame-budget, recovery and producer work remains open;
manual drag/undo acceptance remains deferred. Loading feedback and this fit
change remain uncommitted on `layout-identity`. No push or PR was made.


## Terrain, pad edges and building bases — 2026-10-18 (local continuation)

The requested loading indicator and planet-fit changes were committed and pushed
on `layout-identity` as `4fa2993f1c8e225115ddbf347f0eab5c12523a75`.
The terrain-contact changes described here are included in the user-authorized terrain-fix commit on `layout-identity`.

### Cause and change

Actual rendered-triangle probes reproduced terrain crossing 3 pads in the real
68-town `codex-chat.ts` settlement and 14 in the 301-town stress settlement.
Maximum protrusions were 0.0020041346091392853 and 0.004381869400257088
local units; maximum land gaps were 0.022314674481467733 and
0.01641178305622759. This baseline used the previously built `4fa2993` renderer
with diagnostic acceptance assertions disabled; it is not an acceptance pass.
Analytic queries and existing-vertex tests had missed triangle interiors bridging
pad cut boundaries. Fine sampling also stopped at the old 0.3-radian cap.

`viewer/terrain-contact.js` now splits terrain triangles at the radial planes of
pad edges in the surface worker. Shared intersections are cached, resampled from
the same relief/cut function, and normals are rebuilt after splitting. A spatial
index bounds construction work. Fine sampling covers the entire settlement.
The 301-town mesh grew from 801,792 to 812,272 triangles (about 1.3%); no per-frame
terrain construction was added. Land cuts use a constant offset along the pad
normal (0.008 local units at radius 10), inside the 0.012-thick pad lip. Offshore
cuts remove intruding terrain without filling the seabed. The same construction
supports 4K, 1K fallback and flat relief. A changed sampling-field identity now
invalidates the cut signature so a retained body receives a rebuilt surface on
1K-to-4K recovery even when pad elevations are unchanged.

The new Electron check independently intersects actual rendered triangles,
including near-edge and corner interiors, and checks building-base footprints.
It does not simply reuse analytic ground queries. Existing building meshes were
already normalized at their bases; no blanket upward building offset was needed.
Across Moon (68 towns), Mars (301), Earth (19) and Mercury (30), 10,450 pad rays
and 19,728 building-base samples had zero missing hits or terrain penetrations.
Land contact stayed at approximately 0.008 units below the pad plane. All four
worlds also passed with 4K deliberately blocked; a watched edit after unblocking
verified replacement of both sampler and surface geometry at recovered 4K.

### Checks and exact outputs

Build and typecheck exited 0. Build emitted the existing plugin-timing advisory.
The desktop checks launch the product through `npm run desktop`; the final
visual-only capture reused that build in Electron. No full suite ran.

```text
npm run build
✓ built in 3.09s
```

```text
npm run typecheck
> codebase-viz@0.1.9 typecheck
> tsc -p .
```

```text
node checks/terrain-contact.mjs
{"samples":75,"maxAbove":-0.0007999727895053876,"maxGap":0.0008000248609740801}
PASS: triangle interiors meet pad edges, including coarse terrain, longitude seam, polar cap and offshore ceiling
```

```text
node checks/terrain-contact-desktop.mjs
{"name":"real-68","file":"viewer/app/codex-chat.ts","towns":68,"vertices":384045,"triangles":765882,"samples":1700,"missing":0,"buildingSamples":2169,"minBuildingClearance":0.010151247958829046,"maxAbove":-0.00799919710316388,"maxLandGap":0.007999920506557956,"penetrating":0,"worst":[{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#bridgeFor:function","k":5,"offshore":false,"maxAbove":-0.00799919710316388,"maxGap":0.007999743506752921},{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#setEffort:function","k":42,"offshore":false,"maxAbove":-0.00799919945159111,"maxGap":0.007999794156877016},{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#refresh:function","k":24,"offshore":false,"maxAbove":-0.007999200927239158,"maxGap":0.007999765138436032},{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#threadOf:function","k":57,"offshore":false,"maxAbove":-0.007999230459434514,"maxGap":0.007999779741982849}]}
{"name":"stress-301","file":"RoadTraffic.ts","towns":301,"vertices":408318,"triangles":812272,"samples":7525,"missing":0,"buildingSamples":16254,"minBuildingClearance":0.009306237363231773,"maxAbove":-0.007999396471872089,"maxLandGap":0.008000554664358006,"penetrating":0,"worst":[{"key":"f:RoadTraffic.ts#t:RoadTraffic.ts#town76:function","k":274,"offshore":false,"maxAbove":-0.007999396471872089,"maxGap":0.007999986450506924},{"key":"f:RoadTraffic.ts#t:RoadTraffic.ts#town65:function","k":262,"offshore":false,"maxAbove":-0.007999408312638678,"maxGap":0.007999952445048919},{"key":"f:RoadTraffic.ts#t:RoadTraffic.ts#town64:function","k":261,"offshore":false,"maxAbove":-0.007999432450457533,"maxGap":0.007999853408673374},{"key":"f:RoadTraffic.ts#t:RoadTraffic.ts#town54:function","k":250,"offshore":false,"maxAbove":-0.007999434471649636,"maxGap":0.007999831019342096}]}
{"name":"earth","file":"checks/galaxy-layout.mjs","towns":19,"vertices":384952,"triangles":768494,"samples":475,"missing":0,"buildingSamples":234,"minBuildingClearance":0.014256998839377033,"maxAbove":-0.007999799961359244,"maxLandGap":0.008000442780359052,"penetrating":0,"worst":[{"key":"f:checks/galaxy-layout.mjs#t:checks/galaxy-layout.mjs#arms.map callback 1:function","k":2,"offshore":false,"maxAbove":-0.007999799961359244,"maxGap":0.00800026077878968},{"key":"f:checks/galaxy-layout.mjs#t:checks/galaxy-layout.mjs#pushed.centers.forEach callback 1:function","k":1,"offshore":false,"maxAbove":-0.007999804131131327,"maxGap":0.008000282032451622},{"key":"f:checks/galaxy-layout.mjs#t:checks/galaxy-layout.mjs#assert.deepEqual callback 1:function","k":3,"offshore":false,"maxAbove":-0.007999808036869283,"maxGap":0.008000151719288695},{"key":"f:checks/galaxy-layout.mjs#t:checks/galaxy-layout.mjs#clear:function","k":9,"offshore":false,"maxAbove":-0.007999852728232781,"maxGap":0.008000390679089975}]}
{"name":"mercury","file":"checks/town-roads.mjs","towns":30,"vertices":384788,"triangles":768322,"samples":750,"missing":0,"buildingSamples":1071,"minBuildingClearance":0.010749949880356269,"maxAbove":-0.007999751128627608,"maxLandGap":0.008000511890196904,"penetrating":0,"worst":[{"key":"f:checks/town-roads.mjs#t:checks/town-roads.mjs#roadScene:function","k":21,"offshore":false,"maxAbove":-0.007999751128627608,"maxGap":0.008000276599030798},{"key":"f:checks/town-roads.mjs#t:checks/town-roads.mjs#layout:function","k":17,"offshore":false,"maxAbove":-0.007999753643810337,"maxGap":0.008000294077730175},{"key":"f:checks/town-roads.mjs#t:checks/town-roads.mjs#arrowTrips[1].flatMap(p => p.visits).some callback 1:function","k":5,"offshore":false,"maxAbove":-0.0079997673898351,"maxGap":0.008000349467108592},{"key":"f:checks/town-roads.mjs#t:checks/town-roads.mjs#Array.from callback 2:function~7b7mu1-2","k":3,"offshore":false,"maxAbove":-0.007999785873042953,"maxGap":0.008000398612631798}]}
PASS: rendered terrain/pad edges and building bases in larger-project Electron. Artifacts: /var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-contact-AdaPFZ
```

```text
GALAXY_CONTACT_FALLBACK=1 node checks/terrain-contact-desktop.mjs
{"name":"real-68","file":"viewer/app/codex-chat.ts","samplingSize":[1024,512],"towns":68,"vertices":397166,"triangles":792150,"samples":1700,"missing":0,"buildingSamples":2169,"minBuildingClearance":0.010151261335680672,"maxAbove":-0.007999172283911449,"maxLandGap":0.007999937667044321,"penetrating":0,"worst":[{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#acceptThreadPatch:function","k":1,"offshore":false,"maxAbove":-0.007999172283911449,"maxGap":0.007999792506543812},{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#accountAction:function","k":2,"offshore":false,"maxAbove":-0.007999211898749081,"maxGap":0.007999758283224523},{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#selectIntegration:function","k":38,"offshore":false,"maxAbove":-0.007999219506167776,"maxGap":0.007999798709144912},{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#send:function","k":39,"offshore":false,"maxAbove":-0.007999227195670144,"maxGap":0.007999684291242204}]}
{"name":"recovered-4K","file":"viewer/app/codex-chat.ts","samplingSize":[4096,2048],"towns":68,"vertices":397166,"triangles":792150,"samples":1700,"missing":0,"buildingSamples":2169,"minBuildingClearance":0.010151261335680672,"maxAbove":-0.007999172283911449,"maxLandGap":0.007999937719445072,"penetrating":0,"worst":[{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#acceptThreadPatch:function","k":1,"offshore":false,"maxAbove":-0.007999172283911449,"maxGap":0.007999792328677202},{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#accountAction:function","k":2,"offshore":false,"maxAbove":-0.007999211898749081,"maxGap":0.007999772901584379},{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#selectIntegration:function","k":38,"offshore":false,"maxAbove":-0.007999219506167776,"maxGap":0.007999798709144912},{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#send:function","k":39,"offshore":false,"maxAbove":-0.007999228507557632,"maxGap":0.007999684291242204}]}
{"name":"stress-301","file":"RoadTraffic.ts","samplingSize":[1024,512],"towns":301,"vertices":411464,"triangles":818690,"samples":7525,"missing":0,"buildingSamples":16254,"minBuildingClearance":0.009306302884361628,"maxAbove":-0.007999344018065457,"maxLandGap":0.008000563387760451,"penetrating":0,"worst":[{"key":"f:RoadTraffic.ts#t:RoadTraffic.ts#town83:function","k":282,"offshore":false,"maxAbove":-0.007999344018065457,"maxGap":0.008000004830773122},{"key":"f:RoadTraffic.ts#t:RoadTraffic.ts#town31:function","k":225,"offshore":false,"maxAbove":-0.007999423839272879,"maxGap":0.007999953588077702},{"key":"f:RoadTraffic.ts#t:RoadTraffic.ts#town294:function","k":215,"offshore":false,"maxAbove":-0.007999426622253836,"maxGap":0.007999969655275052},{"key":"f:RoadTraffic.ts#t:RoadTraffic.ts#town81:function","k":280,"offshore":false,"maxAbove":-0.00799944769512173,"maxGap":0.007999915396283086}]}
{"name":"earth","file":"checks/galaxy-layout.mjs","samplingSize":[1024,512],"towns":19,"vertices":377779,"triangles":754404,"samples":475,"missing":0,"buildingSamples":234,"minBuildingClearance":0.014256923721561066,"maxAbove":-0.007999675424178676,"maxLandGap":0.00800049645843437,"penetrating":0,"worst":[{"key":"f:checks/galaxy-layout.mjs#t:checks/galaxy-layout.mjs#clear callback 2:function","k":8,"offshore":false,"maxAbove":-0.007999675424178676,"maxGap":0.008000205499671509},{"key":"f:checks/galaxy-layout.mjs#t:checks/galaxy-layout.mjs#groups.map callback 1:function~13b18nh","k":16,"offshore":false,"maxAbove":-0.007999729496409813,"maxGap":0.008000225308819608},{"key":"f:checks/galaxy-layout.mjs#t:checks/galaxy-layout.mjs#assert.deepEqual callback 1:function","k":3,"offshore":false,"maxAbove":-0.007999753765298934,"maxGap":0.008000311817999872},{"key":"f:checks/galaxy-layout.mjs#t:checks/galaxy-layout.mjs#assert.deepEqual(arms keep their order, so their colours match) callback 2:function","k":5,"offshore":false,"maxAbove":-0.007999760879146223,"maxGap":0.00800028916770934}]}
{"name":"mercury","file":"checks/town-roads.mjs","samplingSize":[1024,512],"towns":30,"vertices":393751,"triangles":786262,"samples":750,"missing":0,"buildingSamples":1071,"minBuildingClearance":0.010749995491039499,"maxAbove":-0.007999760236366171,"maxLandGap":0.008000498201335304,"penetrating":0,"worst":[{"key":"f:checks/town-roads.mjs#t:checks/town-roads.mjs#chain30.out.lots.map callback 1:function","k":11,"offshore":false,"maxAbove":-0.007999760236366171,"maxGap":0.008000370766533038},{"key":"f:checks/town-roads.mjs#t:checks/town-roads.mjs#assert.ok(overview layer omits branch detail) callback 1:function","k":9,"offshore":false,"maxAbove":-0.007999766436146416,"maxGap":0.008000193029271685},{"key":"f:checks/town-roads.mjs#t:checks/town-roads.mjs#large.columns.map callback 1:function","k":15,"offshore":false,"maxAbove":-0.007999796481021448,"maxGap":0.008000192470204226},{"key":"f:checks/town-roads.mjs#t:checks/town-roads.mjs#returningChain:function","k":20,"offshore":false,"maxAbove":-0.007999798010047243,"maxGap":0.00800045253408932}]}
PASS: rendered terrain/pad edges and building bases in larger-project Electron. Artifacts: /var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-contact-FQofut
```

```text
node checks/town-pads-desktop.mjs
{"earth":20,"moon":8}
PASS: one compact settlement of level decks, on land, cut into the drawn ground; placements survive a restart.
```

```text
node checks/planet-zoom-desktop.mjs
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-1Rf07z","files":269,"lines":68470}
{"name":"cold-real","duration":5468.700000047684,"maxTask":57,"maxFrame":50.100000000000364,"asset":"moon","detailed":1,"overview":67}
{"name":"cold-real-fit","recipe":4,"angle":0.7443121915445239,"maxSide":0.14999999999210134,"maxX":0.34678816005857616,"maxY":0.5095233183947263,"unresolved":0}
{"name":"settlement-review","detailed":12,"simplified":23,"total":307,"localTotal":177,"visible":181,"expected":152,"lost":[],"betweenSummaries":13,"lostBetweenSummaries":0,"markerScope":"town"}
{"name":"cold-301","duration":10651.399999976158,"maxTask":0,"maxFrame":33.29999999999927,"asset":"mars","detailed":1,"overview":300}
{"name":"cold-301-fit","recipe":4,"angle":0.7623212549668595,"maxSide":0.03842487362655941,"maxX":0.35103175006490145,"maxY":0.5680115664497851,"unresolved":0}
{"name":"repeat-301","duration":8017.399999976158,"maxTask":0,"maxFrame":33.30000000000291,"asset":"mars","detailed":1,"overview":300}
{"name":"repeat-301-fit","recipe":4,"angle":0.7623212549668595,"maxSide":0.03842487362655941,"maxX":0.3510317500648778,"maxY":0.5680115664497172,"unresolved":0}
{"name":"terrain-fallback","asset":"earth","size":[1024,512],"expected":[1024,512],"usesDetail":true}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":1,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":2,"completed":2,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":54,"maxFrame":65.80000000000291}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":2,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":3,"completed":3,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":0,"maxFrame":58.30000000000291}
{"name":"terrain-worker-cancellation","a":"AbortError","b":"AbortError","center":[0.5296604311134477,0.5660000000000001,0.6317466483589101],"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":6,"completed":4,"cancelled":2,"discarded":1,"references":1,"disposed":false,"pending":0}}
PASS: cold/repeat zoom, bounded town rendering, GPU publication, cancellation. Artifacts: /var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-1Rf07z
```

### Visual evidence and remaining work

Inspected actual Electron screenshots from the 68-town and 301-town cases and
fallback run. The final steady 301-town oblique close-up is
`/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-contact-FQofut/town46-contact-steady.png`;
it shows clean terrain/pad contact and buildings resting on their lots, with no
renderer errors. These captures are inspection evidence, not screenshot baselines.

The zoom regression guards passed, but the tighter plan budgets remain open:
the latest isolated run recorded a 57 ms cold long task, and watched edits had
65.8/58.3 ms maximum frames (one 54 ms task). An earlier run recorded an 83.3 ms
edit frame. A separate shortened edit diagnostic overlapped build/typecheck and
is excluded from isolated performance evidence. This contact fix does not claim
to resolve the existing 50 ms construction / 16.7 ms frame targets. Small-body
asteroid/comet terrain was not changed or accepted by these planetary checks.
Manual drag/undo acceptance remains deferred. No downloads or asset generation
ran. The user subsequently authorized committing and pushing this terrain continuation.
Before committing, `git diff --check` passed and `node checks/terrain-contact.mjs`
was rerun with the same exact passing output recorded above. Earlier loading/fit
work was already pushed as `4fa2993`.


## Cold construction and edit frame budgets — 2026-10-18

### Changes and evidence

The user authorized implementation, commit and push on `layout-identity`, retaining
the larger project as the verification target and deferring manual interaction.
The baseline was the pushed terrain fix, `dd249be`.

A diagnostic CPU profile of the existing larger-project zoom check found repeated
transform traversal during town construction. Three.js updates matrices below
invisible parents. Provisional in-view towns were individually visible before the
final twelve-town detail limit was applied, so rendering the hidden staging root
still traversed their full hierarchies. The staging root now skips
`updateMatrixWorld` while hidden; fresh town scenes remain hidden until the
committed frame selects prepared renderers. GPU warmup still uses explicit
`updateWorldMatrix`, and picking/rendering after publication retain normal updates.

Cold construction also rebuilt fourteen identical procedural silhouettes for every
town. Their immutable geometry is now shared under reference-counted leases,
with separate materials for each town. Visible and staged revisions both hold a
lease, so cancellation and retirement cannot dispose another owner's buffers.
The final release disposes prototypes, and reentry builds a fresh set. The fourteen
attribute buffers total 412,560 bytes, rather than 124,180,560 bytes for 301 copies
(excludes generated models, materials and unrelated town geometry). A direct
resource-lifecycle probe passed geometry sharing, material isolation, retirement,
idempotent release and fresh reentry.

Long-animation-frame attribution identified the edit spike as a synchronous
`Response.text.then` chain: 33.3–42.3 ms of snapshot publication followed by a
15.5–16.9 ms scene frame. Every revision rebuilt the orbital scene, including
asteroid geometry, even for a literal edit inside one town. The constellation now
compares its actual layout inputs (grouping, colours, ordered file paths/seeds,
line and callable counts, groups and import endpoints/weights). When unchanged,
it keeps orbital batches and rebinds fresh node records in inspector members and
system bodies. Changed layout inputs still run the existing complete rebuild;
landed source/detail revisions still refresh coherently in either case.

The existing Electron zoom check now measures p95, enforces p95 <=16.7 ms and
main-thread tasks <50 ms for cold/repeat construction and edits, and includes two
local body edits each in the real 68-town file and 301-town stress file. It asserts
exactly one replaced town, retained body/surface/pads and retained orbital batches.
It retains existing route visibility, evidence LOD, full-detail car preparation,
terrain fallback, worker lease/cancellation and footprint-growth checks. Diagnostic
long-animation-frame scripts are saved alongside raw frame/task records. CPU
profiles were diagnostic only; acceptance below runs without the CPU profiler.

### Larger-project budget result

The first complete strict run used 269 files / 68,605 lines, including the real
`codex-chat.ts` file and `RoadTraffic.ts` with 301 towns. It passed all gates. Cold
real/stress/repeat p95 was 9.8/9.7/9.9 ms; local edit p95 was 10.0–10.3 ms, and
footprint-edit p95 was 9.5–9.8 ms. No >=50 ms main-thread task was observed.
Cold 301 construction was 7.778 s and repeat was 5.524 s, versus the prior
terrain-fix report's 10.651/8.017 s. These are separate local runs, not a controlled
multi-machine benchmark. The initial diagnostic profile's 17.3 ms cold-301 p95
was profiled and is not used as an equivalent unprofiled baseline.

Individual frames can still miss 16.7 ms: maxima were 33.6 ms during cold/repeat,
33.3 ms for the local 301-town edits and 49.9 ms during footprint growth. The plan
specifies p95, not a maximum frame guarantee. This result establishes that scoped
budget acceptance, not instant construction or a universal absence of hitches.
The separate 20k-file, warm-reveal and manual drag/undo acceptance work remains
outside this run. No downloads, generation, dependencies, frameworks or CI changes
were introduced. The unrelated `.claude/` directory remains untouched.

### Exact check output (first strict run)

```text
npm run typecheck
> codebase-viz@0.1.9 typecheck
> tsc -p .
(exit 0)

node checks/terrain-contact.mjs
{"samples":75,"maxAbove":-0.0007999727895053876,"maxGap":0.0008000248609740801}
PASS: triangle interiors meet pad edges, including coarse terrain, longitude seam, polar cap and offshore ceiling

node checks/planet-zoom-desktop.mjs
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-I6Z84c","files":269,"lines":68605}
{"name":"cold-real","duration":4957.100000023842,"maxTask":0,"maxFrame":33.30000000000018,"p95Frame":9.800000000000182,"asset":"moon","detailed":1,"overview":67}
{"name":"cold-real-fit","recipe":4,"angle":0.7443121915445239,"maxSide":0.14999999999210134,"maxX":0.34678816005858093,"maxY":0.5095233183947359,"unresolved":0}
{"name":"settlement-review","detailed":12,"simplified":23,"total":307,"localTotal":177,"visible":181,"expected":152,"lost":[],"betweenSummaries":13,"lostBetweenSummaries":0,"markerScope":"town"}
{"name":"cold-real-edit","edit":1,"towns":68,"maxTask":0,"maxFrame":16.700000000000728,"p95Frame":10.100000000000364,"changed":1}
{"name":"cold-real-edit","edit":2,"towns":68,"maxTask":0,"maxFrame":10.399999999999636,"p95Frame":10.199999999998909,"changed":1}
{"name":"cold-301","duration":7778.399999976158,"maxTask":0,"maxFrame":25,"p95Frame":9.700000000000728,"asset":"mars","detailed":1,"overview":300}
{"name":"cold-301-fit","recipe":4,"angle":0.7623212549668595,"maxSide":0.03842487362655941,"maxX":0.35103175006490644,"maxY":0.5680115664497821,"unresolved":0}
{"name":"cold-301-edit","edit":1,"towns":301,"maxTask":0,"maxFrame":33.29999999999927,"p95Frame":10.299999999999272,"changed":1}
{"name":"cold-301-edit","edit":2,"towns":301,"maxTask":0,"maxFrame":25,"p95Frame":10,"changed":1}
{"name":"repeat-301","duration":5523.899999976158,"maxTask":0,"maxFrame":33.60000000000218,"p95Frame":9.900000000001455,"asset":"mars","detailed":1,"overview":300}
{"name":"repeat-301-fit","recipe":4,"angle":0.7623212549668595,"maxSide":0.03842487362655941,"maxX":0.35103175006489434,"maxY":0.5680115664497689,"unresolved":0}
{"name":"terrain-fallback","asset":"earth","size":[1024,512],"expected":[1024,512],"usesDetail":true}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":1,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":2,"completed":2,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":0,"maxFrame":49.900000000001455,"p95Frame":9.799999999995634}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":2,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":3,"completed":3,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":0,"maxFrame":10.099999999998545,"p95Frame":9.5}
{"name":"terrain-worker-cancellation","a":"AbortError","b":"AbortError","center":[0.5296604311134477,0.5660000000000001,0.6317466483589101],"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":6,"completed":4,"cancelled":2,"discarded":1,"references":1,"disposed":false,"pending":0}}
PASS: cold/repeat zoom, bounded town rendering, GPU publication, cancellation. Artifacts: /var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-I6Z84c
```

The zoom check launches through `npm run desktop`, which runs the build before
Electron. Automated screenshots were inspected, including
`/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-I6Z84c/settlement-routes.png`:
visible routes remain drawn between detailed and simplified towns and the
exception marker attaches to the actual summary. Manual interaction remains deferred.

### Functional regression checks

```text
node checks/layout-identity-desktop.mjs
PASS: method/file rename, added method, restart and first callable keep the planet look and town anchors.

node checks/source-index-desktop.mjs
PASS: exact source lookup, retained indexes, numbered recursion, async boundaries, paused paths, stale captures, evidence marker families and git changes in Electron.

node checks/terrain-contact-desktop.mjs
{"name":"real-68","file":"viewer/app/codex-chat.ts","samplingSize":[4096,2048],"towns":68,"vertices":384045,"triangles":765882,"samples":1700,"missing":0,"buildingSamples":2169,"minBuildingClearance":0.010151247958829046,"maxAbove":-0.00799919710316388,"maxLandGap":0.007999920506557956,"penetrating":0,"worst":[{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#bridgeFor:function","k":5,"offshore":false,"maxAbove":-0.00799919710316388,"maxGap":0.007999743506752921},{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#setEffort:function","k":42,"offshore":false,"maxAbove":-0.00799919945159111,"maxGap":0.007999794156877016},{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#refresh:function","k":24,"offshore":false,"maxAbove":-0.007999200927239158,"maxGap":0.007999765138436032},{"key":"f:viewer/app/codex-chat.ts#t:viewer/app/codex-chat.ts#threadOf:function","k":57,"offshore":false,"maxAbove":-0.007999230459434514,"maxGap":0.007999779741982849}]}
{"name":"stress-301","file":"RoadTraffic.ts","samplingSize":[4096,2048],"towns":301,"vertices":408318,"triangles":812272,"samples":7525,"missing":0,"buildingSamples":16254,"minBuildingClearance":0.009306237363231773,"maxAbove":-0.007999396471872089,"maxLandGap":0.008000554664358006,"penetrating":0,"worst":[{"key":"f:RoadTraffic.ts#t:RoadTraffic.ts#town76:function","k":274,"offshore":false,"maxAbove":-0.007999396471872089,"maxGap":0.007999986450506924},{"key":"f:RoadTraffic.ts#t:RoadTraffic.ts#town65:function","k":262,"offshore":false,"maxAbove":-0.007999408312638678,"maxGap":0.007999952445048919},{"key":"f:RoadTraffic.ts#t:RoadTraffic.ts#town64:function","k":261,"offshore":false,"maxAbove":-0.007999432450457533,"maxGap":0.007999853408673374},{"key":"f:RoadTraffic.ts#t:RoadTraffic.ts#town54:function","k":250,"offshore":false,"maxAbove":-0.007999434471649636,"maxGap":0.007999831019342096}]}
{"name":"earth","file":"checks/galaxy-layout.mjs","samplingSize":[4096,2048],"towns":19,"vertices":384952,"triangles":768494,"samples":475,"missing":0,"buildingSamples":234,"minBuildingClearance":0.014256998839377033,"maxAbove":-0.007999799961359244,"maxLandGap":0.008000442780359052,"penetrating":0,"worst":[{"key":"f:checks/galaxy-layout.mjs#t:checks/galaxy-layout.mjs#arms.map callback 1:function","k":2,"offshore":false,"maxAbove":-0.007999799961359244,"maxGap":0.00800026077878968},{"key":"f:checks/galaxy-layout.mjs#t:checks/galaxy-layout.mjs#pushed.centers.forEach callback 1:function","k":1,"offshore":false,"maxAbove":-0.007999804131131327,"maxGap":0.008000282032451622},{"key":"f:checks/galaxy-layout.mjs#t:checks/galaxy-layout.mjs#assert.deepEqual callback 1:function","k":3,"offshore":false,"maxAbove":-0.007999808036869283,"maxGap":0.008000151719288695},{"key":"f:checks/galaxy-layout.mjs#t:checks/galaxy-layout.mjs#clear:function","k":9,"offshore":false,"maxAbove":-0.007999852728232781,"maxGap":0.008000390679089975}]}
{"name":"mercury","file":"checks/town-roads.mjs","samplingSize":[4096,2048],"towns":30,"vertices":384788,"triangles":768322,"samples":750,"missing":0,"buildingSamples":1071,"minBuildingClearance":0.010749949880356269,"maxAbove":-0.007999751128627608,"maxLandGap":0.008000511890196904,"penetrating":0,"worst":[{"key":"f:checks/town-roads.mjs#t:checks/town-roads.mjs#roadScene:function","k":21,"offshore":false,"maxAbove":-0.007999751128627608,"maxGap":0.008000276599030798},{"key":"f:checks/town-roads.mjs#t:checks/town-roads.mjs#layout:function","k":17,"offshore":false,"maxAbove":-0.007999753643810337,"maxGap":0.008000294077730175},{"key":"f:checks/town-roads.mjs#t:checks/town-roads.mjs#arrowTrips[1].flatMap(p => p.visits).some callback 1:function","k":5,"offshore":false,"maxAbove":-0.0079997673898351,"maxGap":0.008000349467108592},{"key":"f:checks/town-roads.mjs#t:checks/town-roads.mjs#Array.from callback 2:function~7b7mu1-2","k":3,"offshore":false,"maxAbove":-0.007999785873042953,"maxGap":0.008000398612631798}]}
PASS: rendered terrain/pad edges and building bases in larger-project Electron. Artifacts: /var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-contact-qSwwXP
```

Inspected the fresh 301-town Electron contact screenshot
`/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-contact-qSwwXP/stress-301.png`.
Rendered pad contacts and building placement remain unchanged. The FPS badge in
that diagnostic capture includes expensive independent triangle ray probes and is
not a performance measurement; the separate zoom runs supply frame acceptance.

Resource-lifecycle probe output:

```text
PASS: shared industrial geometry, isolated materials, cancellation-safe leases, final release and fresh reentry (14 roles)
{"sharedGeometries":14,"attributeBytes":412560,"former301TownBytes":124180560}
```

### Final active-traffic confirmation and intermittent control timeout

The final zoom check also explicitly enables the bounded optional call ships at
landing and around each local edit, in addition to the existing road traffic.
With the final product changes, two complete strict runs passed (the first strict
run above and this final active-traffic run). An intervening confirmation aborted
during repeat-301 with `Timed out: Runtime.evaluate`; even its failure diagnostic
evaluation timed out, so it has no measured frame-budget failure to classify. The
fixture's native `state/logs/app.jsonl` records no renderer-exit, unresponsive or
renderer-error event. That control timeout remains unexplained and is not claimed
fixed. Its artifact directory is
`/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-B73wAB`.
A contemporaneous macOS Electron OOM report belonged to a worker of the separate
pre-existing app process (parent PID 99242), not this fixture; it is not evidence
that the test renderer crashed. Manual interaction is still deferred.

Final acceptance (269 files / 68,608 lines): cold and edit p95 8.9–9.3 ms, no
>=50 ms task, 301-town cold/repeat 7.551/5.271 s. Maximum local-edit frames were
9.3 ms in the 68-town file and 25.0 ms in the 301-town file; footprint growth still
had one 41.6 ms frame, while its p95 remained 9.2 ms. These results meet the
scoped plan budgets, with the control-timeout caveat above.

```text
node checks/planet-zoom-desktop.mjs
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-oiKton","files":269,"lines":68608}
{"name":"cold-real","duration":4847.199999988079,"maxTask":0,"maxFrame":33.30000000000018,"p95Frame":9.199999999999818,"asset":"moon","detailed":1,"overview":67}
{"name":"cold-real-fit","recipe":4,"angle":0.7443121915445239,"maxSide":0.14999999999210134,"maxX":0.3462899012079077,"maxY":0.509523318394777,"unresolved":0}
{"name":"settlement-review","detailed":12,"simplified":23,"total":307,"localTotal":177,"visible":181,"expected":152,"lost":[],"betweenSummaries":13,"lostBetweenSummaries":0,"markerScope":"town"}
{"name":"cold-real-edit","edit":1,"towns":68,"maxTask":0,"maxFrame":9.100000000000364,"p95Frame":8.899999999999636,"changed":1}
{"name":"cold-real-edit","edit":2,"towns":68,"maxTask":0,"maxFrame":9.299999999999272,"p95Frame":9.200000000000728,"changed":1}
{"name":"cold-301","duration":7550.5,"maxTask":0,"maxFrame":25,"p95Frame":9.19999999999709,"asset":"mars","detailed":1,"overview":300}
{"name":"cold-301-fit","recipe":4,"angle":0.7623212549668595,"maxSide":0.03842487362655941,"maxX":0.3505273941021763,"maxY":0.5680115664498084,"unresolved":0}
{"name":"cold-301-edit","edit":1,"towns":301,"maxTask":0,"maxFrame":25,"p95Frame":9.200000000000728,"changed":1}
{"name":"cold-301-edit","edit":2,"towns":301,"maxTask":0,"maxFrame":17.399999999997817,"p95Frame":9.299999999999272,"changed":1}
{"name":"repeat-301","duration":5271.199999988079,"maxTask":0,"maxFrame":25,"p95Frame":9.200000000000728,"asset":"mars","detailed":1,"overview":300}
{"name":"repeat-301-fit","recipe":4,"angle":0.7623212549668595,"maxSide":0.03842487362655941,"maxX":0.3505273941021773,"maxY":0.5680115664497762,"unresolved":0}
{"name":"terrain-fallback","asset":"earth","size":[1024,512],"expected":[1024,512],"usesDetail":true}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":1,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":2,"completed":2,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":0,"maxFrame":41.599999999998545,"p95Frame":9.19999999999709}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":2,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":3,"completed":3,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":0,"maxFrame":9.400000000001455,"p95Frame":8.900000000001455}
{"name":"terrain-worker-cancellation","a":"AbortError","b":"AbortError","center":[0.5296604311134477,0.5660000000000001,0.6317466483589101],"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":6,"completed":4,"cancelled":2,"discarded":1,"references":1,"disposed":false,"pending":0}}
PASS: cold/repeat zoom, bounded town rendering, GPU publication, cancellation. Artifacts: /var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-oiKton
```

The intermediate timeout output is retained verbatim below rather than counted
as a passing run:

```text
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-B73wAB","files":269,"lines":68605}
{"name":"cold-real","duration":4980.400000035763,"maxTask":0,"maxFrame":33.19999999999982,"p95Frame":9.099999999999454,"asset":"moon","detailed":1,"overview":67}
{"name":"cold-real-fit","recipe":4,"angle":0.7443121915445239,"maxSide":0.14999999999210134,"maxX":0.3467881600585809,"maxY":0.5095233183947493,"unresolved":0}
{"name":"settlement-review","detailed":12,"simplified":23,"total":307,"localTotal":177,"visible":181,"expected":152,"lost":[],"betweenSummaries":13,"lostBetweenSummaries":0,"markerScope":"town"}
{"name":"cold-real-edit","edit":1,"towns":68,"maxTask":0,"maxFrame":17.19999999999891,"p95Frame":9.199999999998909,"changed":1}
{"name":"cold-real-edit","edit":2,"towns":68,"maxTask":0,"maxFrame":16.600000000000364,"p95Frame":9,"changed":1}
{"name":"cold-301","duration":7551.300000011921,"maxTask":0,"maxFrame":42,"p95Frame":9.299999999999272,"asset":"mars","detailed":1,"overview":300}
{"name":"cold-301-fit","recipe":4,"angle":0.7623212549668595,"maxSide":0.03842487362655941,"maxX":0.3510317500648931,"maxY":0.5680115664497267,"unresolved":0}
{"name":"cold-301-edit","edit":1,"towns":301,"maxTask":0,"maxFrame":25.700000000000728,"p95Frame":8.899999999997817,"changed":1}
{"name":"cold-301-edit","edit":2,"towns":301,"maxTask":0,"maxFrame":25.099999999998545,"p95Frame":8.5,"changed":1}
Error: Timed out: Runtime.evaluate
    at Timeout._onTimeout (file:///Users/nicknetraganti/Desktop/Developer%20Stuff/Misc/codebase-viz/checks/helpers/electron-cdp.mjs:86:20)
    at listOnTimeout (node:internal/timers:685:17)
    at process.processTimers (node:internal/timers:618:7)
FAIL: {"phase":"repeat-301","assertion":"Timed out: Runtime.evaluate","artifacts":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-B73wAB"}
```

`git diff --check` passed before the authorized performance commit. The terrain,
identity and source-navigation regressions above passed with the final product
code. No full suite or manual interaction acceptance was run.


## Release 0.1.10 — packaged Apple silicon verification

The user requested a new release. Version 0.1.10 packages `layout-identity` after
`7bc3ae7`, using the installed Electron 44.5.1 distribution (no new download), into
`release/v0.1.10`. Only package.json, package-lock.json and release/progress notes
change for this release. Runtime algorithms are unchanged from the performance
commit. Existing generated assets and manual acceptance gates are unchanged.

```text
npm run release -- --config.electronDist=node_modules/electron/dist --config.directories.output=release/v0.1.10
✓ built in 1.08s
  • packaging       platform=darwin arch=arm64 electron=44.5.1 appOutDir=release/v0.1.10/mac-arm64
  • signing         file=release/v0.1.10/mac-arm64/Codebase Galaxy.app platform=darwin type=distribution identityName=- identityHash=none provisioningProfile=none
  • skipped macOS notarization  reason=`notarize` options were unable to be generated
  • building        target=macOS zip arch=arm64 file=release/v0.1.10/Codebase Galaxy-0.1.10-arm64-mac.zip
  • building        target=DMG arch=arm64 file=release/v0.1.10/Codebase Galaxy-0.1.10-arm64.dmg

npm run typecheck
> codebase-viz@0.1.10 typecheck
> tsc -p .
(exit 0)

codesign --verify --deep --strict --verbose=2 'release/v0.1.10/mac-arm64/Codebase Galaxy.app'
release/v0.1.10/mac-arm64/Codebase Galaxy.app: valid on disk
release/v0.1.10/mac-arm64/Codebase Galaxy.app: satisfies its Designated Requirement

hdiutil verify 'release/v0.1.10/Codebase Galaxy-0.1.10-arm64.dmg'
hdiutil: verify: checksum of "release/v0.1.10/Codebase Galaxy-0.1.10-arm64.dmg" is VALID

unzip -tq 'release/v0.1.10/Codebase Galaxy-0.1.10-arm64-mac.zip'
No errors detected in compressed data of release/v0.1.10/Codebase Galaxy-0.1.10-arm64-mac.zip.

Packaged source/build SHA-256 comparison (desktop, engine, source-model, dist/viewer, viewer):
{"runtimeFiles": 782, "bytes": 413478329, "mismatches": []}
PASS: packaged runtime matches the source/build and package version is 0.1.10
```

All checks below launched the packaged executable via
`GALAXY_TEST_EXECUTABLE="$PWD/release/v0.1.10/mac-arm64/Codebase Galaxy.app/Contents/MacOS/Codebase Galaxy"`.
Explorer and chat checks were unchanged. Debug, source-map and zoom checks used
temporary copies with only `viaNpm: true` changed to false and the helper import
made absolute: the existing helper's viaNpm path otherwise launches source rather
than the configured package. No check assertions or thresholds were relaxed for
acceptance. A separate CPU-profile diagnostic relaxed catastrophic task guards
and omitted later phases; that diagnostic is not an acceptance run.

```text
node checks/explorer-desktop.mjs
Opened previews; typing in the native editor.
Editor records unsaved edits.
Electron Explorer passed: real pointer clicks, lazy folders, previews, pinned/dirty tabs, Monaco typing/undo/find, save shortcut, disk watching/conflicts, binary errors, chat drafts, collapse shortcuts, compact layouts, persisted preferences, keyboard tree and clean diagnostics.

node checks/chat-desktop.mjs
PASS Electron: icon selectors, responsive composer, Enter follow-up choices, steer/queue, reconnect recovery, edit/remove, chat switching, stop/resume, camera controls and saved input preset.

node /tmp/release-0.1.10-debug.mjs
CALLER_PLANET_EXACT
MAPPED_TS_STEPPED
EDITOR_F9_PASS
BREAKPOINT_VARIABLES_BUILDING_PASS
PASS

node /tmp/release-0.1.10-source-map.mjs
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-source-map-4gLWAk","files":272,"lines":66408,"statements":802}
PASS: 802 single-line statements, mapped editor/building round trip, exact columns, missing-map recovery, unsaved-source rejection and project/chat controls in Electron.
```

### First-use hitch: still open

The first packaged strict zoom run failed its <50 ms task gate on cold-real:

```text
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-rDQ6TI","files":269,"lines":68608}
{"name":"cold-real","duration":4863.600000023842,"maxTask":103,"maxFrame":108.19999999999982,"p95Frame":9.199999999999818,"asset":"moon","detailed":1,"overview":67}
{"name":"cold-real-fit","recipe":4,"angle":0.7443121915445239,"maxSide":0.14999999999210134,"maxX":0.3462899012079274,"maxY":0.5095233183947852,"unresolved":0}
AssertionError [ERR_ASSERTION]: cold-real has no large blocking task: 103
    at sample (file:///private/tmp/release-0.1.10-planet-zoom.mjs:212:3)
    at async file:///private/tmp/release-0.1.10-planet-zoom.mjs:375:3
FAIL: {"phase":"cold-real","assertion":"cold-real has no large blocking task: 103","artifacts":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-rDQ6TI"}
```

Its long-animation-frame record attributes 102.9 ms to the scene's frame callback.
A separate cold CPU-profile run did not reproduce the >=50 ms task (maximum frame
66.7 ms, p95 9.2 ms); it showed first-use texture upload and shader-program
information/uniform preparation, including main-frame `getProgramInfoLog` calls.
This suggests driver/shader first use, but does not prove the cause of the original
103 ms task. No product change was made or credited with fixing it. The release
notes explicitly retain intermittent first-use rendering hitches as open.
The prior intermittent control timeout is also still open.

Final unprofiled packaged acceptance passed, including 68/301-town edits, retained
orbital batches and terrain, optional call ships, fallback and cancellation:

```text
node /tmp/release-0.1.10-planet-zoom.mjs
{"temporary":"/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-S5PxeR","files":269,"lines":68608}
{"name":"cold-real","duration":4851.199999988079,"maxTask":0,"maxFrame":34,"p95Frame":9.300000000000182,"asset":"moon","detailed":1,"overview":67}
{"name":"cold-real-fit","recipe":4,"angle":0.7443121915445239,"maxSide":0.14999999999210134,"maxX":0.34628990120787306,"maxY":0.509523318394837,"unresolved":0}
{"name":"settlement-review","detailed":12,"simplified":23,"total":307,"localTotal":177,"visible":181,"expected":152,"lost":[],"betweenSummaries":13,"lostBetweenSummaries":0,"markerScope":"town"}
{"name":"cold-real-edit","edit":1,"towns":68,"maxTask":0,"maxFrame":9.300000000001091,"p95Frame":9.299999999999272,"changed":1}
{"name":"cold-real-edit","edit":2,"towns":68,"maxTask":0,"maxFrame":9.399999999999636,"p95Frame":9,"changed":1}
{"name":"cold-301","duration":7200.800000011921,"maxTask":0,"maxFrame":24.899999999997817,"p95Frame":8.599999999998545,"asset":"mars","detailed":1,"overview":300}
{"name":"cold-301-fit","recipe":4,"angle":0.7623212549668595,"maxSide":0.03842487362655941,"maxX":0.3505273941021799,"maxY":0.5680115664497856,"unresolved":0}
{"name":"cold-301-edit","edit":1,"towns":301,"maxTask":0,"maxFrame":25,"p95Frame":9.299999999999272,"changed":1}
{"name":"cold-301-edit","edit":2,"towns":301,"maxTask":0,"maxFrame":17.5,"p95Frame":9.299999999999272,"changed":1}
{"name":"repeat-301","duration":5064.199999988079,"maxTask":0,"maxFrame":25.099999999998545,"p95Frame":9.299999999999272,"asset":"mars","detailed":1,"overview":300}
{"name":"repeat-301-fit","recipe":4,"angle":0.7623212549668595,"maxSide":0.03842487362655941,"maxX":0.3505273941021241,"maxY":0.5680115664496973,"unresolved":0}
{"name":"terrain-fallback","asset":"earth","size":[1024,512],"expected":[1024,512],"usesDetail":true}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":1,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":2,"completed":2,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":0,"maxFrame":41.700000000004366,"p95Frame":9.30000000000291}
{"name":"terrain-worker-edit","file":"checks/galaxy-layout.mjs","edit":2,"same":true,"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":3,"completed":3,"cancelled":0,"discarded":0,"references":1,"disposed":false,"pending":0},"heightBytes":16777216,"maxTask":0,"maxFrame":9.400000000001455,"p95Frame":9.299999999995634}
{"name":"terrain-worker-cancellation","a":"AbortError","b":"AbortError","center":[0.5296604311134477,0.5660000000000001,0.6317466483589101],"stats":{"starts":1,"uploads":1,"samplingBytes":25296896,"requests":6,"completed":4,"cancelled":2,"discarded":1,"references":1,"disposed":false,"pending":0}}
PASS: cold/repeat zoom, bounded town rendering, GPU publication, cancellation. Artifacts: /var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-S5PxeR
```

Actual packaged Electron screenshots were inspected, including
`/var/folders/n9/rpnnb70115z66f19pt397fh80000gn/T/galaxy-zoom-S5PxeR/cold-301.png`.
These checks use temporary projects/profiles; chat exercises a local protocol
fixture without real provider messages. No full suite or manual town-drag/undo
acceptance ran. The macOS app is ad-hoc signed and not notarized; no Windows or
Intel Mac artifact is included.

Publication payload (hyphens normalized in download names; app/archive contents unchanged):

```text
2dda54b0da35708e48294cce71977287d490a1b706a4d71956a949e6207b3178  Codebase-Galaxy-0.1.10-arm64-mac.zip
cd727dfa3534fb9500c727f37a2363fb9b073e0e2bddcbb51123899b6d0acbd4  Codebase-Galaxy-0.1.10-arm64.dmg
```


## Follow-up: compact settlements and readable landing

The planet-relative fit (recipe 4) spread a 68-town file over 43° of the globe and framed all of it on landing. Towns were a few pixels across, and only the selected one was drawn in full. At the user's request, settlements are compact again, with somewhat larger towns, as recipe 6 (`source-model/settlement-fit.js`, planet-relative angles):

- the largest ordinary deck stays below 0.1 rad (about 5.7°);
- a small file is capped at 0.008 planet radii per plan unit;
- the packed settlement stays within 0.35 planet radii.

Recipe 3–5 automatic placements migrate once; pins keep their direction.

Two placement changes keep larger towns together on land:

- **Site scoring.** Sites are scored over the whole cap the allocator fills. Previously only the packed estimate was scored, which is about 1/1.8 of that radius. On Earth, bigger decks around a coast-centred site had put 8 of 19 towns on offshore platforms; scoring the full cap moved the site inland, with 0 offshore.
- **Bearings.** Districts keep their bearing, compressed into the inner 35% of the settlement radius instead of 70%, so towns pack outward from the centre.

**Landing.** Landing frames the landing town and its 11 nearest neighbours, with some surrounding ground (1.4× the bounding radius); a settlement of up to 12 towns is framed whole. Display → Settlement overview still frames everything.

**Town detail.** `DETAIL` in `viewer/towns/incremental-towns.js` draws up to 20 on-screen towns in full, largest first. Towns enter detail at 18 px and leave below 14 px, so they don't flicker at the threshold. A cap of 32 pushed cold-landing p95 just past one 60 Hz frame (16.8 ms).

**Check changes.** `checks/planet-zoom-desktop.mjs` now expects recipe 6 and decks of at most 0.1 radii. On large files it requires at least 10 towns detailed or preparing at landing. It also uses a 60 Hz frame budget (1000/60 ms plus 0.1 ms for animation-frame quantization), because 60 Hz intervals read as 16.7 ms and failed the strict 16.7 comparison on floating-point noise.

**Measurements.** Fixture: 269 files / 68,639 lines. The check was launched directly on the current build: the machine was heavily loaded during part of this session, and `npm run desktop`'s rebuild exceeded the harness's 15 s start limit.

| Landing | Settlement radius | Detailed at landing (settled) | Landing p95 | Edit p95 | Tasks ≥ 50 ms |
|---|---:|---:|---:|---:|---:|
| 68-town file, recipe 4 | 0.744 rad | 1 | 9.3 ms | 9.2–9.3 ms | 0 |
| 68-town file, recipe 6 | 0.493 rad | 20 | 16.7 ms | 8.9–9.2 ms | 0 |
| 301-town file, recipe 4 | 0.762 rad | 1 | 9.4 ms | 17.1 ms (failed) | 0 |
| 301-town file, recipe 6 | 0.667 rad | 20 | 9.3 ms | 9.2–9.3 ms | 0 |
| Earth, `checks/galaxy-layout.mjs`, recipe 6 | 0.345 rad | 19 of 19 | — | — | — |

The recipe-4 rows are from the run at `4832a0a`, which failed its budget twice in this session (edit p95 17.1 ms; a 52 ms cold task). With recipe 6, these checks passed:

- planet-zoom-desktop;
- town-pads-desktop;
- layout-identity-desktop;
- terrain-contact-desktop, with Earth at 0 missing contact samples;
- settlement-fit, layout-memory and layout-identity.

The cold 68-town landing reaches one 60 Hz frame at p95 while its 20 towns are prepared; it is at the budget, not under it.
