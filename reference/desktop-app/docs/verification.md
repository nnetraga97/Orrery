# Verification

Run checks from the repository root after `npm install`. Offline checks use local
fixtures and temporary folders; passing them does not establish live model access.
UI changes must also be inspected in the actual Electron window.

## Offline checks

`node checks/diagnostics.cjs` checks bounded local log rotation and the renderer metadata allowlist.
`npm run build && node checks/activity-desktop.mjs` verifies real filesystem edits become workspace-labelled
cannon salvos, bulk downloads remain non-shot updates, and event IDs connect backend, renderer and fire logs.

`npm run build && node checks/creation-target-desktop.mjs` holds an actual analysis response in Electron while
a new source file waits for its body. It checks that unrelated shots still fire, the creation projectile lands
on the drawn body, deletion cancels a waiting creation, and orbital rings stay capped at five planets through
growth and reload. It saves a render under `screenshots/creation-target-review/`.

## Local diagnostics

Use **Help → Open Diagnostics Folder** in Electron. `app.jsonl` contains structured connection, chat,
workspace analysis, event delivery, queue overflow, skipped-effect and cannon-fire metadata. It rotates at
4 MiB with one backup (`app.jsonl.1`). Existing renderer errors remain in `renderer.jsonl`.
Logging is local; prompts, command bodies/output and credentials are not recorded in the activity trace.

Follow an `eventId` through `workspace-event`, `activity-received`, `activity-delivered`, `cannon-queued`
and `cannon-fired`. Fire records distinguish `receivedMs` (viewer receipt to fire), `queueMs` (queue entry
to fire, including charging), `eventMs` (published event to fire), and `actionMs` when provider start timing
is available. `timingSource` distinguishes provider timestamps, duration-derived starts and observation
time. Filesystem events retain their unknown agent attribution and have no claimed action-start latency.
The same aggregate timing counters are available from `view.cannon.stats().timing` in DevTools.
Source creation shots wait for their analyzed body before charging; that wait is included in queue latency.
`creation-impact` records the distance from the projectile endpoint to its target as `targetError`.

Confirmed source/config/document changes without an agent manifest fire pale-blue **Workspace** salvos.
Files in model/runtime/vendor/generated trees stay workspace updates, avoiding a shot per download chunk.
This adds file effects without guessing which process or agent caused an otherwise unattributed write.

## Offline check commands

`npm test` type-checks the viewer (`npm run typecheck`), then runs every check below
(`npm test -- workspace` runs the matching ones).

| Command | Coverage |
| --- | --- |
| `node checks/settings.cjs` | Personal/project round trips, section merging, validation, size bounds, symlink containment, atomic writes, events and safe workspace JSON creation |
| `node checks/dap-client.cjs` | Offline fake stdio adapter: framing, correlation, reverse requests, lifecycle, probes, stacks, stale source and environment |
| `node checks/launch-configurations.cjs` | JSONC, substitutions, unsupported reasons, config sources and detected launches |
| `node checks/adapter-install.cjs` | Pinned debugger and language-server artifact installs, SHA-256, unsafe archives and idempotence |
| `node checks/problems.cjs` | Fake stdio LSP: diagnostic conversion, root containment, debounce, waits/pull fallback, edits, settings, missing installs and process cleanup |
| `node checks/agent-debug-tools.cjs` | Provider-neutral agent tools: approval/denial, read-only Problems, report bounds, session ownership, inspection and hand-off |
| `node checks/desktop-workbench.cjs` | Empty startup, JSONC workspaces, multiple roots, recents, saving and failed-open preservation |
| `node checks/codex-app-server.cjs` | Subprocess handshake, streaming, requests, approval responses, bounds, timeouts and shutdown |
| `node checks/codex-chat-service.cjs` | Isolated auth, ownership, models, history, approvals, questions, interruption and recovery |
| `node checks/claude-chat.cjs` | Claude Code stream-json against a fake `claude`: streaming, tool items, approvals, subagent drones, transcript resume, signed-out state |
| `node checks/semantic-model.mjs` | Callable forms, bindings, pattern evidence, identity/layout stability and building roles |
| `node checks/town-revision.mjs` | Stable rendering fingerprints and source-only rebasing without mutating the retained revision |
| `node checks/layout-identity.mjs` | File and town layout keys across renames, copies, undone deletes and new methods |
| `node checks/call-routes.mjs` | Directed call sites, recursion, external/unresolved targets, callback ownership, async calls, stable IDs and operation range round trips |
| `node checks/source-index.mjs` | Exact, approximate, stale and unmapped source locations; range round trips; debug record validation and stacks |
| `node checks/workspace-scope.cjs` | Shared graph, symbols, Java and observer scope |
| `node checks/workspace-service.cjs` | Real filesystem changes, analysis scheduling, stale maps, exclusions and journal pagination |
| `node checks/java-front-end.mjs` | Java parser fixtures; no Spring checkout needed |
| `node checks/syntax-languages.mjs` | Tree-sitter languages: cross-file edges, declarations and control flow per language |
| `node checks/galaxy-layout.mjs` | Constellation layout: folder arms, no overlapping systems, the cannon's clear centre and import order along arms |
| `node checks/rigged-assets.mjs` | Model bounds, host-relative scale, rig lifecycle and transport behavior |
| `node checks/satellite-rig.mjs` | Repaired reflector, exported joints/clips, dish clearance, moving receiver target and load/disposal lifecycle |
| `node checks/terminal-moon-rig.mjs` | Centered moon, stationary rock, sensor/shutter/hatch joints, unresolved commands, outcome lighting and load/disposal lifecycle |
| `node checks/agent-runtime.cjs` | Event/session validation, attribution, batching and stream recovery |
| `node checks/codex-integration.cjs` | Codex rollout decoding and observed-session connections |
| `node checks/agent-pipeline.cjs` | Structured jobs, resources and outcomes |

Use `git diff --check` and `node --check <changed-file>` for whitespace and syntax.

`node checks/camera-input.mjs` covers selection versus navigation gestures,
wheel/pinch normalization, Trackpad/Mouse mappings and elapsed-time damping.
`node checks/scene-picking.mjs` covers nearest visible targets, hidden ancestors,
custom targets without file meshes, and fresh pointer rays.
`node checks/chat-controls.cjs` covers permission policies, steering preconditions,
FIFO queues, stop/failure handling and saved queue recovery using a local fake server.

## Electron verification

Use an isolated data directory when testing temporary workspaces:

```sh
GALAXY_DATA_DIR=/tmp/galaxy-desktop-review npm run desktop
```

Check the native window, not just its loopback page:

1. Launch without arguments: Welcome appears with no workspace selected.
2. Open a folder and a local multi-folder `.code-workspace` file. Switch Explorer
   roots and confirm that the galaxy and chat context follow the selected folder.
3. Add a folder, save the workspace, close it, and reopen it through Recent.
   Canceling an unsaved-workspace prompt must preserve the current workspace.
4. Restart: recent entries remain, while a normal launch stays empty. Explicit
   `--project` and `--workspace` arguments open the requested location.
5. Check chat authentication, streaming, approvals, stop and history separately.
   A fake server validates UI behavior only; a live authenticated turn requires
   a real provider account and is not implied by fixture success.

## Electron checks

To run these checks against the packaged release, first run `npm run release`, then
set `GALAXY_TEST_EXECUTABLE` to the absolute path of
`release/mac-arm64/Codebase Galaxy.app/Contents/MacOS/Codebase Galaxy` when invoking
each check. The checks still use isolated data directories and local fixtures.

`npm run build && node checks/island-desktop.mjs` checks the assembled three-tier
island, its sleep/work/wait animations, airship flight clearance and return to
berth, inset context gauge, centered physical cannon bearing, top-left FPS counter,
and project/chat controls in Electron. It also clicks
every individual building without a preceding hover and focuses a terrace house.
It writes a turntable, detail and state gallery to `screenshots/island-review/`.
On macOS, long Chromium screenshot runs can stall surface readback;
`node checks/island-desktop.mjs --verify-only` runs the same interaction assertions
without captures. Close-up images can be captured in a fresh Electron review window.
See `viewer/assets/island/README.md` for the headless Blender rebuild commands.

`npm run build && node checks/chat-desktop.mjs` uses a local fake Codex server to
verify the actual Electron permission/effort icons, composer resizing, Enter's
follow-up choices, reconnect recovery, edit/remove, chat switching, stop/resume,
and trackpad pan/orbit/pinch. It also checks mouse wheel behavior and input preset
persistence, and saves screenshots to `screenshots/chat-review/`. No live provider
is called.

`npm run build && node checks/camera-desktop.mjs` launches an isolated Electron
window and checks actual pointer/wheel/keyboard input, fit/focus, planet navigation,
all view types and project/chat controls. Shot trails must remain visible beyond
their former five-second lifetime and then expire after the new ten-second fade.
It uses Node 22+ and Electron's local
debugging protocol without a separate browser or Playwright installation.

`checks/renderer-recovery.cjs` drives the built app (`npm run build`) through
Playwright's Electron support; set `PLAYWRIGHT_MODULE` to a Playwright install. It reads
viewer state through the globals in `viewer/app/check-surface.ts`.

`checks/planet-traffic.cjs` drives the actual Electron app with bundled car models.
It checks automatic traffic before any traffic-button click, moving instance
matrices, structural routes for straight/branching/empty methods, independent
per-town pause/resume, bounded vehicles, and cleanup after leaving the planet.
It also loads the actual traffic source as a large-method fixture and checks
that cars project onto the visible side of the viewport, including callback routes.
Run after `npm run build`, with `PLAYWRIGHT_MODULE` set to an installed Playwright.

## Explorer and editor

`npm run build && node checks/chat-features-desktop.mjs` checks actual Electron question cards in Plan
and Work modes, choices and custom answers, sent and returned local images, the image viewer, history
reload, message copy/reuse/reply controls, dark dropdown options and slash-command validation. It uses
the local app-server fixture with no inference calls. `node checks/chat-features.cjs` covers transcript
image scope, symlink escapes, project attachment ownership and native edit-menu actions in `npm test`.

`node checks/activity-desktop.mjs` additionally verifies that source bodies survive creation, file markers
survive a galaxy rebuild until deletion, and file-index changes cannot leave existing bodies shrunk.

For native Windows verification, right-click a misspelled word in the chat composer and select a correction.
Confirm that the spelling/edit menu and model, effort and permission dropdowns have readable dark surfaces.
Windows/Linux use the bundled English dictionary in `viewer/dictionaries`; macOS uses native spelling.
The dictionary loads locally without giving the renderer remote network access.

`npm run build && node checks/explorer-desktop.mjs` drives the actual Electron window with real pointer
and keyboard input. It covers lazy file trees, preview/pinned/dirty tabs, Monaco typing/undo/find,
Cmd/Ctrl+S saving to disk, native filesystem updates, conflicting saves, unsupported files, both sidebar
collapse/restore controls and shortcuts, retained chat drafts, compact layouts, persisted visibility,
and keyboard tree navigation. Screenshots are written to `screenshots/explorer-review/index.html`.

`node checks/workspace-files.cjs` checks scoped filesystem access, natural sorting, UTF-8/BOM/CRLF,
permissions, atomic writes, conflicts, symlinks, binary/size limits, and directory watching.
`node checks/editor-documents.mjs` checks document previews, pinning, save/discard/cancel, saves during
typing, Save All failures, external updates, and workspace replacement. Both run in `npm test`.

## Planet appearance

`node checks/planet-library.mjs` verifies the bundled Perilune/Tripo catalog, attribution,
material encodings, GLB budgets, and relief seams/poles. It runs in `npm test`.

`npm run build && node checks/planet-library-desktop.mjs` checks every library asset in
the actual Electron constellation, direct picking, file add/delete and index changes,
palette continuity on landing, and project/chat controls. Its gallery and verification
record are saved under `screenshots/planet-library-review/`. See the
[asset documentation](../viewer/assets/planets/README.md) for authoring and limits.

`npm run build && node checks/layout-identity-desktop.mjs` edits a real project on disk while landed:
- it renames a method, renames and moves the file, and adds a method that sorts first;
- it then restarts the app on the same state directory;
- it asserts the planet's look, its identity seed and every town's layout key and anchors stay the same.

Screenshots are saved under `screenshots/layout-identity/`.

`npm run build && node checks/planet-handoff-desktop.mjs` opens a source copy of this repository, lands on `viewer/planet/planet.js` and two more files, captures their landing views and checks region towns, code terrain, route clearance, frame errors and the short distance-band crossfade. Screenshots go to `screenshots/planet-handoff/`.

`npm run build && node checks/source-index-desktop.mjs` lands on real files by line, from orbit and on the ground. It checks:
- same-line statements: ambiguous by line, exact by column;
- nested callbacks;
- a line outside any statement: reported as unmapped and never snapped;
- stale revisions.

Screenshots are saved under `screenshots/source-index/`.

`node checks/planet-appearance.mjs` checks deterministic file climates, finite terrain,
submerged channels, and agreement between the visible relief and the hydrated heights
used by buildings and transport. Climate changes must preserve semantic ownership.
This check runs in `npm test`.

`npm run build && node checks/planet-appearance-desktop.mjs` reviews the real Electron
renderer at orbital, daylight, shaded, polar and surface viewpoints. It checks shader
errors, atmosphere/cloud layers, FPS/breadcrumb spacing, and native project/chat controls.
Screenshots and a gallery are saved under `screenshots/planet-review/`.

### Incremental towns and captured stacks

`node checks/layout-identity-desktop.mjs` also asserts unchanged town renderers survive edits and file moves, and identity keys survive method insertion. It launches through `npm run desktop`. `node checks/source-index-desktop.mjs` exercises the real Display → Captured stack JSON input, recursive frame numbers, explicit async links and cross-file boundaries, selection, ship pause, invalid-capture recovery, retained indexes and stale captures after a source edit. These are recorded fixtures, not live-debugger evidence; no pixel baseline was added.

The 245-file Electron review and 300-town timing/retention results are recorded in [planet-towns-progress.md](design/planet-towns-progress.md#large-project-review), including the remaining performance-budget limitations.

`node checks/planet-zoom-desktop.mjs` launches through `npm run desktop` against a
fresh source copy of the larger project plus a 301-town file. It measures frames
and long tasks starting before entry, including construction and first GPU use,
for a real source file, the stress file, and repeat entry. It checks bounded town
rendering, unique town representations, car preparation, frame errors and rapid
cancellation. Wider planet views also check calls between simplified towns and evidence anchoring across LOD. Failed runs
write a full `failure.json` and end with the assertion and artifact path.
Guards reject tasks of 80 ms or more and frames of 100 ms or more;
they do not assert a 16.7 ms budget for every cold frame. JSON measurements and
Electron screenshots go to the printed temporary directory, with no pixel baseline.

## Live debugger checks

`node checks/node-debug.cjs` ports the Node regression suite to js-debug: native and mapped
TypeScript, recursive/async frames, stepping, scopes, tracepoints and stale source/handles.
`node checks/debug-adapters-live.mjs` exercises JS, Python and Java probes and interactive
sessions, node:test child connections, pytest, and process cleanup using `ps`. Neither
check is in OFFLINE_CHECKS. Both print a skip and exit successfully when loopback socket
binding fails with EPERM. Run them outside that sandbox to establish live adapter behavior.
They install the pinned artifacts from the scratch artifact directory in `checks/debug-support.cjs`
into temporary roots; Java additionally requires jdtls and Java 21+, and Python requires pytest.
See [debugging.md](debugging.md) for the engine and provisioning contract.

`node checks/problems-live.mjs` installs pinned TypeScript/Pyright tarballs from the
local artifact directory and checks real diagnostics, TS error clearing, shared Java
diagnostics when jdtls/Java 21+ are available, and server process-group cleanup. It
is intentionally excluded from OFFLINE_CHECKS and uses stdio rather than sockets.
See [problems.md](problems.md) for coverage, settings and provisioning.

### IDE panels

| Command | Coverage |
| --- | --- |
| `GALAXY_DEBUG_ADAPTERS=/absolute/preinstalled/adapters node checks/ide-panels-desktop.mjs` | Actual Electron Problems status/panel, diagnostic navigation and markers, Personal settings persistence, detected debug configuration, exception pause and evaluation. Screenshots are saved to the printed temporary directory. |

Run `npm run bundle:viewer && npm run build` first. The IDE check never installs adapters;
it requires a pre-installed js-debug and the evaluate main handler. It clearly skips
only the Problems portion when `problemsGet` rejects. With Problems available, the
TypeScript language server must be ready to report the fixture's type error. An
Electron run is required to establish UI/runtime verification; offline passes alone
do not establish it.
