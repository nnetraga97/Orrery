# Problems

`engine/lsp/problems.cjs` owns lazy, project-scoped LSP diagnostics. Electron exposes
`problemsGet(projectId, files?)`, `problemsInstall(id)` and `onProblemsEvent(callback)`.
Snapshots contain project-relative diagnostics, server statuses and `updatedAt`.
Positions are 1-based, severity is error/warning/info/hint, and messages are limited
to 2000 characters. Publish events are debounced to at most four per second.

| ID | Server | Pin / entry |
| --- | --- | --- |
| `typescript` | TypeScript / JavaScript | typescript-language-server 6.0.2; `package/lib/cli.mjs --stdio` |
| `pyright` | Python (Pyright) | pyright 1.1.414; `package/langserver.index.js --stdio` |
| `jdtls` | Java (jdtls) | User-installed jdtls on PATH with Java 21+ |

The Node servers run with the current executable, adding `ELECTRON_RUN_AS_NODE=1`
under Electron. Their environments remove Galaxy switches and the Nebius key.
Problems starts by itself when a project opens, so it never runs files the project
supplies. TypeScript always uses the app's own tsserver, not the project's
`node_modules/typescript`. Pyright runs only the interpreter named in personal settings
(`debug.python`), otherwise `python3` on PATH; a project `.venv`/`venv` contributes its
`site-packages` as plain search paths, and project settings cannot choose the interpreter.
jdtls imports sources as a plain project with Gradle, the Gradle wrapper and Maven import
disabled, because those run build scripts. Maven and Gradle dependencies therefore do not
resolve in Problems yet; a per-project trust choice would be the way to enable them.
Debugging is different: the user asks to run the project, so it uses the project's
interpreter and launch configuration. Analysis uses Pyright's workspace mode.
Java shares the debug manager's single jdtls per project and subscribes to its
published diagnostics. Diagnostics startup does not require a runnable main class.
If the debug plugin is installed later, the shared server restarts when a debug
launch needs that plugin; subscribers remain attached to the manager.

Only an explicit install calls the shared verify-then-extract installer. Starting
or querying a project never downloads tools. Pins live in
`engine/debug/adapters/install.cjs`:

- typescript-language-server: `d225b223a8a4764ecbd94bdba85d2ef185eaa7b9842a1a31c38c2bbe7f2fe9b9`
- pyright: `bf5f473f6167c0d14175492c3263d783b4489a6956e1c06c18e15228e3a3fa42`

Both are npm registry tarballs with a top-level `package/` directory. Missing Node
servers report `missing` and `installable: true`. Missing jdtls/Java reports
`missing`, a reason naming jdtls and Java 21+, and `installable: false`. Other states
are `idle`, `starting`, `ready`, `disabled`, and `error`.

Personal `<userData>/settings.json` and project `.galaxy/settings.json` are read
fresh; project values override personal values within each section:

```json
{
  "debug": { "python": "/path/to/python" },
  "problems": {
    "enabled": true,
    "typescript": true,
    "python": true,
    "java": true,
    "maxFiles": 2000
  }
}
```

Only languages present in the project start. Discovery skips `node_modules`, `.git`,
`dist`, `build`, `out`, `.venv`, `venv`, `target`, and `__pycache__`, as well as symlink
entries. Files must resolve inside the real project root and be regular files no
larger than 2 MB. Diagnostics outside that root are discarded. Discovery opens up
to `maxFiles` files per language (default 2000, maximum 20000), in batches for
TypeScript; pyright and jdtls also perform workspace analysis.

`get(projectId, files)` explicitly opens/refreshes the requested files and waits
for their publishes, up to 15 seconds. Pull diagnostics are a fallback only for
servers advertising `diagnosticProvider` when push is silent. An empty result at
the timeout is not proof that a server has completed workspace analysis.
Workspace file notifications and Nemotron file writes feed full-text `didChange`
or `didOpen`/`didClose`. The Explorer watcher covers visited directories; a new
Problems query also rescans source files to reconcile external changes. Settings
changes take effect on the next query or file refresh.

Closing a project or quitting sends `shutdown`, then `exit`, closes transports,
and terminates owned process groups. The shared jdtls closes with the project.

Run `node checks/problems.cjs` and `node checks/agent-debug-tools.cjs` offline.
`node checks/problems-live.mjs` uses local pinned tarballs, checks real TS/Python
errors and Java when installed, clears an edited TS error, and checks process
cleanup. It uses stdio and does not need socket binding.
