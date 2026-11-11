# Orrery: a voice-and-hands code editor for Meta Quest — design

Date: 2026-11-10 · Status: draft for review · Deadline: 2026-11-18 12:00 PT

## 1. What we are building

A WebXR app for Meta Quest 3/3S in which a developer fixes a bug with an AI agent,
using only hands and voice. The codebase is a tabletop galaxy; a file is a planet; a
function is a town; a statement is a building. The agent shows where the bug lives,
proposes a fix, and the developer reads the code, reviews the diff and accepts it.

Entered in the **Productivity** track, **New Experience** division, of the Meta VR
Start Developer Competition 2026. Special-award target: **Best Agentic Interaction**.

### The judged moment (5–10 minutes)

1. Put the headset on. A short hands-only tutorial: pinch to select, grab to turn the galaxy.
2. The sample project opens: the text model of the VS Code editor, 229 files. A problem card says what is broken.
3. Ask the agent, by voice, to find the bug. It calls tools: the galaxy turns to a
   planet, the planet rises as a globe, one town lights up, the code panel opens on the lines.
4. Talk it through. The agent proposes an edit; a diff panel shows it.
5. Pinch **Accept**. The cannon fires, the town rebuilds, the scripted debugger replay
   runs the fixed path and the problem card turns green.

### Constraints that shape everything

| Rule | Consequence |
| --- | --- |
| Fully usable with hands; no controller | Every screen is pinch, grab or voice. No keyboard, no typing. |
| No third-party device may be required | No desktop companion. Analysis, files and the agent's tools run in the browser; only model calls go to our server. |
| Judged on Quest 3/3S, 60 fps minimum | A Quest asset tier and capped draw calls. |
| Seated, two-foot reach (guideline) | World-in-miniature. The user never flies; the world comes to them. |
| Frozen from the deadline until about Dec 11 | The hosted site and agent backend must stay up, free, for strangers. |
| Not a thin wrapper | With the agent off, the galaxy, code reading and replay still work. |
| No brand names | Asset keys named after car brands are renamed during migration. |

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Framework | **Immersive Web SDK (IWSDK) 1.1.0-rc.2** on three.js. See §3. |
| Repository | `nnetraga97/orrery`, new and public. Code is copied from `codebase-viz`, not shared. |
| Product name | **Orrery** (a tabletop model of orbiting bodies), confirmed by the owner. The word "Meta" must not appear in anything shown to users, because the rules forbid implying association. |
| View | Constellation and planet towns. The circuit board and country map are not ported. |
| Passthrough | None. Full VR. |
| Editing | No manual text entry. Edits come from the agent and are accepted or rejected by hand. |
| Sample project | The VS Code editor's text model: `src/vs/editor/common` of `microsoft/vscode` (MIT), 229 TypeScript files, baked as `public/data/editor-core/`. One prepared bug, chosen in M2. See §4.4. |
| Agent | Real model calls. Three providers: Claude (the default), OpenAI and Nemotron. Keys are held on the server; people using the app never supply one. The owner supplies a Claude key; a provider is offered only when its key is set. Built and tested without keys until the first live check. See §4.5. |
| Voice | Required to work. Push-to-talk, using the browser's built-in speech recognition. See §4.6. |
| Debugger | Kept, as a scripted replay of a recorded run. |
| Hosting | Static site plus serverless functions on Vercel. Set up later; not part of M0. |
| Headset testing | Emulator for development; one two-hour session on a borrowed Quest before submission. |

## 3. Why IWSDK

Options were IWSDK, or plain three.js with `renderer.xr`.

| | IWSDK | Plain three.js WebXR |
| --- | --- | --- |
| Named in the rules as the web path | Yes | No (WebXR is implied, IWSDK is named) |
| Hand ray, pinch, grab | Built in | Hand-written |
| Spatial UI | Built in (`@pmndrs/uikit`, MSDF text, includes monospace fonts) | Bring your own |
| Testing without a headset | Emulator, hand and gaze input from a CLI, screenshots, a Quest-and-glasses field-of-view check | Emulator only, driven by hand |
| Agent tooling for whoever implements it | Ships skills and an MCP bridge for coding agents | None |
| Fit with existing scene code | Same three.js; IWSDK owns the renderer and frame loop | Keep our renderer |
| Risk | Release candidate; pins three.js to a fork (`super-three@0.185.0`) | None from a framework |

**Decision: IWSDK.** With no headset for most of the week and a lower-capability model
doing the implementation, the emulator and its command-line control are worth more
than keeping our own renderer. Verified in a dry run: the copied scene code builds
against `super-three@0.185.0` with a single copy of three.js in the bundle.

Costs accepted:

- IWSDK creates the renderer, camera and frame loop. `galaxy/viewer/scene/scene3d.js`
  cannot be used in the XR app (§4.2).
- New code imports three.js from `@iwsdk/core`. Copied code keeps `from 'three'`,
  which resolves to the same package through the alias.
- If the release candidate has a blocking defect, the fallback is plain
  `renderer.xr` with `@pmndrs/uikit` used directly. The scene-kit boundary in §4.2
  keeps that swap contained.

## 4. Architecture

### 4.0 Code structure: ports and adapters around an ECS shell

Four established patterns, each answering one problem this project actually has:

| Problem here | Pattern | What it means in this repository |
| --- | --- | --- |
| The framework is a release candidate, the agent and speech services may change, and there is no headset to test on | **Ports and adapters** (hexagonal architecture) | Everything outside the app sits behind an interface in `src/ports/`. Each has a real adapter and a recorded fake. A composition root wires them; nothing else names a concrete adapter. |
| Most logic must be testable without a browser, a GPU or a headset | **Functional core, imperative shell** | Decisions live in `src/core/` as plain functions over plain data: the workspace, edits and diffs, the session's steps, the transcript, replay stepping. IWSDK systems are the thin shell that feeds them input and applies their results. |
| 21,000 lines of desktop scene code must keep working while the shell around them is replaced | **Anti-corruption layer** and **branch by abstraction** | The copied code is never edited to know about XR. `src/galaxy-bridge/` implements the two contracts it already expects (§4.1). The flat view and the XR app are two implementations behind the same contracts, so either can be checked against the other. |
| Spatial panels and the 3D world must not fight over state | **One-way data flow with signals and typed commands** | The world is the source of truth. Systems publish small immutable snapshots as signals; panels render them; a pinch sends a typed command back. This is the boundary Meta's IWSDK guide prescribes, and it reuses the signals library IWSDK already ships rather than adding a second store. |

Inside the shell, the code follows IWSDK's entity-component-system conventions:
components hold data and are declared in system-free modules; systems hold behaviour,
iterate queries instead of keeping entity lists, allocate nothing per frame, and
register every subscription for cleanup.

```
                    +------------------------- src/index.ts (composition root) --------------------------+
                    |                                                                                    |
  hands, voice ---> |  systems/  --calls-->  core/  <--types--  ports/  <--implements--  adapters/ ------+--> agent relay,
                    |     |  ^                                                                           |    transcription,
                    |     v  | commands                                                                  |    static datasets,
                    |   state/ (signals) ---> ui/ (spatial panels)                                       |    local storage
                    |     |                                                                              |
                    |     v                                                                              |
                    |  galaxy-bridge/  --implements host and scene kit-->  galaxy/ (copied scene code)   |
                    +------------------------------------------------------------------------------------+
```

```
src/
  index.ts           composition root: world, adapters, systems
  core/              pure logic; imports nothing but itself
  ports/             interfaces: AgentPort, SpeechPort, DatasetPort, StoragePort, HostPort, SceneKitPort
  adapters/          one implementation per port, plus recorded fakes
  state/             projection signals and typed commands
  galaxy-bridge/     XR host and XR scene kit; the only XR code that imports galaxy/
  components/        ECS components, one per file (registered in components.ts)
  systems/           IWSDK systems, kept thin
  ui/                one controller per panel (markup in public/ui/*.uikitml)
  flat/              flat reference view (mouse, no XR); a test page
api/                 serverless relay functions; may share only src/core/
galaxy/              code copied from codebase-viz (see galaxy/README.md)
public/assets/       models and maps, built by tools/assets/build-assets.mjs
public/data/<name>/  baked datasets, built by tools/bake-dataset.mjs
tools/               migration, baking, asset build, checks, smoke test
reference/           read-only desktop code for later milestones
```

**The dependency rule.** Imports point inward: `adapters`, `systems`, `ui` and the
bridge may depend on `core` and `ports`; `core` depends on nothing. Stated as checks
that `npm run check` runs (`tools/check-boundaries.mjs`):

| Rule | Why |
| --- | --- |
| `core/` imports only `core/`, and no packages | It must run in plain Node for tests and be shareable with `api/` |
| `ports/` imports only `core/` and `ports/` | Interfaces must not drag in an implementation |
| Only `index.ts` (and `flat/`) import `adapters/` | Swapping a provider or a fake is a one-file change |
| Only `galaxy-bridge/` and `flat/` import `galaxy/` | One seam to the copied code |
| `galaxy/` imports nothing from `src/`, `api/` or `reference/` | The copy stays re-syncable from codebase-viz |
| Nothing imports `reference/` | It is reading material |
| `src/` imports three.js from `@iwsdk/core`, never `three` (except `flat/`) | One copy of three.js in the bundle |
| `api/` shares only `src/core/` with the app | Server functions cannot pull in browser code |

**A deliberate exception to IWSDK's house rules.** IWSDK's own review checklist flags
direct `GLTFLoader` use, raw `scene.add()` and hand-rolled raycasting. The copied
galaxy does all three internally. It is treated as one opaque subtree: attached once
through `world.createTransformEntity(root)`, with its loaders and child objects left
alone. The exception stops at the bridge: selection, hover and grabbing enter through
IWSDK's interaction components on that root, and the bridge maps a hit to a file or a
town using the picking tables the copied code already maintains.

**Tests follow the layers.** `core/` has unit tests under Node. Each port has a
contract test run against its real adapter and its fake. The copied code has its
offline checks and the flat-view smoke test. The XR shell is checked in IWSDK's
emulator, and finally on the headset.

**Each milestone is a vertical slice** through these layers (a port, its fake, the
core logic, one system, one panel), so every milestone ends with something that runs.

Sources for this section are listed in §10.

### 4.1 Two contracts the scene code depends on

The copied scene code talks to the outside through two objects. Both were measured
from the code (member, number of uses):

**Host** (`host`): data (`host.data.nodes` ×64, `revision`, `dataset`, `links`, `out`,
`inc`, `groups`), graph helpers (`host.graph.color`, `groupOf`, `importUse`,
`fetchSymbols`), actions (`selectFile`, `enterPlanet`, `exitPlanet`, `showHover`),
context windows (`host.windows.context.pin/close/hover`, `worldAnchor`), memory
(`host.memory.layout/fileAppearance/townKeys/save`), `host.dom(id)` for eleven DOM
ids, the planet inspector (`host.inspector.create`), loading, stage and preferences.

**Scene kit** (`T`, returned by `scene3D()`): `T.scene`, `T.camera`, `T.controls`,
`T.onFrame`, `T.beforeCamera`, `T.flyTo`, `T.addLabels`, `T.addPicker`, `T.setPick`,
`T.addOverlay`, `T.select`, `T.pinned`, `T.navigationRevision`, and the members the
constellation adds to it (`T.land`, `T.leave`, `T.bodyPos`, `T.executionAt`, ...).

`src/flat/flat-host.js` is a complete, working host on plain DOM. It is the template
for the XR host. In M1 both contracts become TypeScript interfaces in `src/ports/`
(`HostPort`, `SceneKitPort`), written from these measured lists, and the flat host is
checked against them too.

### 4.2 Why `scene3d.js` is replaced, not ported

`scene3d.js` assumes a desktop window in four ways that cannot hold in a headset:

| Desktop assumption | In XR |
| --- | --- |
| It owns the `WebGLRenderer` and the animation loop | IWSDK owns both |
| The camera is moved (`OrbitControls`, `flyTo`, follow) | The camera is the user's head and must never be moved by code |
| Labels are HTML elements positioned over the canvas | HTML is not drawn in an immersive session |
| A landed planet is a second scene with its own camera, drawn in an extra pass into the same depth buffer | A stereo headset renders each scene once per eye from the head pose; a second camera cannot be composited |

So M1 writes `src/xr/scene-kit.ts`: the same `T` surface, implemented for XR.

| `T` member | XR implementation |
| --- | --- |
| `T.scene` | A `Group` (the galaxy root) parented to a table anchor, scaled to about 0.8 m across |
| `T.camera` | A read-only stand-in whose position is the head pose expressed in galaxy space. IWSDK's `world.camera.position` is local to the player rig, so the bridge converts with `getWorldPosition()` and the galaxy root's inverse transform. Code that writes the camera goes through `flyTo` instead |
| `T.controls` | An object with `target` and no-op `update`; grab gestures move the galaxy root |
| `T.flyTo(p, dist)` | Tweens the galaxy root so `p` arrives in front of the user at a comfortable distance |
| `T.addLabels` | MSDF text sprites facing the user, capped in number, hidden outside a narrow field of view |
| `T.setPick`, `T.addPicker` | Fed by IWSDK hand rays; hover on ray, select on pinch |
| `T.addOverlay(body)` | The body's scene is attached to a **globe stand**: a 0.5 m globe at arm's length that the user turns by grabbing. No second camera |
| `T.onFrame`, `beforeCamera`, `afterCamera` | Called from one IWSDK system each frame |

Modules that read `T.camera.position` to choose level of detail keep working, because
the head pose expressed in galaxy space is a valid camera position. Modules that
**write** the camera (`constellation-navigation.js`, parts of `planet-interaction.js`)
are the porting work in M1, and are patched through `apply-patches.mjs`.

### 4.3 Interaction model

- **Galaxy on a table.** Grab with one hand to turn and slide it; two hands to scale.
- **Ray and pinch** selects a planet. Pinch again, or say "open", to raise it onto the globe stand.
- **Globe stand.** Grab to spin. Towns are labelled with function names. Pinch a town to open its code.
- **Panels** sit on a shallow arc at 1–1.2 m, inside a 60° wide by 40° tall region so
  they also fit the narrower field of view of Meta's glasses.
- **Palm menu** on the non-dominant hand: Home, Agent, Replay, Help.
- **Push-to-talk:** pinch and hold the microphone orb, or the palm menu's mic.
- Nothing requires reaching beyond 60 cm or turning more than 45° from forward.

### 4.4 Data without a desktop

- Datasets are baked ahead of time by the copied analyzer into
  `public/data/<name>/`: graph, per-file symbol shards, an index, and source text.
- A **workspace** object in the browser holds the sample project's files in memory.
  It starts from the baked source and takes the agent's edits. Reloading resets it.
- After an edit, the changed file is re-analyzed in the browser. This path already
  exists: `planet.js` runs the source model in the page when a file's fingerprint no
  longer matches its baked symbols (it loads `vendor/runtime/typescript.js`).
- Symbol shards are large (about 25 times the source size) but load one planet at a
  time and compress well: the demo dataset is 65 MB on disk and 4.3 MB gzipped, with a
  median shard of 145 KB and a largest of 3.4 MB.

**Why this slice of VS Code.** The whole repository is 7,894 TypeScript files and 2.3
million lines, far beyond what a tabletop galaxy or a headset can show. The editor's
text model (`src/vs/editor/common`) is 229 files and 73,000 lines with 1,010 imports
between them. It lays out as about a dozen systems with names a developer recognises
(`cursor`, `model`, `languages`, `diff`, `range.ts`, `selection.ts`), which was
checked in the flat view (`docs/migration/flat-editor-core.png`).

**A rule to watch.** The competition forbids brand names and corporate advertising in a
project. The dataset is open-source code used under its licence, and the MIT licence
requires the copyright notice ("Microsoft Corporation") to stay in the file headers
and the licence file. The app therefore titles the project neutrally ("Editor core"),
never shows a logo or product name of its own accord, and keeps the notices the
licence requires. This is a judgement call, not a certainty. If the owner prefers no
risk, a community-owned project (for example Vite's `packages/vite/src`) can be baked
with the same command.

### 4.5 Agent

```
headset browser                                   our server (serverless functions)
  transcript panel  <-- stream --  /api/agent  -->  Claude | OpenAI | Nemotron
  conversation history (append-only)                server-held keys, rate limit, daily budget
  tool executor (workspace, scene)
```

- **Nobody using the app supplies a key.** Keys live only on the server, as environment
  variables; they are never sent to the browser, never committed, and never written
  into a file git tracks.
- **Three providers, each its own adapter on the server:**

  | Provider | Server variable | Key status | Starting point |
  | --- | --- | --- | --- |
  | Claude (default) | `ANTHROPIC_API_KEY` | The owner will supply it | Official TypeScript SDK (`@anthropic-ai/sdk`); notes below |
  | OpenAI | `OPENAI_API_KEY` | Not promised | OpenAI's own SDK and current documentation |
  | Nemotron | `NEBIUS_API_KEY` | Not promised | The desktop app's working tool loop, `reference/desktop-app/engine/agent/providers/nemotron-loop.cjs` |

  The browser sees one `AgentPort` and one message format of our own; each server
  adapter translates to and from its provider. A provider's code never borrows
  another provider's SDK or a compatibility shim.
- **A provider is offered only when its key is set.** The server reports which
  providers are configured; the settings panel lists only those. With just the Claude
  key, the app runs on Claude and the other two are simply absent. Providers are
  named in plain text, with no logos, because the rules forbid corporate branding.
- **OpenAI and Nemotron cannot be checked live without their keys.** All three
  adapters are built and tested against stubbed clients. Only a provider whose key
  exists gets a live end-to-end check, and only checked providers should be switched
  on for judging.
- **The server function is small and stateless.** Each request carries the
  conversation so far and the chosen provider; the function makes one streaming call,
  relays text as it arrives, and returns the finished message. Because strangers can reach it, it enforces a per-visitor rate
  limit and a daily spend cap, and accepts only this app's tool definitions.
- **The loop and the tools run in the browser**, against the in-memory workspace and
  the scene. The browser appends each returned message to its history unchanged, runs
  the requested tools, and sends the results back in a single message:

  | Tool | Effect in the world |
  | --- | --- |
  | `list_files`, `search_code`, `read_file` | Ships fly to the planets being read |
  | `show_code(file, line)` | Galaxy turns, planet rises, town lights, code panel opens on the line |
  | `propose_edit(file, old, new)` | Diff panel opens; nothing changes until the user accepts |
  | `run_replay(name)` | The scripted debugger replay plays |

  The desktop app already defines a "show" tool and a provider-neutral event contract
  (`reference/desktop-app/engine/agent/`), which is the model for these.
- **Fallback.** When the daily budget is spent or the server is unreachable, a recorded
  run of the same bug fix plays through the same tools, labelled as a recording.

**Working without the key.** Almost all of this is built and tested with no key:

| Piece | How it is built without a key |
| --- | --- |
| `AgentPort` and the browser loop | Against `FakeAgent`, an adapter that replays a recorded session turn by turn |
| Tools, transcript, diff, panels | Driven by `FakeAgent`; unit tests in `core/` |
| The server function and its three provider adapters | Unit-tested with stubbed clients: request shaping, translation to and from our message format, rate limit, budget, error mapping |
| The recorded session itself | Hand-written first, in the shape of real messages; re-recorded from a live run once the key exists |

A key is needed at exactly two points: the first live end-to-end check at the end of
M3, and the deployed site's environment in M5. Whoever implements M3 does everything
above first, then **stops and asks the owner for the Claude key**, saying what was
built and what the key unlocks, and asks in the same message whether keys for OpenAI
or Nemotron will follow. They ask through the environment's secure credential mechanism
(in a Claude Code cloud session, the credential form for the host `api.anthropic.com`,
header `x-api-key`), never by having the owner paste a key into a chat. Before asking,
they check whether a credential is already available (`ANTHROPIC_API_KEY` set, or an
active `ant auth` profile).

**Notes for the Claude integration** (from the current API reference; re-check when M3
is written, since these move):

- Model `claude-opus-5-5`. Thinking is adaptive and cannot be turned off on this
  model; depth is set with `output_config.effort`, whose default is `medium`, so set it
  explicitly and tune it against real sessions.
- Stream every call. Mark each tool `eager_input_streaming: true`, and validate every
  tool input against its schema in the browser before running it.
- Tool choice must stay `auto`: forcing a tool is rejected on this model. Steer with the
  system prompt and use `strict: true` on tools for schema-exact arguments.
- History is append-only. Return each assistant message, thinking blocks included,
  exactly as received; editing or dropping earlier turns invalidates them.
- Check `stop_reason` before acting: never run tools from a turn that ended in
  `refusal` or `max_tokens`. Opt in to server-side refusal fallbacks
  (`fallbacks: "default"`) so a declined request is retried on another model.
- Keep the system prompt and tool list byte-stable and cache them; the workspace
  listing goes after the cache breakpoint.
- Rough cost, for sizing the cap only: at $4 per million input tokens and $20 per
  million output, a ten-turn session of about 200,000 input and 10,000 output tokens
  is around one dollar before caching. The owner sets the daily cap.

### 4.6 Voice

**Decision: the browser's built-in speech recognition.** No key, no server, no
download. (A Claude key would not have covered speech-to-text in any case.)

- Pinch-and-hold the microphone orb to talk. The recognised text appears in the
  transcript for a beat before it is sent, with a pinchable **Cancel**.
- `SpeechPort` has two adapters: the browser recognition, and a fake that returns
  scripted phrases. Voice is built and tested on the fake.
- **Known risk, accepted:** whether recognition works in the Quest browser cannot be
  confirmed until the headset session on Nov 17. The emulator runs in desktop Chromium,
  which proves the code path but not the headset. At start-up the app checks that
  recognition exists and that the microphone is permitted; if either fails it says so
  once and carries on without voice.
- Four or five suggested prompts are always pinchable, so the whole bug-fix flow can
  be completed with no microphone at all. This also serves accessibility.
- First thing to test on the headset: microphone permission inside an immersive
  session, and one recognised sentence.
- The agent's replies are text. Speech output is optional polish.

### 4.7 Debugger replay

A recorded run of the buggy and fixed code is stored as debug records (the format in
`galaxy/source-model/debug-records.js`). A replay panel steps through it; the existing
execution ship, step car and frame cards show where execution is. No runtime, no
debug adapter.

### 4.8 Decisions made while planning M1–M4

Where an earlier section and the two plans differ, the plans are newer.

| Topic | Decision | Why |
| --- | --- | --- |
| How the model is posed | The copied code keeps a virtual camera that is never rendered from. One pure function turns that camera and its target into the model's pose on the table (`src/core/table-frame.ts`). This replaces the separate "globe stand" of §4.2: a landed planet simply grows on the table | No copied navigation code has to change, and following a moving planet keeps working |
| Panels | Flat rectangles textured from the 2D canvas, not UIKit markup | Monospace code with syntax colours, colour emoji, and every panel testable on a plain page with a screenshot |
| Page elements the copied code expects | A hidden block in `index.html` with the same ids as `flat.html` | No patches to copied code |
| Hand gestures on the galaxy | Pinch-drag orbits and two-hand pinch zooms the virtual camera; IWSDK grab components are used only on panels | The model's pose is computed, so a grab component would fight it |
| Code page | Fixed beside the table, function-first with a whole-file switch | Owner's choice |
| Agent replies | Text on the chat panel; no speech output | Owner's choice |
| Chat | A floating, movable panel with every desktop chat feature in a hands-and-voice form; the parity table is in the M3 + M4 plan | Owner's request |
| Bug to fix | Scenario files in `public/scenarios/`. The first seeds an off-by-one in `Range.containsPosition` of the demo project and ships a failing and a fixed replay | Work is not blocked on choosing a real historical bug; another scenario is one more file |

### 4.9 Changes after the owner's design review

These replace the matching rows above and in §5. Details per task are in
`docs/plans/changes-after-review.md`; the look and sizes are in `docs/visual-style.md`.

| Topic | Decision |
| --- | --- |
| Code view | Not a standing window. A card of about 12 lines appears only while a function is picked, the agent points at code, or a replay runs |
| Anchoring | No leader lines. A card floats beside the thing it belongs to and can be pulled away by its grab bar, as on spatial computers |
| File info card | Removed. A selected file shows a label and a diamond |
| Navigation | A tab strip on the chat window's left edge: Home, Chat, Replay, Settings. No dock, ring menu or palm menu |
| Project picker | Removed. The app opens on the demo project; switching is in Settings |
| Replay | Kept, without a timeline. Back, Step and Play sit on the code card |
| Chat | The desktop chat box's shape, 0.40 m wide, in the new theme, with ordinary Approve and Decline buttons |
| Charts | None anywhere |
| Table | Removed. The model floats in the air at an invisible anchor, larger and more central; a dark floor with a faint grid gives the room a horizon |
| Landed planet | A globe 0.64 m across that does not grow when zoomed (the owner's choice while building). Its buildings are millimetres across, so the model and the code are linked by function: a town on one side, its lines on the other |

## 5. Desktop UI to VR

Every desktop control, and what replaces it. Source for each is under
`reference/desktop-app/viewer/app/panels/`.

| Desktop | VR | Milestone |
| --- | --- | --- |
| Toolbar (Chats, Activity, views, search) | Palm menu with four buttons, plus voice | M2 |
| Welcome, Open Folder | Sample picker: cards on the table | M2 |
| File explorer, file search | The galaxy is the explorer. "Find <name>" by voice; results as a pinchable list | M3 |
| Monaco editor | Read-only code panel: monospace MSDF text, about 40 lines, syntax colours, pinch-drag to scroll | M2 |
| Planet inspector (Flow, Source, Calls) | The code panel docked beside the globe. Selecting a building highlights its lines, and the reverse | M2 |
| Context windows (hover, pinned) | Info cards anchored to the object, facing the user | M1 |
| Scene labels (HTML) | MSDF text sprites, capped and field-of-view aware | M1 |
| Chat composer and transcript | Agent panel: transcript cards, microphone orb, suggested prompts | M3 |
| Tool approvals | Two large pinch buttons on the agent panel | M3 |
| Diff view | Diff panel with Accept and Reject per change | M3 |
| Run and Debug | Replay panel: play, step, restart; stack cards over buildings | M4 |
| Problems | Markers on buildings only | M4, cut first |
| Settings | Text size, seated height, provider (only those with a key set) | M4 |
| Loading overlay | A ring at the galaxy's centre | M1 |
| Camera controls, shortcuts | Grab gestures; "Home" on the palm menu | M1 |
| Activity history, atlas, attachments, workspace files | Not ported | — |

## 6. Is code legible on a planet today?

Checked by running the copied code in a browser (`docs/migration/flat-town.png`).

**The structure is legible; the code is not.** A town shows one function: its name as
a label, one building per statement, the building's shape chosen by what the statement
does (call, network, state write, return), and roads for control flow. That reads well
as a map of what a function is made of. But the only source text in the world is a
one-line label on the selected building (for example `L20 · Return · typeof v ===
'string'`). Reading the actual code on the desktop happens in the HTML inspector,
which does not exist in a headset.

So the town is a map, and a map is not enough to judge a fix. The design answers
this with the code panel (§5): always beside the globe, showing real source with the
selected building's lines highlighted, and the building highlighted when a line is
selected. The agent's `show_code` drives both at once.

## 7. Milestones

| | Dates | Outcome | Needs the key | Plan |
| --- | --- | --- | --- | --- |
| M0 Migration | Nov 10–11 | Repo builds; copied code runs in a browser from baked data; assets built | No | `docs/plans/m0-migration.md` |
| M1 Galaxy in XR | Nov 11–13 | XR scene kit and host; galaxy on the table; ray, pinch, orbit and zoom; landing; labels | No | `docs/plans/m1-m2-galaxy-and-code.md` |
| M2 Reading code | Nov 13–14 | Code page, town-to-code linking, dock and palm menu, project picker, tutorial | No | same plan |
| M3 Agent and voice | Nov 14–16 | Chat panel with full feature parity, browser loop and tools, three provider adapters, push-to-talk, recorded fallback | No | `docs/plans/m3-m4-agent-and-polish.md` |
| M4 Replay and polish | Nov 16–17 | Debugger replay, sound, settings, headset asset tier, frame-rate pass, then the live check | Only its live-check task | same plan |
| M5 Headset and submit | Nov 17–18 | Hosting with the key in its environment, two-hour Quest session, fixes, video, Devpost entry | Yes | |

M1 and M2 share one plan and M3 and M4 another. M5 (hosting, the device session and
submission) is planned when those land.

**Cut order if a milestone slips:** Problems markers, settings, speech output,
live OpenAI and Nemotron (ship Claude only), the replay, live agent (ship the
recorded run). Never cut:
the tutorial, the code panel, hands-only operation.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Frame rate unknown until the headset session | Quest asset tier and draw-call caps in M4; emulator frame times tracked from M1; headset session on Nov 17 leaves a day to cut detail |
| The browser's speech recognition is untested on a Quest until Nov 17 | Start-up check with a clear message; suggested prompts complete the flow without voice; `SpeechPort` allows another source later |
| IWSDK is a release candidate | Scene-kit boundary allows falling back to plain `renderer.xr` |
| Porting camera-writing modules takes longer than planned | M1 ports the constellation first, the planet second; the globe stand can ship with a simpler town view |
| The agent endpoint is abused or runs over budget during judging | Per-visitor rate limit, daily spend cap, recorded run as fallback |
| The key arrives late | Everything except the live check is built against a recorded fake; the key is asked for once, at the end of M3 |
| OpenAI and Nemotron ship without a live check | They stay switched off unless their keys arrive in time to check them; Claude alone is a complete experience |
| Hosting is set up late | The flat view and build are verified locally in M0; deploy as soon as the account exists, since size limits and headers are untested |
| Asset download too large for a fast start | Lazy loading per planet already exists; initial-load budget of 40 MB set in M4 |
| The sample's corporate copyright notices read as brand names | Neutral project title, no logos, only the notices the licence requires; a community-owned project can replace it with one command |

## 9. Open items for the owner

1. **The Claude API key and a daily spend cap.** Not needed yet: the implementer asks
   for the key at the end of M3, through a secure credential form, and it goes into
   the hosting environment in M5. Keys for OpenAI and Nemotron are optional; without
   them those two providers are built but stay switched off.
2. **The bug to fix.** A default scenario is planned: an off-by-one in the demo
   project's range check. Replace it if you prefer a real historical bug.
3. **Hosting account**, when ready. The first deployment should happen well before
   Nov 17, because it has not been tested.
4. **Start programme membership** confirmed, since it gates submission.
5. **Asset provenance sheet.** The rules let the sponsor ask for written proof of
   ownership or licence for any material. One page listing each asset family, how it
   was made (which generator, which account or plan) or where it came from, and its
   licence. Only the owner knows the plan terms behind the generated models.

## 10. Sources

- IWSDK entity-component-system concepts and custom systems:
  <https://developers.meta.com/horizon/documentation/iwsdk/concepts/ecs/>,
  <https://developers.meta.com/horizon/documentation/iwsdk/guides/07-custom-systems/>
- IWSDK guide to pairing DOM UI with the world (signals out, typed commands in, no
  second store): <https://developers.meta.com/horizon/documentation/iwsdk/guides/17-react-preact-2d-ui/>
- IWSDK's project guidance and review checklist, installed by its project generator
  (`AGENTS.md`, `.claude/rules/ecs-api.md`, `.claude/agents/iwsdk-project-code-reviewer.md`).
- Ports and adapters applied to a browser game, with a composition root:
  <https://alexop.dev/posts/hexagonal-architecture-vue/>; overview:
  <https://quality.arc42.org/approaches/hexagonal-architecture>
- Functional core, imperative shell (from Gary Bernhardt's "Boundaries" talk), as
  summarised in <https://kyle.au/notes/technology/development/functional-core-imperative-shell-pattern>
- Branch by abstraction: <https://www.martinfowler.com/bliki/BranchByAbstraction.html>
- Strangler fig and anti-corruption layer:
  <https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig>
