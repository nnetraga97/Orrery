# Voice-and-hands code editor for Meta Quest — design

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
2. Pick the sample project. A problem card says what is broken.
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
| Repository | `metavrviz`, new. Code is copied from `codebase-viz`, not shared. |
| Product name | **Open.** Must not contain "Meta" (rules forbid implying association). |
| View | Constellation and planet towns. The circuit board and country map are not ported. |
| Passthrough | None. Full VR. |
| Editing | No manual text entry. Edits come from the agent and are accepted or rejected by hand. |
| Sample project | One popular open-source JavaScript/TypeScript repository with one prepared bug. **Open: which one.** |
| Agent | Real model calls. Providers: Claude, OpenAI, Nemotron. A scripted run is the fallback. |
| Voice | Required to work. Push-to-talk; server-side transcription is the primary path. |
| Debugger | Kept, as a scripted replay of a recorded run. |
| Hosting | Static site plus serverless functions on Vercel. |
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

```
src/                 new XR app (TypeScript, IWSDK systems)
  xr/                scene kit, host, interaction, panels          (M1–M2)
  agent/             browser side of the agent: tools, transcript  (M3)
  voice/             capture and transcription client             (M3)
  flat/              flat reference view (mouse, no XR)            (M0, done)
api/                 serverless functions: agent, transcribe       (M3)
galaxy/              code copied from codebase-viz (see galaxy/README.md)
public/assets/       models and maps, built by tools/assets/build-assets.mjs
public/data/<name>/  baked datasets, built by tools/bake-dataset.mjs
tools/               migration, baking, asset build, checks, smoke test
reference/           read-only desktop code for later milestones
```

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
for the XR host.

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
| `T.camera` | The XR camera, read-only. Code that writes to it goes through `flyTo` instead |
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
- Symbol shards are large (about 30 times the source size). The sample project is
  scoped to at most about 150 files, and shards load one planet at a time.

### 4.5 Agent

```
headset browser                                   our server (Vercel functions)
  transcript panel  <-- stream --  /api/agent  -->  Claude | OpenAI | Nemotron
  tool executor (workspace, scene)                  keys, rate limit, daily budget
```

- The server holds the keys, picks the provider, enforces a per-visitor rate limit
  and a daily spend cap, and streams model output. It keeps no project state.
- **Tools run in the browser**, against the in-memory workspace and the scene:

  | Tool | Effect in the world |
  | --- | --- |
  | `list_files`, `search_code`, `read_file` | Ships fly to the planets being read |
  | `show_code(file, line)` | Galaxy turns, planet rises, town lights, code panel opens on the line |
  | `propose_edit(file, old, new)` | Diff panel opens; nothing changes until the user accepts |
  | `run_replay(name)` | The scripted debugger replay plays |

  The desktop app already defines a "show" tool and a provider-neutral event contract
  (`reference/desktop-app/engine/agent/`); the Nemotron tool loop there is the model
  for the server loop.
- **Fallback.** If the budget is spent or the server is unreachable, a scripted run
  of the same bug fix plays through the same tools, and the panel says it is a recording.
- Model identifiers and SDK calls are taken from each provider's current
  documentation when M3 is planned, not from memory.

### 4.6 Voice

- Primary: pinch-and-hold records with `MediaRecorder`; the clip goes to
  `/api/transcribe`; the text appears in the transcript for a beat before it is sent,
  with a pinchable **Cancel**.
- The browser's own speech recognition is used only if the two-hour headset session
  shows it works in the Quest browser; it is untested today.
- Four or five suggested prompts are always pinchable, so a failed microphone never
  blocks the experience. This also serves accessibility.
- The agent's replies are text. Speech output is optional polish.

### 4.7 Debugger replay

A recorded run of the buggy and fixed code is stored as debug records (the format in
`galaxy/source-model/debug-records.js`). A replay panel steps through it; the existing
execution ship, step car and frame cards show where execution is. No runtime, no
debug adapter.

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
| Settings | Text size, seated height, provider | M4 |
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

| | Dates | Outcome | Plan |
| --- | --- | --- | --- |
| M0 Migration | Nov 10–11 | Repo builds; copied code runs in a browser from baked data; assets built; deployed preview | `docs/superpowers/plans/2026-11-10-m0-migration.md` |
| M1 Galaxy in XR | Nov 11–13 | XR scene kit and host; galaxy on the table; ray, pinch, grab; globe stand; labels | written after M0 |
| M2 Reading code | Nov 13–14 | Code panel, town-to-code linking, palm menu, sample picker, tutorial | |
| M3 Agent and voice | Nov 14–16 | Server functions, browser tools, transcript, diff, push-to-talk, fallback | |
| M4 Replay and polish | Nov 16–17 | Debugger replay, Quest asset tier, frame-rate pass, sound | |
| M5 Headset and submit | Nov 17–18 | Two-hour Quest session, fixes, video, Devpost entry | |

M1 through M5 each get their own plan, written when the milestone before it lands,
because each depends on what the previous one showed.

**Cut order if a milestone slips:** Problems markers, settings, speech output,
provider choice (ship one), the replay, live agent (ship the scripted run). Never cut:
the tutorial, the code panel, hands-only operation.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Frame rate unknown until the headset session | Quest asset tier and draw-call caps in M4; emulator frame times tracked from M1; headset session on Nov 17 leaves a day to cut detail |
| Microphone or speech behaviour in the Quest browser unknown | Server transcription as primary; suggested prompts make voice optional |
| IWSDK is a release candidate | Scene-kit boundary allows falling back to plain `renderer.xr` |
| Porting camera-writing modules takes longer than planned | M1 ports the constellation first, the planet second; the globe stand can ship with a simpler town view |
| Agent backend abused or over budget during judging | Rate limit, daily cap, scripted fallback |
| Asset download too large for a fast start | Lazy loading per planet already exists; initial-load budget of 40 MB set in M4 |
| Sample repository's licence or name conflicts with the rules | Choose a permissively licensed project; show it under a neutral project title if needed |

## 9. Open items for the owner

1. **Product name** (without "Meta").
2. **Sample repository and the bug** to fix in it. JavaScript or TypeScript analyses best.
3. **Provider keys and a daily spend cap**; which provider is the default.
4. **Vercel account** to deploy to.
5. **Start programme membership** confirmed, since it gates submission.
