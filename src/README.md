# src/ — the XR app

The structure is ports and adapters around an IWSDK entity-component-system shell.
The reasons, sources and the full dependency table are in `docs/design.md`, section 4.
`npm run check` enforces the import rules below (`tools/check-boundaries.mjs`).

| Folder | Holds | May import |
| --- | --- | --- |
| `core/` | Pure logic: the in-memory workspace, edits and diffs, the bug-fix session, agent tool schemas and the transcript reducer, replay stepping. No three.js, no IWSDK, no DOM. | `core/` only, and no packages |
| `ports/` | TypeScript interfaces for everything outside the app: agent, speech, dataset, storage, and the two contracts the copied scene code expects (host, scene kit). | `core/`, `ports/` |
| `adapters/` | One implementation per port: HTTP agent client, transcription client, static dataset loader, local storage, and recorded fakes. | `core/`, `ports/`, `adapters/` |
| `state/` | What the UI shows, as small immutable signals, and the typed commands that change it. | `core/`, `ports/`, `state/`, `@iwsdk/core` |
| `galaxy-bridge/` | The only XR code that imports `galaxy/`: the XR host and the XR scene kit. | anything in `src/` except `adapters/`, plus `galaxy/` |
| `components/` | ECS components, one per file, with no system code. Registered in `components.ts`. | `@iwsdk/core` |
| `systems/` | IWSDK systems, kept thin: read input, call `core`, publish to `state`, move objects. | everything except `adapters/` and `galaxy/` |
| `ui/` | One controller per spatial panel. Markup lives in `public/ui/*.uikitml`. Reads `state` signals, sends commands. | `core/`, `ports/`, `state/`, `@iwsdk/core` |
| `flat/` | The flat reference view: a test page, not the product. | `galaxy/`, `three` |
| `index.ts` | The composition root: creates the world, builds adapters, hands them to systems, registers systems. The only file that names concrete adapters. | everything |

The project generator's starter files (`robot.ts`, `robot-component.ts`, `panel.ts`,
`scene-assets/`) sit at the top of `src/` until the first XR milestone replaces them.
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
- **Build against the fake first.** Every port has a recorded fake in `adapters/`.
  A feature is developed and tested on the fake; the live adapter is checked last.
  Provider keys live only on the server (`api/`), never in `src/`.
- **three.js** comes from `@iwsdk/core` everywhere except `flat/` and the copied code.
- **The copied galaxy is one subtree.** It is attached once with
  `world.createTransformEntity(root)`. Inside it the copied code loads its own models
  and adds its own objects, which IWSDK's usual rules would flag; that exception stops
  at the bridge. Selection and grabbing still enter through IWSDK's interaction
  components on the root, never a second raycaster.
