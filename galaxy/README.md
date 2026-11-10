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

- **Do not hand-edit copied files.** If a copied file must change, add the change to
  `tools/migrate/apply-patches.mjs` as an exact find-and-replace, so that re-running the
  copy reproduces it.
- Two files in `viewer/app` are **not** copies. They replace desktop-only modules and
  are safe to edit:
  - `static-data.js` — loads baked dataset files instead of the desktop project API.
  - `project-store.ts` — keeps layout memory and preferences in `localStorage`.
- New code belongs in `src/`, never here.
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

## Updating from codebase-viz

```sh
tools/migrate/copy-code.sh /absolute/path/to/codebase-viz
npm run check && npm run build && npm run smoke
```

The copy overwrites every copied file and re-applies the patches. If a patch no longer
finds its text, the script stops and names the file.
