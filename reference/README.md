# reference/ — read-only desktop code

`reference/desktop-app/` holds parts of the desktop app (`codebase-viz`) that the VR
app does **not** run but later milestones need to read:

| Path | Read it when you build |
| --- | --- |
| `viewer/app/panels/`, `viewer/styles/`, `viewer/index.html` | Spatial panels: every desktop control and what it shows |
| `viewer/app/host.ts` | The host contract the scene code expects |
| `viewer/app/main.ts` | How the shell loads a dataset, selects files and lands on planets |
| `engine/agent/` | The agent event contract, tool definitions and the Nemotron tool loop |
| `desktop/*-chat.cjs` | How each provider's chat was driven on the desktop |
| `engine/debug/`, `viewer/app/debug.ts` | Debug records for the scripted replay |
| `docs/` | Design notes for the galaxy, planets, agents and debugging |

Nothing in `src/`, `galaxy/` or `tools/` may import from this folder, and it is not
part of the build. `tools/migrate/copy-code.sh` refreshes it.
