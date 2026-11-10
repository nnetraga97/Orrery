# Workspace ownership and desktop foundation

Galaxy runs locally. Desktop opens real folders and runs app-owned Codex chats
against the selected project. Headset access is a future direction, not an implemented host.

## Current ownership

`engine/workspace/service.cjs` owns a selected workspace's filesystem observer, provider-neutral
runtime, session connections, analysis scheduler, and durable activity journal. Hosts
subscribe to events and translate user actions. `engine/workspace/analysis.cjs` is the shared
JS/TS and Java pipeline; parsing runs in cancellable child processes. Empty projects
start without running an analyzer. A real source change schedules a short debounced analysis,
including manual changes with no running agent. Saving a file that steers resolution
(`tsconfig`/`jsconfig` files and the configs they extend, `package.json`, `pnpm-workspace.yaml`,
`go.mod`) re-analyzes too. Reopening refreshes the map even when all sources were deleted
while the app was closed.

## Incremental analysis

Each open workspace has a resident analyzer process (`engine/analyzer/worker.mjs`, started by
`createAnalyzer` in `engine/workspace/analysis.cjs`). The observer reports the paths that
changed; the worker updates its JS/TS project model (`engine/analyzer/project-model.mjs`) and
re-analyzes only the files whose output can differ, reusing the previous TypeScript program's
unchanged source files. A file's output depends on its own text; on how its imports resolve
(every lookup location TypeScript tried, so a new file that wins an import is noticed); on the
files whose declarations its analysis resolved; and on which call targets are modeled callables.
A dependency counts only when the other file's surface changed: its declarations and their lines
reach the files that resolved into it, and a changed shape (names, kinds, the text type inference
reads) reaches every file that imports it, directly or indirectly. Configuration, manifests,
declaration files, global scripts and `declare global` blocks fall back to a full analysis. Java
and the tree-sitter languages re-run only when one of their files or a non-source input changed.
The worker rewrites only the symbol shards whose detail hash changed, then the graph. A crash
or timeout replaces the worker, and its replacement analyzes everything.
`checks/incremental-analysis.mjs` replays edits and requires the incremental result to equal a
full analysis after each one.

## Dataset revisions

Every analysis that changes the graph is a numbered revision. `engine/workspace/revisions.cjs`
hard-links each revision's graph file and symbol shards under `data/revisions/`, keeping the last
three, so a reader that asks for a revision by number gets the same bytes even after newer analyses.
An analysis that reproduces the same graph is not a revision and sends nothing. The stream's
`snapshot` and `rebuild` messages carry `revision` and `generation` (a fresh id each time the
service starts). `GET …/data/graph?rev=N` serves that revision's graph, and
`GET …/data/symbols?rev=N&path=a&path=b` named files' symbols from it; both answer 410 once it
is dropped.

The graph carries the overview a galaxy draws: each row is
`[path, lines, inDegree, contentHash, detailHash, regions]` and each import
`[from, to, runtimeRefs, typeRefs, reexports]` (bare `[from, to]` when the importer has no
reference index). The path is the file's identity across revisions. The content hash covers the
text the analyzer read and the detail hash that file's symbols, so `viewer/app/snapshot-diff.ts`
can tell an import change from a resized file from a same-size semantic edit. Symbols are stored
one shard per file (`<name>.symbols/`): a planet close-up loads its own file's and its importers',
and a new revision drops only the cached detail of files that changed. The viewer reloads one
revision at a time, ignores revisions it already has, keeps its scene when a new revision changes
nothing it shows, and otherwise updates the constellation in place.

## Scope and history

All analyzers and the observer use `engine/shared/scope.cjs`: dependency/build/cache defaults,
selected-root `.gitignore`, nested ignore files, and `.galaxyignore` overrides. Excluded
parent directories must be included before any child can be included. Tests, declarations
and tooling remain available. A reference checkout can be opened as its own project.
Service-owned output directories are excluded from both watching and analysis. Policy
changes refresh discovery without inventing file creation/deletion evidence.

History is written once per workspace. The in-memory tail is bounded; earlier pages
are read from the retained journal segments in bounded chunks. Snapshot/history
restoration does not replay shots. Live events pass through a bounded animation queue; overflow skips visual events while preserving
the journal. A filesystem correlation remains evidence of a change, not proof of authorship.

## Desktop distribution boundary

`npm run desktop` is a runnable development app. Dependencies, including parser/worker
libraries, are bundled locally by `scripts/bundle-viewer.mjs`. The Codex CLI is an external
prerequisite, selected through `PATH` or `GALAXY_CODEX_BIN`. Desktop supports native
open/create, Codex sign-in, project chats, streamed turns, inline approvals, independent
file activity and history. Read-only adapters for local Claude Code and Codex session
files remain in `engine/agent/` for observing agents that run outside the app.

Native chat is Codex-specific. The provider-neutral activity contract is shared,
but ACP and native Claude chat are not implemented. See [Desktop Codex chats](codex-chat.md)
for the current protocol and authentication boundary.

Signed installers, automatic updates, release asset pruning and headset pairing are
future work. Blender authoring files are development assets, not part of a finalized
release bundle.

## Verification

[Verification](verification.md) lists the offline checks, the Electron checks and the
native UI flow.
Fixtures make no model calls; live authenticated execution requires separate evidence.

## Settings and IDE panels

`engine/workspace/settings.cjs` owns personal `<userData>/user-settings.json` and project
`.galaxy/settings.json`. `createSettings({ userDataFile, rootOf, onChange })` exposes
`get(projectId?)` and `set(scope, projectId, value)`. Reads use the same JSONC reader
as launch configurations and never cache file contents. Effective values merge each
top-level section, with project keys overriding personal keys. Missing values retain
consumer defaults (Failures for exceptions, enabled Problems, 2000 files).

Writes validate a plain JSON object, enforce a 256 KB UTF-8 limit including formatting,
validate known Debug/Problems fields and preserve unknown keys. `problems.maxFiles`
must be a positive integer. Project paths resolve beneath the real project root,
including symlink targets; escaping links are rejected. Writes serialize through
`writeJSONAtomic`; successful writes emit `galaxy:settings-event` with the refreshed
snapshot. The main process validates the active project and exposes only fixed IPC
channels through the isolated preload.

File → Settings… opens the Personal / This project modal. Changes save on blur or
selection and report Saved or an inline validation error. Launch configurations are
read-only in the form; Open launch.json opens or exclusively creates the workspace
file through the scoped workspace-files API. Existing files are never overwritten
by creation. Personal JSON stays outside the workspace editor boundary and is shown
as a copyable path. Adapter downloads occur only on an explicit Install click.

The Debug picker refreshes on open and Settings events, remembers its choice per
project, and supports language-independent launches, exception policy, agent hand-off,
and up to five selected-frame evaluations. The Problems status item opens the sidebar;
its project-scoped store ignores stale project responses and applies Monaco markers
with owner `galaxy-problems`. Errors from absent Problems handlers show Problems
unavailable. Problems and evaluate main handlers are supplied by the separate engine
implementation; this change only adds their preload and renderer consumers.
