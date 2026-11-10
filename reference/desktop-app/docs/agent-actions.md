# Agent actions and how they are animated

Electron's Codex adapter and the observed-session adapters publish provider-neutral v1 events. `engine/agent/runtime.cjs` validates
session and operation lifecycles. `engine/workspace/observer.cjs` independently confirms changes on disk.
`viewer/agents/agent-events.js` maps semantic operations to presentation; the cannon never chooses behavior
by a vendor's tool name. See [agent-integration.md](agent-integration.md) for the contract and boundaries.

## Presentation mapping

The following are internal visual events, derived from canonical records. A tool name is only descriptive
metadata. Operation identifiers include provider, session and turn, so concurrent agents cannot resolve
each other's rounds. Session selection controls which activity drives the cannon.

| Semantic activity | Animation |
|---|---|
| Turn starts | Beam into the cannon; core charges |
| Reasoning / assistant message | Charging glow / comm ring |
| Read | Fast tracer; small impact and light heat |
| Search | Flak bursts; fragments fly to matching files |
| Edit/create intent in an observed workspace | Aim the turret; wait for real disk evidence |
| Correlated source-file change | Heavy shell with line counts when measurable |
| Correlated source-file creation | Siege seed; fragments condense into the analyzed body |
| Correlated directory/other creation | Portal, shield, gear, crystal, tiles or pages |
| Unattributed or ambiguous disk change | Workspace change label and local formation/heat; no attributed cannon shot |
| Command | Mortar at declared target files, otherwise the terminal moon |
| Delegate | Drone, with child operations firing in its color |
| Web / other tool | Long-range beam / satellite round |
| Task / load / question | Checklist / loading ring / waiting beacon |
| Failed operation | Misfire; denied operation flashes a shield |
| Interrupted turn | Cannon jams and drops pending rounds |
| Usage | Context gauge; capacity shown only when explicitly supplied |
| Compact / retry | Venting burst / stalled label |
| Completed turn | Cooldown, then camera returns to overview if automatic follow is enabled |

Outcomes resolve rounds by operation ID. Native edit/write operations aim before disk evidence; failed
calls can misfire, but success alone cannot invent a creation. Files outside the map have off-map markers.
Projectiles and beams leave slowly fading trails for about five seconds after flight; trails are presentation, not additional events.
Hit files warm quickly, glow orange and cool over several minutes. The glow survives rebuilds without gaining extra heat.

Click the cannon to smoothly zoom in around its full model. Framing fits both width and height. Hovering
previews its status; dragging orbits and scrolling zooms back out. Manual navigation and cannon clicks
pause automatic following for eight seconds. **Follow agent** affects the camera, independently of
activity observation. Changing the selected session cancels that session's visual queue and leaves
confirmed file heat and completed creations in the workspace.

## Rebuilds

Source changes request debounced, serialized analysis through the shared workspace
service. JS/TS graph and symbol output use one project snapshot; Java is merged through
its separate parser. Actual source changes trigger rebuilds, independently of whether
an agent is running. The viewer then:

- reloads the dataset without moving the camera
- keeps the selection (and the landing, if a planet was open)
- carries heat, recoil and typed formation effects over by path

Creation sequences carry their current flight and formation time across the refresh. A temporary file marker gives way to its actual analyzed body, which grows into place. Directories and files outside the source map have finite visual markers; they do not invent source nodes. Completed effects do not replay.

## Creation effects

`engine/workspace/observer.cjs` takes one asynchronous baseline and confirms changed paths from watcher
notifications. Parent directories are reported once even when a child arrives first. Empty directories
and non-source files are included; dependencies, build output and symlinks are excluded. Repeated writes
are coalesced, unchanged saves are suppressed, and the observer does not scan the tree after every turn.
Attribution is exact-path correlation with an explicit operation, not a guess based on whether an agent
is busy. Manual and ambiguous changes stay visible as workspace events.

`viewer/agents/creation-effects.js` supplies a seed flight, eased formation, fragments and a short spark burst. Each entity has a distinct silhouette and motion:

| Entity | Formation |
|---|---|
| Directory | Gold portal with three rotating rings |
| Code | Blue fragments assemble the real analyzed body |
| Test | Green shield grows behind orbiting fragments |
| Configuration | Amber gear with rotating teeth |
| Data | Teal crystal condenses from crystal fragments |
| Asset | Purple fragments assemble a tile grid |
| Document | Cream pages unfold and stack |

Under **View options**, choose a type beside **Preview creation** and click the button to run a labeled local preview. Previews write no files, send no provider requests, and never enter session history. Their visuals are disposed when switching maps.

## Verification

`node checks/agent-pipeline.cjs` and `node checks/agent-runtime.cjs` cover the event contract, attribution and delivery offline. The cannon's rendering has no automated check; verify it in the Electron window with a Codex chat or Preview creation.

## Galaxy tools for every agent

Nemotron, Codex and Claude get the same galaxy tools from `engine/agent/galaxy-tools.cjs`:
`show_user`, `problems`, the `debug_*` tools and, once the atlas is built, `semantic_search`.
Nemotron has them beside its own file tools. Codex receives them as dynamic tools
declared at `thread/start` and answers `item/tool/call`; Claude receives them from an
SDK-hosted MCP server (`initialize.sdkMcpServers`, relayed as `mcp_message`), named
`mcp__galaxy__<tool>`. Paths inside the project may be absolute. Pointing, diagnostics
and reading a pause run without approval; tools that run code ask through the normal
approval card unless the chat has full access. Codex threads started before this
change have no galaxy tools.

All three get the same guidance (Codex as developer instructions, Claude as an appended
system prompt): when the user asks where or why something happens, explain and point at
it, and do not edit files until they ask for a change.

## Show a place to the user

`show_user({ file, line?, message })` points at one project-relative, existing file.
The optional line must be within the file; the explanation is 1–280 characters.
This tool is available in read-only chats. Use it sparingly for the one location
that explains a finding or change, at most a few times per turn.

With **Camera follows agent shots** enabled, the galaxy opens and flies to the
file's town or building, using the existing agent highlight. Otherwise a non-modal
notice offers **Show me** and **Dismiss**, without moving the camera. The compact
Nemotron callout includes the location and explanation and remains until dismissed
or replaced. Files outside the analyzed galaxy open in the editor at the requested
line, and the callout says so. While a project loads, only the latest request is
kept. Requests for an inactive workspace project are rejected in main.

Offline verification: `node checks/agent-show.cjs` (also in the offline suite).
After building, run `node checks/agent-show-desktop.mjs` for the actual Electron
follow/offer/editor check. It launches via `npm run desktop`, uses a small temporary
project, and prints the directory containing screenshots for all four steps.

## Follow the agent's debugging

When an agent runs `debug_probe` or `debug_start`, its run flies the execution ship
like a user's run. A probe never pauses, but its ship still visits each probe and
exception stop and stays where the run ended. With **Camera follows agent shots**
enabled, the ship is followed; otherwise a notice offers **Follow ship** and
**Dismiss**, without moving the camera. Following lands on the building where the
ship is, or on the agent's pause.

The agent can also read the user's own paused session: `debug_inspect` returns its
stack, exception, source line and variables, and `debug_evaluate` evaluates in it,
without taking control. Stepping, launching and hand-off still refuse while the user
drives.

After building, `GALAXY_DEBUG_ADAPTERS=<installed adapters> node checks/agent-ship-desktop.mjs`
runs both against a scripted loopback model in the actual Electron app
(`GALAXY_NEMOTRON_TEST_ENDPOINT`; a fixture key replaces the real one) and prints the
directory containing screenshots.
