# Desktop parity: what to port from codebase-viz, and what to write

Status: revised after a second review on 2026-11-10; items built on 2026-11-11 are listed under "Built".

## Built (2026-11-11)

- **Voice file search**: a Search tab (`src/systems/search-system.ts`, `src/core/file-search.ts`). Hold to speak,
  say part of a file name; spoken words are turned into written forms ("cursor common" → `cursorcommon`, "range dot
  ts" → `range.ts`) and run through the copied `search()`. Pinching a result selects the file.
- **Road traffic**: the town kit's light cars (about 2,000–2,800 triangles each) through a `RoadCars.detailed` switch
  patched into `road-vehicles.js`; hidden only with Reduce motion on. About 60,000 triangles for 27 cars landed.
- **Ships on the code card**: `Ships n` in the footer when the function has routes; Preview and Travel per route,
  the flight's status, Cancel. Travel lands on the destination. This fixed `landedPath` not following a move from one
  planet to another.
- **Flow on the code card**: `Flow` lists the function's statements (kind, line, source) in place of the code; a
  pinch selects the statement's building.
- **Activity**: an Activity tab (`src/systems/activity-system.ts`, `src/core/activity.ts`) built from the events the
  cannon receives: a heading per turn, a row per tool call with its file and state; pinching a row selects its file.
- **Live check prep**: `?record=1` records a live run in the recorded-session format; `__orrery.usage` and a console
  line per request show cache reads. The live call itself waits for the owner.

Not changed: the draw budget (set aside by the owner), hosting (the owner's to arrange).

## First: what outranks this plan

The deadline is 2026-11-18 12:00 PT. Three open items from `docs/migration/m3-m4-report.md` come before any new
feature:

1. **The live check (M4 Task 19).** Everything so far runs on the recorded session. A real provider has never been
   called through the relay. It needs the owner's Claude key in the environment of `npm run dev:api` (never in chat).
2. **A real headset.** The walk-through was emulator-only. Get on a Quest before the Nov 17 session if possible.
   (Hosting is the owner's to arrange; it is not part of this plan.)
3. **The landed draw budget.** About 2.04 million triangles and 348–389 draw calls against 750,000 and 300.

Features freeze on **Nov 15**, leaving time for M5 (the headset session, video and submission).

## The rule of thumb

Logic ports, desktop UI does not. The scene code is already copied into `galaxy/` and runs unchanged. Pure logic files
can be copied the same way (`tools/migrate/copy-code.sh`, edits only through `apply-patches.mjs`). The React panels
(`viewer/app/panels/*.tsx`) cannot run in a headset; each becomes a canvas window (`src/panels/`). Their data and
behaviour are reused; only the drawing is new.

## Items, with what the review found

| Item | Reuse, as checked | Verdict |
| --- | --- | --- |
| Voice file search | `search()` (`galaxy/viewer/app/graph.ts:240`) is pure but not re-exported from `galaxy-session.js`. It matches substrings, so a spoken "cursor common" misses `cursorCommon.ts`: transcripts need normalising. Speech is dictation only, so "Find …" needs its own routing. | **Do** (small, shows well in a video) |
| Transport row on the code card | Travel and cancel are `play`/`ride`/`cancel` on the transport object (`galaxy/viewer/traffic/transport.js:304`), not callbacks the inspector receives; `inspector.ts` only keeps the arguments. The route to them still needs tracing. | **Do if time remains** |
| Code card tabs (Flow, Calls, Find town, Dependencies) | `town-flow.js` and `building-profile.js` are copied; the tab UI is new. | **One tab at most**, if time remains |
| Activity history | `codebase-viz/viewer/app/activity.ts` has no imports and no DOM: it ports as is. | **Optional** |
| Traffic | See below. | **Only once the landed budget has room** |
| New files become planets | Not just "append a node". The desktop route is to add a row to the dataset's `f`, then `prepare(data, { after: state.nodes })`, `regroup()`, `view.update()` (`codebase-viz/viewer/app/main.ts:273-276`). `openGalaxy` discards `loaded.data`, `prepare` re-sorts indices and re-runs grouping, and a new file has no baked symbols. The demo never creates a file. | **Defer** |
| Atlas and `semantic_search` | Only `engine/atlas/search.cjs` is pure. `collect.cjs` and `client.cjs` need Node and the Nemotron loop; `viewer/app/atlas.ts` needs React and the desktop bridge. Without a key at bake time, search is names and files only. | **Defer** |
| `problems` tool | The desktop reads language servers (`engine/lsp/problems.cjs`). In the browser, the compiler is lazy-loaded (9.1 MB), there are no `lib.*.d.ts` files and the sample imports files outside the dataset, so only syntax errors would be reliable. | **Defer** (syntax-only at most) |
| `delegate` (subagents and drones) | Drones need `agentId` and `rootSessionId`, which the bridge never sends. Sub-runs add spend on a relay never run live. | **Defer** |

## Traffic

Road cars are instanced, but each model is 14,000–22,000 triangles. A trial with the island's simplify settings
kept the names and wheel radii the car code needs (`SM_Wheel_*`, `*_Body`, `extras.radius`), but the counts came out
higher than first hoped:

| Simplify error | Body triangles | Wheel triangles |
| --- | --- | --- |
| 0.02 | 782–1,676 | about 552–582 |
| 0.1 | 254–1,176 | 328–350 |

With four wheels a car, 96 cars come to about 135,000–220,000 triangles in about 10 draw calls (the police and
ambulance designs add batches), all in the landed state that is already over budget. So:

1. Fix the landed budget first.
2. Then try the plain kit cars, which `road-vehicles.js:80-83` already falls back to and which have no wheel batch,
   or simplified bodies, and measure the landed triangles before enabling them.
3. Simplify settings need per-folder values (`SIMPLIFY_RATIO` and `SIMPLIFY_ERROR` are global today). Keep cars out
   of quantization: `road-vehicles.js` bakes body geometry and uses wheel geometry raw. A broken model silently falls
   back to kit cars, so check the fleet's `errors` (`road-vehicles.js:170`).
4. With Reduce motion on, no cars and no idle ships.

## Order

1. Live check (Task 19), last, when the owner says so.
2. Landed draw budget.
3. Voice file search.
4. Traffic, once 2 leaves room.
5. Transport row, then one code-card tab, if time remains.
6. Activity window, optional.

Deferred until after the competition: new-file planets, the atlas and `semantic_search`, `delegate`, `problems`, and
the full set of code-card tabs.

## Not ported

- Opening your own folder, live analysis and the 14-language analyzers: a headset cannot reach local files without a
  second device or a server.
- Live debuggers: no runtime in a headset; the scripted replay stands in.
- Running commands: no shell in a browser. `run_replay` covers "run the tests" for the scenario.
