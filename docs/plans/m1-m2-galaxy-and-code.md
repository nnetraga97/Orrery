# M1 + M2 Implementation Plan: the galaxy in VR, and reading code

> **How to use this plan.** Do the tasks in order. Each task says what to build, the files, the rules it must obey,
> how to check it, and the commit message. Tick a step's checkbox (`- [ ]` to `- [x]`) only when its check passes.
> No plugin or workflow tool is required. When a check fails and the task's notes do not cover it, stop and report
> (rule 9).

**Goal:** In a headset, see the codebase as a galaxy on a table, turn and zoom it with your hands, pick a file and watch it rise as a globe, then open any function and read its real code on a floating page that is linked to the buildings.

**Architecture:** IWSDK owns the renderer and the frame loop. The copied galaxy code is never told it is in VR: it keeps a *virtual camera*, and one small piece of pure math turns "where that camera is looking" into "where the model sits on the table". Text lives on flat floating panels drawn with the 2D canvas and shown as textures. Decisions live in `src/core/` as plain functions with unit tests; IWSDK systems stay thin.

**Tech stack:** TypeScript, IWSDK 1.1.0-rc.2 (three.js via `@iwsdk/core`), the 2D canvas API, Node's built-in test runner, Playwright.

**Read first:** `docs/design.md` §4.0–4.3 and §5, `src/README.md`, `galaxy/README.md`, and `src/flat/flat-host.js` (a complete working host, your template).

---

## Read this first

### Where you start

Branch `m1-m4-plans` contains the finished M0 work plus this plan. Create your branch from it:

```bash
git fetch origin && git checkout -b m1-m2 origin/m1-m4-plans && npm install && npx playwright install chromium
npm run verify
```

Expected: `npm run verify` ends with `SMOKE PASSED` twice. It runs, in order: typecheck, import rules and offline checks, core unit tests, build, the flat-view smoke test, and the XR-page smoke test. **Run `npm run verify` before every commit in this plan.** (Until Task 1, the starter page fetches a sample robot from a public CDN, so its smoke test needs a network connection.)

### The four ideas this plan rests on

**1. The virtual camera.** The copied code (`galaxy/`) moves a camera to navigate: flying to a file, following a moving planet, zooming into a town. In a headset the real camera is the user's head and must never be moved by code. So the copied code keeps an ordinary `PerspectiveCamera` that is *never rendered from*. Every frame, one function converts that camera into a pose for the whole galaxy model:

```
model pose  =  table anchor  ∘  scale(s)  ∘  inverse(virtual camera looking at its target)
s           =  TABLE_WIDTH / (2 · d · tan(fov / 2))        d = distance from virtual camera to its target
```

In words: whatever the desktop camera would have shown in the middle of the monitor sits in the middle of the table, at a size that fills the table, turned the way that camera saw it. Flying to a planet makes the planet grow on the table. Orbiting turns the model. Following a moving planet keeps it centred while the galaxy drifts around it. No copied navigation code changes.

**2. The copied code sees a normal page.** It looks up page elements by id and writes HTML into them. `index.html` gets a hidden block with those ids, exactly as `flat.html` has. Nothing in it is ever visible; it just stops the copied code from failing.

**3. Text is drawn on a 2D canvas and shown as a texture.** Each panel is a flat rectangle in the world whose picture is drawn with the browser's ordinary canvas text. This gives monospace code, syntax colours, highlights and colour emoji with no font atlas, and it means every panel can also be shown on a plain test page and checked with a screenshot. A pinch on a panel arrives as a pointer event carrying the hit position (`event.uv`); the panel maps that to the button or line under it.

**4. Hands drive the virtual camera, not the model.** Pinch and drag in the air turns the model (orbit). Two pinches moving apart or together zoom it (dolly). Because the model's pose is computed from the virtual camera, IWSDK's grab components are not used on the galaxy: they would fight that computation.

### Measured facts you can rely on

- A pointer event on a three.js object (from a mouse in a browser tab, or a hand ray in VR) has `event.uv`, `event.point`, `event.ray`, `event.instanceId` and `event.object`. Listen with `object.addEventListener('click' | 'pointermove' | 'pointerdown' | 'pointerup' | 'wheel', handler)`. The entity needs the `RayInteractable` component.
- A hand pinch is the hand's "select". `this.input.xr.gamepads.left|right` has `getSelectStart()`, `getSelecting()`, `getSelectEnd()`. Hand positions: `this.player.raySpaces.left|right` and `gripSpaces.left|right` (`getWorldPosition`).
- `world.camera.position` is relative to the player rig. Use `this.player.head.getWorldPosition(v)` for the real head position.
- Attach three.js content with `world.createTransformEntity(object3D)`.
- The IWSDK API reference is in the repository: `.claude/skills/iwsdk-dev/references/api-reference.md`. Check a signature there, or in `node_modules/@iwsdk/core/dist/**/*.d.ts`, before guessing.
- Emulated hands and rays for testing: `.claude/skills/iwsdk-ray/SKILL.md` and `iwsdk-grab/SKILL.md` (`npx @iwsdk/cli xr ...`).

### What the scene code expects (measured from the code)

**Host** members and how often they are used: `data.nodes` 64, `dom` 18, `data.revision` 17, `data.dataset` 14, `graph.color` 13, `windows.worldAnchor` 9, `graph.groupOf` 9, `data.inc` 9, `data.out` 6, `actions.selectFile` 6, `windows.context.pin` 5, `windows.context.close` 5, `windows.context.hover` 4, `graph.importUse` 4, `data.links` 4, `data.groups` 4, `windows.context.pinned` 3, `stage.viewport.get` 3, `projects.has` 3, `memory.fileAppearance` 3, `graph.nodeOf` 3, `actions.enterPlanet` 3, and once or twice each: `windows.context.esc/refresh/place`, `preferences.remember/recall`, `memory.layoutNotice/townKeys/save/layout`, `data.grouping/groupIndex`, `actions.showHover/render/exitPlanet`, `stage.viewport.subscribe/refresh`, `stage.element`, `stage.createObstacles`, `source.open`, `overview`, `loading.begin/paint`, `inspector.create/highlightSource`, `graph.membersOf/importsIndexed/groupArms/fetchSymbols`, `debug.selectFrame`.

**Scene kit** (`T`) members: `camera` 67, `scene` 48, `onFrame` 31, `controls` 31, `flyTo` 25, `navigationRevision` 18, `addLabels` 15, `addPicker` 6, `setFollowing` 5, `beforeCamera` 5, `interruptNavigation` 3, `setPickBlock` 2, `setMarkerHidden` 2, `select` 2, `prepareTexture` 2, `following` 2, `flying` 2, `clearControlMotion` 2, `cancelFlight` 2, and once each: `setPick`, `setLabels`, `afterCamera`, `addOverlay`, `prepareDraw`, `isSelectionClick`, `navigation`, `anchorOf`, `pinned`, `highlight`, `bodyFrame`, `runFrameCallbacks`, `frameErrors`, `resize`, `setTint`, `stop`. The constellation then adds its own members to `T` (`land`, `leave`, `update`, `overview`, `landed`, `executionAt`, `runtimeStack`, ...); you do not implement those.

**Inspector** object returned by `host.inspector.create(options)`: `setTab`, `stackChanged`, `hover`, `windowFor`, `transportStatus`, `showStatement`, `setRegion`, `openMethod`, `evidenceChanged`, `dispose`. The options it receives are listed in `galaxy/viewer/planet/planet-detail.js` lines 42–100 (callbacks such as `onStatement`, `onMethod`, `onFit`, and data such as `source`, `colored`, `regions`, `towns`).

**Camera writes in the copied code** (all write the virtual camera, so all keep working): `galaxy/constellation.js:81-82`, `constellation-navigation.js:109-110,145-146,163-165`, `execution-ship.js:228-229`, `planet/planet-interaction.js:185`.

### The desktop app's repository is next door

The desktop app this project was copied from, `codebase-viz`, is checked out in the same parent folder as this
repository (normally `../codebase-viz`; confirm with `ls ..`). You may read it whenever `reference/` does not have
what you need: how a desktop panel behaves, a file that was not copied, the history of a function.

- **Read only.** Never edit, commit or run installs in that folder.
- **Nothing here may depend on it.** No import, build step, test or script in this repository may reach into
  `../codebase-viz`, except the two refresh tools that take its path as an argument (`tools/migrate/copy-code.sh`
  and `npm run assets`), and only when a task tells you to run them.
- **Do not copy more code across by hand.** If a task needs a file that is not in `galaxy/` or `reference/`, add it
  to `tools/migrate/copy-code.sh`, run the script, and say so in the commit.
- If the folder is not there, carry on: everything the plan requires is already in this repository.

### Rules

1. **Do not edit files under `galaxy/`**, except `galaxy/viewer/app/static-data.js` and `project-store.ts`. If copied code must change, add an exact find-and-replace to `tools/migrate/apply-patches.mjs`, run it, and say so in the commit.
2. **Follow `src/README.md`.** `npm run check` fails on a wrong import. Pure decisions go in `src/core/` with tests; `src/core/` imports no packages and no browser APIs.
3. **Core files are plain TypeScript that Node can run directly:** import other files with the `.ts` extension, use `import type` for types, and do not use `enum`, `namespace` or constructor parameter properties.
4. **Every core module gets a `*.test.ts` beside it**, written before the module, using `node:test` and `node:assert/strict`. `npm run test:core` runs them.
5. **three.js comes from `@iwsdk/core`** in `src/` (not from `three`), except in `src/flat/`.
6. **In systems:** iterate queries, allocate nothing inside `update()`, push every unsubscribe function into `this.cleanupFuncs`.
7. **Hands only.** Nothing may need a controller, a keyboard or typing. Every target is reachable from a seat: panels 0.9–1.2 m away, nothing to touch beyond 0.6 m.
8. **No API keys, no model calls, no `.env` files** in this plan.
9. **Stop and report** when a check fails and the notes do not cover it, when an IWSDK API does not exist as described, or when a task would need a change the plan does not mention. Say the task and step and paste the output.
10. **Commit after every task** with the given message, on branch `m1-m2`. Do not merge into `main`.

### Test hook

The XR page exposes one object for tests, set in `src/index.ts`:

```ts
window.__orrery = { world, state, kit, commands };   // filled in as tasks add them
```

`npm run smoke:xr -- --wait="window.__orrery?.ready" --read="<expression>"` loads the page as an ordinary browser tab, waits, evaluates the expression and prints it as JSON. Tasks below give the exact expression and the expected output. In a browser tab the mouse acts as a ray, so clicking, dragging and the wheel exercise the same code paths as hands.

---

## File structure this plan creates

```
index.html                              + hidden legacy block, + canvas container
panels.html                             test page: every panel drawn on a plain canvas
src/index.ts                            composition root (replaces the starter's)
src/core/table-frame.ts                 virtual camera -> model pose
src/core/orbit.ts                       hand and mouse gestures -> camera orbit, dolly
src/core/labels.ts                      which labels show, and how big
src/core/panel-hit.ts                   hit regions and uv -> pixel mapping
src/core/code-view.ts                   source + tokens + selection -> visible lines
src/core/scroll.ts                      drag-to-scroll with limits
src/core/layout.ts                      where panels sit around the seat
src/core/tutorial.ts                    tutorial steps as a state machine
src/ports/host.ts, scene-kit.ts         typed contracts for the copied code
src/ports/dataset.ts, storage.ts        dataset and storage contracts
src/adapters/static-dataset.ts, local-storage.ts
src/state/app-state.ts, commands.ts     signals and typed commands
src/galaxy-bridge/scene-kit.js          the XR scene kit (derived from scene3d.js)
src/galaxy-bridge/xr-host.ts            the XR host (derived from flat-host.js)
src/galaxy-bridge/label-layer.ts        labels as sprites
src/galaxy-bridge/overlay-layer.ts      landed planets inside the model
src/galaxy-bridge/pointer-bridge.ts     pointer events -> the copied picking code
src/galaxy-bridge/inspector.ts          the inspector contract -> code page
src/galaxy-bridge/highlight.ts          syntax tokens for a source file
src/panels/canvas-panel.ts              a textured rectangle that takes pinches
src/panels/draw-*.ts                    one drawing function per panel
src/systems/*.ts                        GalaxySystem, ManipulationSystem, PanelSystem, DockSystem, TutorialSystem
src/components/*.ts                     GalaxyRoot, Panel
public/data/index.json                  the list of projects
```

---

# Part 1 (M1): the galaxy on the table

### Task 1: Replace the starter with an empty room

**Files:**
- Delete: `src/robot.ts`, `src/robot-component.ts`, `src/panel.ts`, `src/scene-assets/`, `public/ui/*.uikitml`, `public/audio/chime.mp3`
- Modify: `src/index.ts`, `src/components.ts`, `src/assets.ts`, `public/scenes/main.iwsdk.scene.json`, `index.html`

- [x] **Step 1.** Read `.claude/rules/scene-json.md` and `.claude/rules/assets-and-manifest.md`. Empty the scene to the document shape those rules give (no nodes that reference the robot, panels or decor; keep the environment components on the level root if the starter put them there). Empty the asset and component manifests to match. `src/assets.ts` and `src/components.ts` must still export what `iwsdk.config.json` expects.
- [x] **Step 2.** `src/index.ts` becomes the composition root: create the world from `virtual:iwsdk-project`, then set `window.__orrery = { world, ready: true }`. Add a `src/globals.d.ts` declaring `__orrery` on `Window`.
- [x] **Step 3.** In `index.html`, add inside `<body>` a block `<div id="legacy" hidden>…</div>` containing every element with an `id` that `flat.html` has inside `#stage` and `#hud` (copy them; keep the ids; drop the styles).
- [x] **Step 4. Check.** `npm run verify`. Then:
  `npm run smoke:xr -- --wait="window.__orrery?.ready" --read="!!document.getElementById('cameraOptions') && !!document.getElementById('labels')"`
  Expected: `"read": true` and `SMOKE PASSED`, with no error about a `robot` asset.
- [x] **Step 5. Commit:** `Replace the starter scene with an empty room`

### Task 2: The pose math

**Files:** Create `src/core/table-frame.ts`, `src/core/table-frame.test.ts`.

Vectors are `[x, y, z]` number arrays and quaternions `[x, y, z, w]`. Write the small helpers you need (subtract, length, normalise, cross, quaternion multiply, conjugate, rotate a vector, quaternion from a look direction and an up vector) in the same file; core may not import three.js.

```ts
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export interface VirtualCamera { position: Vec3; target: Vec3; up: Vec3; fovDegrees: number; }
export interface TableAnchor { position: Vec3; orientation: Quat; width: number; minScale: number; maxScale: number; }
export interface Pose { position: Vec3; orientation: Quat; scale: number; }
/** The pose of the model root so that the camera's target sits on the anchor, sized to the table. */
export function tablePose(camera: VirtualCamera, anchor: TableAnchor): Pose;
/** Maps a point in model space to room space under a pose. */
export function modelToRoom(point: Vec3, pose: Pose): Vec3;
/** Maps a point in room space back to model space. */
export function roomToModel(point: Vec3, pose: Pose): Vec3;
```

Rules: `scale = clamp(anchor.width / (2 · d · tan(fov/2)), minScale, maxScale)`. The camera frame has −Z pointing from the camera to the target and +Y along `up` made perpendicular to that. `orientation = anchor.orientation ∘ inverse(cameraOrientation)`. `position` is chosen so `modelToRoom(camera.target) = anchor.position`. If the camera is at its target (`d` under 1e-6) use `d = 1e-6`.

- [x] **Step 1. Tests first.** Cover: (a) `modelToRoom(target, pose)` equals `anchor.position` for five varied cameras; (b) the camera's own position maps to a point `scale · d` from the anchor along the anchor's +Z; (c) halving `d` doubles `scale`; (d) scale is clamped at both limits; (e) `roomToModel(modelToRoom(p))` returns `p` within 1e-9; (f) a camera looking straight down −Z with +Y up and an identity anchor gives identity orientation.
- [x] **Step 2.** Run `npm run test:core`. Expected: the new tests fail because the module does not exist.
- [x] **Step 3.** Implement until `npm run test:core` passes.
- [x] **Step 4. Commit:** `Add the virtual-camera to table pose math`

### Task 3: Contracts for the copied code

**Files:** Create `src/ports/host.ts`, `src/ports/scene-kit.ts`.

- [x] **Step 1.** Write `HostPort` and `SceneKitPort` as TypeScript interfaces listing every member in "What the scene code expects" above. Take parameter and return shapes from `reference/desktop-app/viewer/app/host.ts` (the host) and from the object returned at the end of `galaxy/viewer/scene/scene3d.js` (the kit). Use `unknown` rather than `any` where a shape is not needed.
- [x] **Step 2. Check.** `npm run typecheck && npm run check`.
- [x] **Step 3. Commit:** `Describe the host and scene-kit contracts`

### Task 4: The XR scene kit

**Files:** Create `src/galaxy-bridge/scene-kit.js` (JavaScript, because it is derived from copied JavaScript), `src/galaxy-bridge/scene-kit.d.ts` (declares `createSceneKit` returning `SceneKitPort` plus the members below).

Start from a copy of `galaxy/viewer/scene/scene3d.js` and change it as this table says. Import three.js from `@iwsdk/core`, `OrbitControls` from `three/examples/jsm/controls/OrbitControls.js`, and the copied helpers (`camera-input.js`, `scene-picking.js`, `frame-loop.js`, `textures.js`, `color-space.js`) from `../../galaxy/viewer/scene/`.

| In `scene3d.js` | In the XR kit |
| --- | --- |
| `scene3D(camPos, { space }, host)` | `createSceneKit({ camPos, host, renderer, anchor })`; `renderer` is IWSDK's |
| Creates a `WebGLRenderer`, sets size, inserts its canvas | Removed. Never create or resize a renderer |
| `scene = new THREE.Scene()` with background, fog, environment | `scene = new THREE.Group()` named `galaxy-scene`. No fog. Return the sky texture as `kit.sky` so the system can use it as the room's background |
| `camera = new PerspectiveCamera(45, w/h, 0.5, 3000)` | Kept exactly, as the virtual camera. Aspect fixed at 1.6. It is never rendered from |
| `new OrbitControls(camera, renderer.domElement)` | `new OrbitControls(camera, document.createElement('div'))`: it receives no events and serves as the `target` holder that `controls.update()` keeps consistent |
| Hemisphere and directional lights added to `scene` | Kept, added to the group |
| `pointermove`, `mouseleave`, `pointerup` listeners on the canvas | Removed. Replaced by methods `pointerMove(ray)`, `pointerLeave()`, `pointerClick(ray)`, where `ray` is a `THREE.Ray` already in the model's own space. They set the kit's ray and call the existing `updatePick()` and selection logic |
| `cameraInput(controls, …)` (`navigation`) | Kept; it reads the hidden controls in `#cameraOptions`. `isSelectionClick` returns `true` |
| `flyTo`, `select`, `highlight`, follow, marker, flight stepping | Kept exactly |
| Labels: HTML elements, `ResizeObserver`, projection and overlap code | Removed. `setLabels(list)` and `addLabels(list, xf, gate)` forward to a label layer passed in as `options.labels` (Task 6) and return its remover |
| `drawFrame`: `resize()`, `renderer.render(...)`, the depth-slice passes, overlay render targets, the blend quad | Removed. The new `tick(nowMs)` does, in this order: delta time; `frames.run(onFrame)`; follow; `frames.run(beforeCamera)`; the flight step; `controls.update()`; `camera.updateMatrixWorld()`; `frames.run(afterCamera)`; marker; pick if pending; highlight particles; `overlays.forEach(o => o.sync())`; then `options.overlays.update(overlays)` (Task 8) |
| `requestAnimationFrame` loop, visibility handling, FPS counter | Removed. `GalaxySystem.update` calls `kit.tick` |
| `addOverlay(o)` | Kept: adds to the set and returns the remover |
| `prepareTexture(texture)` | `renderer.initTexture(texture)` |
| `prepareDraw(object, camera, target, checkpoint)` | Upload textures as before, then `await renderer.compileAsync(object, camera, target)`. Remove the staging scene and the zero-area warm-up draws |
| `anchorOf(i)` | Returns `null` |
| `resize()` | Empty function |
| `stop()` | Dispose what the kit created: controls, navigation, sky, environment. Not the renderer |

Add: `kit.virtual()` returning `{ position, target, up, fovDegrees }` as plain arrays for `tablePose`; `kit.orbit(dAzimuth, dPolar)`, `kit.dolly(factor)` and `kit.home()` (Task 9 fills them in; create them now as functions that call `interruptNavigation()` first).

- [x] **Step 1.** Write the file following the table.
- [x] **Step 2. Check.** `npm run typecheck && npm run check && npm run build`.
- [x] **Step 3. Commit:** `Add the XR scene kit derived from the desktop scene scaffolding`

### Task 5: The XR host and the galaxy system

**Files:** Create `src/galaxy-bridge/xr-host.ts`, `src/systems/galaxy-system.ts`, `src/components/galaxy-root.ts`, `src/ports/dataset.ts`, `src/adapters/static-dataset.ts`, `src/state/app-state.ts`, `src/state/commands.ts`. Modify `src/index.ts`, `src/components.ts`.

- [x] **Step 1. Host.** `createXrHost(services)` returns a `HostPort`. Copy the structure of `src/flat/flat-host.js`. Differences: `windows.context` and `loading` publish to signals in `app-state.ts` instead of writing to the page (`pinned`, `hovered`, `loading`); `inspector.create` returns the stand-in for now (Task 13 replaces it); `stage.viewport.get()` returns `{ width: 1600, height: 1000, left: 0, top: 0, visible: true }`; `dom` is `id => document.getElementById(id)`.
- [x] **Step 2. State.** `app-state.ts` exports signals (import `signal` from `@iwsdk/core`; if it is not exported there, from `@preact/signals-core`, and add a line to `tools/check-boundaries.mjs`'s notes in the commit message): `dataset`, `phase` (`'idle' | 'loading' | 'overview' | 'landed'`), `selectedPath`, `landedPath`, `pinned`, `hovered`, `loading`, `error`. `commands.ts` exports typed functions that change them: `openDataset(name)`, `selectFile(path | null)`, `landOn(path, line?)`, `leavePlanet()`, `goHome()`.
- [x] **Step 3. System.** `GalaxySystem` (see `.claude/rules/ecs-api.md`): in `init`, create the kit and the host, load the dataset named by `?dataset=` (default `editor-core`) exactly as `src/flat/main.js` does (`loadDataset`, `loadGalaxyMemory`, `prepare`, `regroup`, `constellation(host)`, `createAgentCannon`), register the copied `actions` as `main.js` does, attach the kit's group with `world.createTransformEntity(group)` and tag the entity `GalaxyRoot`. In `update`, call `kit.tick(time * 1000)`, then `tablePose(kit.virtual(), anchor)` and copy the pose onto the group. Use the sky as the room background. Anchor: position `[0, 0.85, -0.55]`, orientation pitched 30° down from level (the far edge tilts up toward the user), width `0.8`, `minScale 0.0005`, `maxScale 4`.
- [x] **Step 4.** Extend the test hook: `window.__orrery = { world, ready, state, commands, kit, stats }` where `stats()` returns `{ calls, triangles }` from `world.renderer.info.render` and `nodes` from the loaded dataset. `ready` becomes true only after the constellation exists.
- [x] **Step 5. Check.** `npm run verify`, then:
  `npm run smoke:xr -- --query=dataset=editor-core --wait="window.__orrery?.ready" --settle=15000 --read="({n: __orrery.stats().nodes, phase: __orrery.state.phase.value})" --out=docs/migration/xr-overview.png`
  Expected: `"read": { "n": 229, "phase": "overview" }` and `SMOKE PASSED`. Open the screenshot: a tabletop-sized galaxy below the middle of the view, labels absent (Task 6), stars behind it. If the galaxy is missing, check the pose is applied to the group and that `matrixAutoUpdate` is on.
- [x] **Step 6. Commit:** `Show the galaxy on the table`

### Task 6: Labels

**Files:** Create `src/core/labels.ts` + test, `src/galaxy-bridge/label-layer.ts`.

Core decides which labels show. It receives, per label, its direction from the head (unit vector), distance, priority, group and `maxVisible`, plus the gaze direction, and returns the indices to show and a size for each.

- [x] **Step 1. Tests first** for `chooseLabels(candidates, gaze, limits)`: fixed labels (`avoidOverlap` false) always show; among the rest higher `priority` wins; at most `limits.max` (24) show; a label more than `limits.coneDegrees` (35) from the gaze is dropped; a label within `limits.minSeparationDegrees` (4) of a shown label is dropped; `group` and `maxVisible` are respected; size is constant in angle (`limits.angularHeightDegrees`, 1.4) so world height is `2 · distance · tan(angle/2)`.
- [x] **Step 2.** Implement, then the layer: a pool of 32 sprites, each with its own 512×96 canvas texture; text drawn in white with the label's colour as a left bar; redraw a sprite only when its text changes. `setLabels(list)` and `addLabels(list, xf, gate)` keep the definitions (`text`, `pos` value or function, `col`, `visible`, `priority`, `group`, `maxVisible`, `onClick`, `action`); `update(headPosition, gazeDirection, pose)` runs once per frame from the galaxy system. Labels with `onClick` get `RayInteractable` and call it on `click`.
- [x] **Step 3. Check.** `npm run verify`; rerun the Task 5 smoke command with `--out=docs/migration/xr-overview.png`. The screenshot now shows group names such as `cursor` and `model` and file names such as `range.ts`, none overlapping.
- [x] **Step 4. Commit:** `Draw scene labels as sprites that face the viewer`

### Task 7: Pointing and picking

**Files:** Create `src/galaxy-bridge/pointer-bridge.ts`. Modify `src/systems/galaxy-system.ts`.

- [x] **Step 1.** Give the galaxy entity `RayInteractable`. On the group, listen for `pointermove`, `pointerleave`/`pointerout`, and `click`. For each, copy `event.ray`, transform it into the group's own space with the inverse of the group's world matrix, and call `kit.pointerMove(ray)`, `kit.pointerLeave()` or `kit.pointerClick(ray)`. The kit's existing logic then calls `host.actions.showHover` and `host.actions.selectFile`.
- [x] **Step 2.** The bridge must not allocate per event: keep one `Ray` and one `Matrix4`.
- [x] **Step 3. Check.** `npm run verify`, then select by command and confirm the state follows:
  `npm run smoke:xr -- --query=dataset=editor-core --wait="window.__orrery?.ready" --settle=8000 --read="(__orrery.commands.selectFile('core/range.ts'), new Promise(r => setTimeout(() => r(__orrery.state.selectedPath.value), 3000)))"`
  Expected: `"read": "core/range.ts"`. Then, with the dev server running (`npm run dev`), follow `.claude/skills/iwsdk-ray/SKILL.md` to aim an emulated ray at the galaxy and select once; `window.__orrery.state.selectedPath.value` must become a file path.
- [x] **Step 4. Commit:** `Select files by pointing and pinching`

### Task 8: Landing on a planet

**Files:** Create `src/galaxy-bridge/overlay-layer.ts`. Modify `src/galaxy-bridge/scene-kit.js`, `src/systems/galaxy-system.ts`.

A landed planet is an "overlay": an object with `scene`, `camera`, `frame()` returning `{ origin, scale }`, `sync()`, `opacity`. On the desktop it is drawn in a second pass with its own camera. Here it becomes part of the model.

- [x] **Step 1.** `overlayLayer.update(overlays)`: for each overlay, keep one `Group` child of the galaxy group; put `overlay.scene` inside it (a `Scene` may be a child of a `Group`); each frame set the group's position to `frame().origin`, its scale to `frame().scale`, and `visible = overlay.opacity > 0.02`. Remove groups whose overlay is gone.
- [x] **Step 2.** The second click on an already selected file lands, as on the desktop (`actions.selectFile` does this already). Publish `phase = 'landed'` and `landedPath` when `view.landed` becomes true, by checking it in `GalaxySystem.update`.
- [x] **Step 3. Check.** `npm run verify`, then:
  `npm run smoke:xr -- --query=dataset=editor-core --wait="window.__orrery?.ready" --settle=4000 --read="(__orrery.commands.landOn('core/range.ts'), new Promise(r => { const t = setInterval(() => { if (__orrery.state.phase.value === 'landed' && !__orrery.kit.flying) { clearInterval(t); setTimeout(() => r(__orrery.state.landedPath.value), 8000); } }, 500); }))" --out=docs/migration/xr-landed.png`
  Expected: `"read": "core/range.ts"`. The screenshot shows a globe roughly 0.5–0.7 m across on the table with coloured regions.
- [x] **Step 4. Commit:** `Raise a selected file as a globe on the table`

### Task 9: Turning and zooming with hands

**Files:** Create `src/core/orbit.ts` + test, `src/systems/manipulation-system.ts`. Modify `src/galaxy-bridge/scene-kit.js`.

- [x] **Step 1. Tests first** for the pure functions:
  `orbitFromDrag(dxMetres, dyMetres, sensitivity)` returns `{ dAzimuth, dPolar }` (0.5 m of hand travel is a half turn; polar is clamped by the caller);
  `applyOrbit(camera, dAzimuth, dPolar)` returns a new `VirtualCamera` at the same distance from the target, polar angle kept within 5°–175°;
  `applyDolly(camera, factor, minDistance, maxDistance)` moves the camera along its view line; factor 2 doubles the distance;
  `dollyFromSpread(startSpreadMetres, currentSpreadMetres)` returns `start / current` (hands apart zooms in).
- [x] **Step 2.** Implement, and make `kit.orbit` and `kit.dolly` apply them to the virtual camera (write `camera.position` and call `controls.update()`). `kit.home()` calls the constellation's home flight (`navigation` `home`).
- [x] **Step 3. System.** `ManipulationSystem.update`: read each hand's pinch (`getSelecting()`) and position. One hand pinching while the ray is **not** over a panel or a pickable body: accumulate its motion since the last frame and call `kit.orbit`. Two hands pinching: call `kit.dolly(dollyFromSpread(...))` relative to the spread when the second pinch began. A pinch that moves less than 2 cm in total is a click and belongs to Task 7, not an orbit. In a browser tab, also map mouse drag on empty space to orbit and the wheel to dolly, so tests can drive it.
- [x] **Step 4. Check.** `npm run verify`, then:
  `npm run smoke:xr -- --query=dataset=editor-core --wait="window.__orrery?.ready" --settle=6000 --read="(() => { const a = __orrery.kit.virtual().position.slice(); __orrery.kit.orbit(0.5, 0); __orrery.kit.dolly(0.5); const b = __orrery.kit.virtual().position; return a.some((v, i) => Math.abs(v - b[i]) > 1e-3); })()"`
  Expected: `"read": true`. With the dev server and emulated hands (`.claude/skills/iwsdk-grab/SKILL.md`, hand input mode), pinch, move the hand 20 cm sideways and release: the model must have turned.
- [x] **Step 5. Commit:** `Turn and zoom the model with pinch gestures`

### Task 10: Info cards, loading and errors

**Files:** Create `src/core/panel-hit.ts` + test, `src/panels/canvas-panel.ts`, `src/panels/draw-info-card.ts`, `src/systems/panel-system.ts`, `src/components/panel.ts`, `panels.html`, `src/panels/test-page.ts`. Modify `vite.config.ts` (add `panels: './panels.html'` to the build inputs), `tools/setup-after-scaffold.mjs` is **not** changed.

- [x] **Step 1. Core, tests first.** `panel-hit.ts`: `type HitRegion = { id: string; x: number; y: number; w: number; h: number }`; `regionAt(regions, px, py)` returns the last region containing the point (later regions are on top); `uvToPixel(u, v, width, height)` returns `[u·width, (1−v)·height]`.
- [x] **Step 2. `CanvasPanel`.** Owns a canvas (size given in pixels), a `CanvasTexture` (`anisotropy` at the renderer's maximum, mipmaps on, sRGB colour space), and a plane mesh sized in metres. `redraw(draw)` calls `draw(ctx, widthPx, heightPx)`, stores the returned `HitRegion[]`, and marks the texture for update. Pointer events on the mesh map `event.uv` to a region id and call `onPress(id)`, `onHover(id | null)`, `onDrag(dxPx, dyPx)`. The entity has `RayInteractable`.
- [x] **Step 3. Info card.** `drawInfoCard(ctx, w, h, card)` draws `kind`, `title`, `sub`, body text lines and action buttons, and returns one region per action plus `close`. A card comes from the pinned context item in state: `{ key, kind, title, sub, color, text, actions[{label,onClick}], anchor }`. When the item has `body` as a function, call it with a detached `<div>` and use the div's `textContent` split into lines. The card sits 12 cm above its anchor's position in the room (`anchor.world()` gives a model-space point; convert with `modelToRoom`), facing the head.
- [x] **Step 4. Loading and error.** A small card at the table centre shows the `loading` signal's title and detail while set, and the `error` signal's text with a `Retry` region.
- [x] **Step 5. Test page.** `panels.html` loads `src/panels/test-page.ts`, which draws every panel in this plan onto plain canvases stacked down the page from fixed sample data, and sets `window.__panels = { ready: true, regions }`. Add each new panel to it as later tasks create them.
- [x] **Step 6. Check.** `npm run verify`, then `node tools/smoke-page.mjs --page=panels.html --wait="window.__panels?.ready" --read="Object.keys(__panels.regions)" --out=docs/migration/panels.png`. Expected: the list includes `infoCard`; the screenshot shows a readable card with a title, two lines and two buttons.
- [x] **Step 7. Commit:** `Show context windows, loading and errors as canvas panels`

### Task 11: The room

**Files:** Modify `public/scenes/main.iwsdk.scene.json` or `src/systems/galaxy-system.ts`.

- [x] **Step 1.** Add a table: a dark disc 0.9 m across at height 0.83 m under the anchor, with a faint rim. Add a floor: a large dark disc at height 0 with a subtle radial grid, so the room has a horizon and the user is not floating. Keep the starfield sky. Nothing in the room moves.
- [x] **Step 2. Check.** `npm run verify` and the Task 5 smoke command; the screenshot shows the galaxy resting above a table.
- [x] **Step 3. Commit:** `Add a table and a floor so the room has a stable frame`

### Task 12: Part 1 review

- [x] **Step 1.** Run `npm run verify`. Then with `npm run dev`, in the emulator, do this by hand input only and note each result: enter VR; point at a planet and pinch (it is selected, a card appears); pinch it again (it rises as a globe); pinch and drag (the globe turns); two-hand pinch apart (it grows); select `Home` by calling `__orrery.commands.goHome()` (the overview returns).
- [x] **Step 2.** Run the field-of-view check in `.claude/skills/iwsdk-glasses-test/SKILL.md`. The table and both planned panel positions (Task 14) must be inside the narrower view when looking straight ahead and slightly down.
- [x] **Step 3.** Record `__orrery.stats()` for the overview and the landed globe in `docs/migration/m1-notes.md` (draw calls and triangles). These are the baseline for the performance work in the next plan.
- [x] **Step 4. Commit:** `Record the first XR milestone`

---

# Part 2 (M2): reading code

### Task 13: Source tokens and the inspector

**Files:** Create `src/galaxy-bridge/highlight.ts`, `src/galaxy-bridge/inspector.ts`. Modify `src/galaxy-bridge/xr-host.ts`, `src/state/app-state.ts`.

- [x] **Step 1. Tokens.** Port `highlightPlanetSource` from `reference/desktop-app/viewer/app/panels/planet-inspector/shared.tsx` (lines 58 onward) to `highlight.ts`. It returns, per line, segments `{ text, cls? }` with classes `tok-keyword`, `tok-string`, `tok-number`, `tok-comment` and so on. Keep its two sources: the town builder's `sourceTokens` when present, otherwise the TypeScript scanner on `window.ts`.
- [x] **Step 2. Inspector.** `createInspector(options)` stores the options and returns an object with all ten methods. Meaning: `setRegion(k)` and `openMethod(k)` set the selected function; `showStatement(element)` sets the selected source range from the element's `start`/`end` offsets or lines; `hover` sets a hovered range; `setTab`, `transportStatus`, `stackChanged`, `evidenceChanged` store their arguments in state for the next plan; `windowFor` returns `null`; `dispose` clears the code state. It publishes one signal, `codeView`: `{ file, lines (segments per line), regions, selectedRegion, selectedRange, hoveredRange, mode: 'function' | 'file' }`. Keep the `options` callbacks; Task 15 calls them.
- [x] **Step 3.** `xr-host.ts` uses `createInspector` and `highlight.ts` for `host.inspector`.
- [x] **Step 4. Check.** `npm run verify`, then land and read the state:
  `npm run smoke:xr -- --query=dataset=editor-core --wait="window.__orrery?.ready" --settle=4000 --read="(__orrery.commands.landOn('core/range.ts', 90), new Promise(r => { const t = setInterval(() => { const c = __orrery.state.codeView.value; if (c && c.lines.length) { clearInterval(t); r({ file: c.file, lines: c.lines.length, hasKeyword: JSON.stringify(c.lines).includes('tok-keyword') }); } }, 500); }))"`
  Expected: `{ "file": "core/range.ts", "lines": <more than 400>, "hasKeyword": true }`.
- [x] **Step 5. Commit:** `Feed source tokens and selections to the app state`

### Task 14: The code page

**Files:** Create `src/core/code-view.ts` + test, `src/core/scroll.ts` + test, `src/core/layout.ts` + test, `src/panels/draw-code-page.ts`. Modify `src/panels/test-page.ts`, `src/systems/panel-system.ts`. Add the dependency `@fontsource/jetbrains-mono` (an open-licence monospace font) and load its regular and bold `woff2` files with `FontFace` before the first draw.

- [x] **Step 1. Tests first: `code-view.ts`.**
  `visibleLines(view, options)` takes the `codeView` state, `rows` (35), `columns` (88) and a `scrollTop` line, and returns rows `{ number, segments, highlight: 'none' | 'selected' | 'hovered', truncated }`.
  In `function` mode the range shown is the selected region's lines plus 3 lines of context each side; in `file` mode it is the whole file.
  Lines longer than `columns` are cut and flagged `truncated`.
  `scrollToRange(view, range, rows)` returns the `scrollTop` that puts the range's first line a third of the way down, clamped.
  Tests: function mode bounds; context clipped at file start and end; highlight flags; truncation splits a segment correctly; an empty file gives no rows.
- [x] **Step 2. Tests first: `scroll.ts`.** `dragScroll(scrollTop, dyPixels, lineHeight, maxTop)` returns the new clamped `scrollTop`; `pageScroll(scrollTop, direction, rows, maxTop)` moves by `rows − 3`.
- [x] **Step 3. Tests first: `layout.ts`.** `panelPlacements(seat)` returns the position, facing and size in metres of `codePage` (right of the table), `agentPanel` (left), `dock` (front edge of the table) and `tutorial` (above the table). Tests: every panel centre is 0.9–1.2 m from the head; within ±32° horizontally and between 20° below and 12° above eye level; no two panels overlap as seen from the head.
- [x] **Step 4. Draw.** `drawCodePage(ctx, w, h, rows, meta)` on a 2048×1840 canvas for a 0.86 × 0.77 m panel: a header with the file path and function name; line numbers in a dim gutter; code in the bundled monospace font at 34 px with 50 px line height; colours per token class on a dark background; a soft band behind selected lines and a fainter one behind hovered lines; a `…` mark on truncated lines; footer buttons `Function / Whole file`, `Page up`, `Page down`. It returns hit regions `line:<number>` for every row and one per button.
- [x] **Step 5.** `PanelSystem` creates the code page at its placement when `codeView` has lines, hides it otherwise, and redraws only when `codeView`, the scroll position or the hover changes.
- [x] **Step 6. Check.** `npm run verify`; `node tools/smoke-page.mjs --page=panels.html --wait="window.__panels?.ready" --out=docs/migration/panels.png`. Open the screenshot at full size: the code is sharp, coloured, and every character of a line such as `public static containsPosition(range: IRange, position: IPosition): boolean {` is readable.
- [x] **Step 7. Commit:** `Add the floating code page`

### Task 15: Linking buildings and lines

**Files:** Modify `src/galaxy-bridge/inspector.ts`, `src/systems/panel-system.ts`, `src/state/commands.ts`.

- [x] **Step 1. Building to page.** When `showStatement` or `setRegion` changes the selection, set the page's `scrollTop` with `scrollToRange`. (A pinch on a building already reaches `showStatement` through the copied `planet-interaction.js`.)
- [x] **Step 2. Page to building.** A press on `line:<n>` calls the stored `options.onStatement(element, true)` with the smallest town element containing that line (`options.towns.elementsOf(region)` gives a region's elements with their line ranges); if the line is outside the selected function, call `options.onMethod(k)` for the region containing it first. Hovering a line sets `hoveredRange`.
- [x] **Step 3. Buttons.** `Function / Whole file` toggles `mode`; `Page up` and `Page down` use `pageScroll`; a vertical drag on the page uses `dragScroll`.
- [x] **Step 4. Commands.** Add `showCode(path, line)`: lands on the file if needed, selects the function containing the line, and scrolls there. The agent uses this in the next plan.
- [x] **Step 5. Check.** `npm run verify`, then:
  `npm run smoke:xr -- --query=dataset=editor-core --wait="window.__orrery?.ready" --settle=4000 --read="(__orrery.commands.showCode('core/range.ts', 90), new Promise(r => { const t = setInterval(() => { const c = __orrery.state.codeView.value; if (c?.selectedRange) { clearInterval(t); setTimeout(() => r(__orrery.state.codeView.value.selectedRange), 6000); } }, 500); }))" --out=docs/migration/xr-code.png`
  Expected: a range that includes line 90. The screenshot shows the globe with the code page to its right, the function's lines banded.
- [x] **Step 6. Commit:** `Link buildings and code lines in both directions`

### Task 16: The dock and the palm menu

**Files:** Create `src/panels/draw-dock.ts`, `src/systems/dock-system.ts`.

- [x] **Step 1. Dock.** A low strip at the front edge of the table with four large buttons with icons and words: `Home`, `Code`, `Agent`, `Help`. Icons come from `UIIcons.shape(name)` in `galaxy/viewer/shared/ui-icons.js`, which returns SVG markup; draw each `<path d="…">` with `new Path2D(d)` scaled from its 24-unit box (import the module through `src/galaxy-bridge/icons.ts`, since only the bridge may import `galaxy/`). `Home` calls `goHome()`; `Code` shows or hides the code page; `Agent` toggles a signal the next plan uses; `Help` restarts the tutorial.
- [x] **Step 2. Palm menu.** When the left palm faces the head (the left grip space's palm normal within 40° of the direction to the head, held for 0.3 s) show the same four buttons 8 cm above the palm, pressed with the right hand's ray. Hide it when the palm turns away. If the emulator cannot confirm the palm direction (check with `.claude/skills/iwsdk-grab/SKILL.md` in hand mode), keep the code but leave it switched off behind `state.palmMenu`, and say so in the report: the dock alone is enough.
- [x] **Step 3. Check.** `npm run verify`; panels screenshot shows the dock with four labelled icons. In the emulator, select `Home` with a ray: the phase returns to `overview`.
- [x] **Step 4. Commit:** `Add the dock and the palm menu`

### Task 17: Choosing a project

**Files:** Create `public/data/index.json`, `src/panels/draw-project-picker.ts`. Modify `tools/bake-dataset.mjs` is **not** changed; write the index by hand.

- [x] **Step 1.** `public/data/index.json`: `[{ "name": "editor-core", "title": "Editor core", "blurb": "The text model of an open-source code editor. 229 files.", "licence": "MIT" }, { "name": "sample", "title": "Source models", "blurb": "A small project for testing. 13 files." }]`. `DatasetPort.list()` reads it.
- [x] **Step 2.** On start with no `?dataset=`, show one card per project above the table; pinching one calls `openDataset(name)`. While loading, show the loading card. `?dataset=<name>` skips the picker (tests rely on this; update earlier commands only if they break). *They did: the check commands of Tasks 5–15 now pass `--query=dataset=editor-core`.*
- [x] **Step 3. Check.** `npm run verify`; `npm run smoke:xr -- --wait="window.__orrery?.ready" --read="__orrery.state.phase.value"` gives `"idle"` with the picker in the screenshot; with `--query=dataset=editor-core` it gives `"overview"`.
- [x] **Step 4. Commit:** `Choose a project from cards on the table`

### Task 18: The tutorial

**Files:** Create `src/core/tutorial.ts` + test, `src/panels/draw-tutorial.ts`, `src/systems/tutorial-system.ts`, `src/ports/storage.ts`, `src/adapters/local-storage.ts`.

- [ ] **Step 1. Tests first.** `tutorial.ts` is a state machine: `nextStep(step, event)` over the steps `point` (point at the glowing planet and pinch) → `turn` (pinch in the air and drag) → `open` (pinch the planet again) → `read` (pinch a building) → `done`, advanced by the events `selected`, `orbited`, `landed`, `statementShown`; `skip` goes to `done` from anywhere; unknown events leave the step unchanged.
- [ ] **Step 2.** A small panel above the table shows one short sentence per step and a `Skip` button, with a drawn hand icon showing the gesture. The system raises the events from state changes, makes one planet pulse during `point`, and stores "seen" through `StoragePort` so it runs once. `Help` on the dock restarts it. No step needs more than twelve words.
- [ ] **Step 3. Check.** `npm run verify`; panels screenshot shows each tutorial step. In the emulator, complete the four steps with hand input only.
- [ ] **Step 4. Commit:** `Teach the four gestures in a skippable tutorial`

### Task 19: Review and report

- [ ] **Step 1.** `npm run verify`. Repeat the hand-only walk-through of Task 12 and add: open a town, read its code, pinch a line and see its building glow, scroll, switch to whole file, press `Home`.
- [ ] **Step 2.** Repeat the field-of-view check with the code page and dock visible.
- [ ] **Step 3.** Update `docs/migration/m1-notes.md` with `__orrery.stats()` for overview, landed, and landed with the code page.
- [ ] **Step 4.** Push: `git push -u origin m1-m2`. Do not merge.
- [ ] **Step 5. Report:** which tasks passed; anything that differed; whether the palm menu is on or off; the three stats; anything in the copied code you had to patch; and what could only be judged in a real headset (text sharpness, reach, comfort).

---

## Notes on how this plan was checked

- **Checked ahead of time:** the scaffold on `m1-m4-plans` builds and typechecks; `npm run test:core` runs TypeScript tests with no extra dependency; `tools/smoke-page.mjs` loads the XR page as a browser tab and reads page state; pointer events on objects carry `uv`, `ray` and `instanceId` (from the installed type definitions); the lists of host, scene-kit and inspector members and of camera writes were measured from the copied code.
- **Not checked ahead of time:** the XR scene kit itself, the pose math in a headset, and hand gestures. Each has a browser-tab check here and an emulator check; text sharpness and comfort can only be judged on the device.
