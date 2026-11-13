# galaxy/ — code migrated from codebase-viz

Everything here was copied from the desktop app's repository (`codebase-viz`) by
`tools/migrate/copy-code.sh`. `SOURCE_COMMIT` records the commit it came from. The
folders keep their original relative layout so the copied modules' imports resolve
unchanged.

| Folder | What it is | Runs in |
| --- | --- | --- |
| `viewer/scene`, `galaxy`, `planet`, `towns`, `traffic`, `agents`, `debug`, `shared` | The three.js scene code: constellation, planets, towns, agent cannon, debug markers | Browser |
| `viewer/country` | Two helpers the town roads import | Browser |
| `viewer/app` | Shared state, graph preparation and layout memory | Browser |
| `source-model` | Source models and layout identity, shared by the analyzer and the browser | Both |
| `engine/analyzer`, `engine/shared` | The analyzer that writes datasets | Node |
| `checks` | Offline checks for the code above (`npm run check`) | Node |

## Rules

- **This is a fork (since 2026-11-12, the owner's decision).** Edit these files directly.
  The patches in `tools/migrate/apply-patches.mjs` record the changes made before the fork;
  later changes are not patches, so **do not re-run `copy-code.sh`**: it would overwrite them.
- Two files in `viewer/app` are **not** copies. They replace desktop-only modules and
  are safe to edit:
  - `static-data.js` — loads baked dataset files instead of the desktop project API.
  - `project-store.ts` — keeps layout memory and preferences in `localStorage`.
- New XR-only code still belongs in `src/`; scene behaviour may change here.
- Scene code imports three.js as `three`. In this repository `three` is aliased to the
  build IWSDK uses (`super-three`), so there is one copy of three.js in the bundle.

## What the patches change

`apply-patches.mjs` makes these edits, and nothing else:

1. `viewer/app/graph.ts` and `viewer/planet/planet.js` fetch the graph, symbols and
   source text from `public/data/<dataset>/` instead of `/api/projects/...`.
2. Two ship rigs keyed by car brand names are renamed (`arc`, `arrow`).
   `tools/assets/build-assets.mjs` publishes the matching model files under the same
   names.
3. `viewer/galaxy/constellation.js` uses `host.sceneKit(camPos, options)` when the host
   provides one, and `scene3D` otherwise. The XR app's host supplies the XR scene kit
   (`src/galaxy-bridge/scene-kit.js`); the flat view does not, so it is unchanged.
4. `viewer/towns/town-placement.js` draws kit trees at 0.2 of a lot wide (below most
   buildings) and the town port at most 1.5 lots wide (`docs/reviews/asset-review`).
5. Folder systems: systems are grouped by top-level folder (`viewer/app/state.ts`).
6. One function per globe: a landed planet holds one town, chosen by town id or line, else the
   largest, drawn at a larger building scale (`viewer/planet/planet-scene.js`, `towns/`). A line or
   town elsewhere in the file rebuilds the globe for it (`viewer/galaxy/constellation-detail.js`);
   `T.landedTowns()` lists the file's towns for stepping. `OneTown.enabled = false` restores the
   whole file.

The patch list in `apply-patches.mjs` is the full record; each entry says why.

## Stars and function-planets (after the fork)

With a function index (`public/data/<name>/functions.json`, written by `tools/bake-functions.mjs` from
`src/core/importance.ts`), the galaxy reads: black hole (a group of files) -> stars (files with important
functions) -> planets (those functions) -> the landed surface (one function's statements).

| Piece | File |
| --- | --- |
| Loads the index; marks each file node `star` | `viewer/app/function-index.js`, `viewer/app/graph.ts` |
| Files with planets lay out as stars, the rest as rocks | `kindOf` in `viewer/galaxy/constellation-orbits.js` |
| Star drawing (two instanced batches) | `viewer/galaxy/star-bodies.js`, used by `constellation-bodies.js` |
| The selected star's planets, orbit lines, belt of hidden functions, labels, call lanes, and the picker card whose Land action lands on one function | `viewer/galaxy/function-planets.js`, `function-facts.js` |
| A landed globe holds one town (one function) | `OneTown`, `pickTown` in `viewer/planet/planet-scene.js` |

A dataset without `functions.json` draws as it did before the fork (files as planets).

### What each drawn property measures

Nothing a viewer can compare is decoration: each property below is tied to a measure from the baked symbols
(`src/core/importance.ts` writes them into `functions.json`). The Settings tab shows the same key (`src/core/key.ts`).

| Seen | Measure | Where |
| --- | --- | --- |
| A star's size | The file's lines (square root; half as fast past about 1,000 lines, no cap) | `starRadius` in `constellation-orbits.js` |
| A star's glow | Files that import its values (type-only imports left out), against the most-imported file; from far away the glow keeps a minimum angle | `shine` in `star-bodies.js`, `import-counts.js` |
| A planet's size | The function's lines | `planetSize` in `planet-orbits.js` |
| A planet's world | Its grade: nesting depth, raised by a very high branch count (ocean world, pale, cratered, red) | `gradeWorld` in `planet-profiles.js`; the landed globe wears the same one |
| Warm and cool lines | Warm leaves the selection (imports, calls); cool arrives at it. The same at all three levels | `constellation-fleet.js`, `function-planets.js`, `traffic/call-routes.js` |
| Tinted ground on a globe | Code nested three deep or more (amber, then orange) | `NEST_TINT` in `towns/town-ground.js` |
| The file's marker and a planet's card | The same measures in words | `fileFacts` in `src/galaxy-bridge/galaxy-session.js`, `function-facts.js` |

The measures are baked: after the agent edits a file, its landed town is rebuilt from the new text, but a planet's
grade, size and card stay as baked until the dataset is baked again.

### One function fills its globe

A globe with one town (`OneTown`) places the town on the sunlit equator (`ONE_TOWN_CENTRE`), gives it land out to about
46 degrees from its middle (`ONE_TOWN_REACH`, `planet-terrain.js`) and takes the largest lot size at which the town
fits that land (`incremental-towns.js`), so the whole function is in sight at once and little of the facing side is
bare. In the room the town is shown square on (`faceLanding`, `planet/town-landing.js`), and a function of a few
statements, which cannot fill a full globe at a sensible building size, is shown on a smaller globe
(`src/core/globe-size.ts`). `fit()` on the landed planet reports the town's reach for checks.

## Updating from codebase-viz (no longer done)

```sh
tools/migrate/copy-code.sh /absolute/path/to/codebase-viz
npm run check && npm run build && npm run smoke
```

The copy overwrites every copied file and re-applies the patches. If a patch no longer
finds its text, the script stops and names the file.
