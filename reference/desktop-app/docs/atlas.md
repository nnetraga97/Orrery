# Atlas

In **View options**, choose **Build atlas** to summarize the selected project's function towns.
The initial build sends source snippets to Nebius Token Factory; later analysis revisions automatically
summarize only changed or new functions. **Cancel** stops the current build. **Rebuild** retries failed
functions and reuses unchanged summaries. An atlas is not built automatically until the user has built it once.

The key uses the Nemotron chat configuration (`NEBIUS_API_KEY` or `~/.config/nebius/api_key`).
`GALAXY_ATLAS_MODEL` overrides `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`. Calls run in Electron's
main process. The cache is `userData/atlas/<projectId>.json`; it contains summaries and hashes,
not source snippets or credentials. Roles and risks are model judgments based on the provided code.

Select **Ask** inside the toolbar search, or finish a question with `?`, then press Enter.
Results show the method, source location, summary and matching reason. Local BM25 retrieves up to
40 candidates; Nano selects up to eight. Failed or timed-out reranking falls back to eight local matches.
There are no embeddings. Summaries also appear in method inspectors and their existing hover previews.

Navigation follows `FileSearch.pickAnswer` → `navigateAtlas` → `actions.enterPlanet(index, {line, townId})`
→ the constellation's `T.land`. A new landing passes the town ID through `openDetail`,
`createPlanetDetail` and `buildPlanetDetail` to `createPlanetInteraction`'s `focus`. An already landed planet
uses `detail.focusLine(line, townId)` to reach the same focus function. Focus resolves the town's stable
region ID, pins that region, and uses `viewOf` → `townLandingView` for its camera target. The source line
is the fallback if the ID no longer exists. No panel imports a renderer module.

Nemotron chats offer `semantic_search(query)` when an atlas exists. It is recommended first for
where-is questions. The resolved result files accompany a v1 search operation, using the existing
agent activity animation. Other chat providers are unchanged.

Run `node checks/atlas.cjs` for the local HTTP fixture. In sandboxes that prohibit loopback listening,
`node checks/atlas.cjs --in-process` runs the same assertions without verifying the HTTP transport.
Neither fixture verifies a live model response or Electron camera behavior.

## Changed files

| Files | Purpose |
| --- | --- |
| `engine/atlas/collect.cjs` | Read analyzed towns and their source, preserve region IDs, hash full functions. |
| `engine/atlas/client.cjs` | Nano structured-output schemas, role prompt, response validation, credential redaction. |
| `engine/atlas/search.cjs` | Camel/snake-case tokenization and BM25 scoring. |
| `engine/atlas/service.cjs` | Four-worker builds, retry/cancel, cache, revision refresh, reranking and timeout fallback. |
| `desktop/main.cjs`, `desktop/preload.cjs` | Atlas service lifetime, trusted IPC methods and progress events. |
| `engine/workspace/project-service.mjs` | Dataset-ready/revision callbacks to invalidate existing atlases. |
| `desktop/nemotron-chat.cjs` | Resolve atlas availability and pass search into each Nemotron turn. |
| `engine/agent/providers/nemotron-loop.cjs` | Share endpoint validation, advertise semantic search and emit search activity. |
| `engine/agent/providers/nemotron-tools.cjs`, `engine/agent/providers/nemotron-items.cjs` | Semantic search definition, result formatting and transcript item. |
| `viewer/app/atlas.ts` | Renderer-side atlas state, IPC client and navigation action. |
| `viewer/app/panels/FileSearch.tsx` | Ask toggle, question detection, query/results and build-first prompt. |
| `viewer/app/panels/AtlasControls.tsx`, `viewer/app/panels/mount.tsx`, `viewer/index.html`, `viewer/styles/projects.css` | View options controls, counts and compact search layout. |
| `viewer/app/panels/planet-inspector/MethodSection.tsx` | Summary, role and risk in the inspector; summary in existing hover preview. |
| `viewer/app/main.ts`, `viewer/app/state.ts` | Pass the optional town ID through the existing application navigation action. |
| `viewer/galaxy/constellation-detail.js`, `viewer/planet/planet.js`, `viewer/planet/planet-detail.js`, `viewer/planet/planet-interaction.js` | Carry the town ID through landing, select its region and fly to its camera target. |
| `checks/atlas.cjs`, `scripts/run-checks.mjs` | Registered offline fixture with HTTP and explicit in-process modes. |
| `docs/atlas.md` | Usage, implementation map and exact navigation flow. |
