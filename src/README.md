# src/ — the XR app

The structure is ports and adapters around an IWSDK entity-component-system shell.
The reasons, sources and the full dependency table are in `docs/design.md`, section 4.
`npm run check` enforces the import rules below (`tools/check-boundaries.mjs`) for `core/`, `ports/`, `state/`,
`components/`, `panels/`, `adapters/`, the copied code and three.js; `systems/` and `galaxy-bridge/` follow them by review.
Some folders describe what the next plans add: `ui/` and the recorded fakes do not exist yet.

| Folder | Holds | May import |
| --- | --- | --- |
| `core/` | Pure logic: today the pose math, labels, layout, code view, scrolling, theme tokens and the tutorial; in the next plan the workspace, edits and diffs, the bug-fix session, agent tool schemas, the transcript reducer and replay stepping. No three.js, no IWSDK, no DOM. | `core/` only, and no packages |
| `ports/` | TypeScript interfaces for everything outside the app: agent, speech, dataset, storage, and the two contracts the copied scene code expects (host, scene kit). | `core/`, `ports/` |
| `adapters/` | One implementation per port: HTTP agent client, transcription client, static dataset loader, local storage, and recorded fakes. | `core/`, `ports/`, `adapters/` |
| `state/` | What the UI shows, as small immutable signals, and the typed commands that change it. | `core/`, `ports/`, `state/`, `@iwsdk/core` |
| `galaxy-bridge/` | The only XR code that imports `galaxy/`: the XR host and the XR scene kit. | anything in `src/` except `adapters/`, plus `galaxy/` |
| `components/` | ECS components, one per file, with no system code. Registered in `components.ts`. | `@iwsdk/core` |
| `systems/` | IWSDK systems, kept thin: read input, call `core`, publish to `state`, move objects. | everything except `adapters/` and `galaxy/` |
| `panels/` | Canvas panels (docs/design.md §4.8): a textured rectangle that takes pinches, and one drawing function per panel. `panels.html` draws each on a plain page for screenshots. | `core/`, `ports/`, `state/`, `components/`, `@iwsdk/core` |
| `ui/` | One controller per spatial panel. Markup lives in `public/ui/*.uikitml`. Reads `state` signals, sends commands. | `core/`, `ports/`, `state/`, `@iwsdk/core` |
| `flat/` | The flat reference view: a test page, not the product. | `galaxy/`, `three` |
| `index.ts` | The composition root: creates the world, builds adapters, hands them to systems, registers systems. The only file that names concrete adapters. | everything |

`components.ts` and `assets.ts` stay at the top: `iwsdk.config.json` points at them.

## Rules of thumb

- **Data flows one way.** Systems and adapters publish to `state` signals; panels
  render them; a pinch sends a typed command; a system handles the command. A panel
  never mutates an entity or the workspace directly.
- **One source of truth per value.** If it lives in an ECS component, the signal is a
  projection of it, not a second copy that can drift.
- **Thin systems.** A system with an `if` that is hard to test wants that decision
  moved into `core/`.
- **In systems:** iterate queries rather than keeping entity arrays; allocate nothing
  in `update()`; put every subscription's unsubscribe in `cleanupFuncs`.
- **Build against the fake first.** Every port gets a recorded fake in `adapters/` (the agent and speech ports, next plan).
  A feature is developed and tested on the fake; the live adapter is checked last.
  Provider keys live only on the server (`api/`), never in `src/`.
- **three.js** comes from `@iwsdk/core` everywhere except `flat/` and the copied code.
- **The copied galaxy is one subtree.** It is attached once with
  `world.createTransformEntity(root)`. Inside it the copied code loads its own models
  and adds its own objects, which IWSDK's usual rules would flag; that exception stops
  at the bridge. Selection and grabbing still enter through IWSDK's interaction
  components on the root, never a second raycaster.
