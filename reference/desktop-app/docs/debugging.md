# Debugging

Electron owns one interactive run or one probe through `engine/debug/session-manager.cjs`.
The renderer keeps the existing debug IPC, frame, breakpoint, scope and variable contract.
DAP clients use byte-counted Content-Length framing over TCP or stdio. Java's reusable
LSP client shares that framing. No adapter is downloaded during launch or detection.

| Language | Adapter pin | Transport |
| --- | --- | --- |
| JavaScript / TypeScript | vscode-js-debug 1.140.0 | Standalone TCP server; reverse `startDebugging` requests create child connections, including node:test workers |
| Python | debugpy 1.8.22, pure Python wheel | stdio; debugpy also needs a loopback socket internally |
| Java | java-debug plugin 0.53.2 from vscode-java-debug 0.60.0 | TCP from a user-installed jdtls, with Java 21+ |

`adapters/install.cjs` records exact URLs and SHA-256 pins. `createInstaller({userData})`
provides `status(id)` and `install(id, {source})`. Installation is explicit, verifies the
archive before extraction, rejects absolute/traversal paths and links, uses system `tar`,
and atomically publishes a versioned directory. `source` is a local artifact override
for tests. `GALAXY_DEBUG_ADAPTERS` overrides the normal `userData/debug-adapters` root.
The system tar must support ZIP/VSIX/wheel archives (macOS/Windows bsdtar does).

The preload bridge exposes `debugConfigurations(projectId)`, `debugAdapterStatus()` and
`debugAdapterInstall(id)`. The install IPC is invoked only by an explicit user action;
the Debug and Settings panels provide explicit Install buttons with pinned version and download details. An absent adapter produces a named launch error.
Python uses configured `python` (launch config, personal/project `debug.python`), then
`.venv`/`venv`, then `python3`; the chosen interpreter is reported in state. Launches
remove `NEBIUS_API_KEY`, `ELECTRON_RUN_AS_NODE` and `GALAXY_*` from the debuggee environment.

Launch configurations combine JSONC `.vscode/launch.json`, `.galaxy/settings.json`
`debug.configurations`, personal settings, and detected suggestions. Workspace, home,
environment and explicitly supplied file variables are substituted. Legacy entry/args
launches select an adapter by extension. Entry paths must remain inside the real project
root. Java main classes are resolved after jdtls imports the project; detection never
starts jdtls. Each project has one lazy jdtls process with fresh data/configuration under
`userData/jdtls/<root-hash>`; it survives debug runs and ends on project close/app quit.

Exception mode defaults to `failures`: JS uses `all` plus internal-file skipping;
Python uses `uncaught` and `userUnhandled`; Java uses `uncaught`. `all` uses JS `all`,
Python `raised`/`uncaught`, Java `caught`/`uncaught`. `uncaught` uses only that filter and
`none` clears filters. Only adapter-advertised filter IDs are sent. This catches promise
rejections and test-runner failures that an uncaught-only policy misses.

Pause breakpoints stop normally. Trace breakpoints capture a sequenced top frame and
continue. Breakpoints retain the source text they were set against; changed files report
`stale source` and are not sent. Updates reach every live child connection. Frames capture
current regular workspace files up to 2 MB, use `mapping: 'adapter'`, and omit scopes for
async label separators. Source capture describes the current file, not a runtime revision.

`probe(projectId, {configuration|entry, args, probes, hitCap=20, timeoutMs=45000,
exceptionMode='failures'})` refuses to interrupt interactive debugging. Each probe is
`{file,line,expressions,condition?}`. Its JSON report contains:

- `hits`: file/line, up to five frames, up to 20 top-frame locals, and watch-context
  evaluations (`expression`, `value`, `type`, optional `error`). Values are capped at 300 characters.
- `exception`: the first exception whose top frame has workspace source, with message,
  exceptionInfo, frames and locals; `externalExceptions` counts auto-continued external stops.
- `output`: last 8000 characters; `exit`: termination status and an exitCode only if reported.
- `timings`: adapterStartMs, firstStopMs (null if no stop), totalMs.
- `stopReason`: `exited`, `hitCap` or `timeout`. Protocol/startup failures reject with cleanup.

Attach and preLaunchTask are unsupported and carry explicit reasons. js-debug and
java-debug may omit `exited`, so their exit codes are unknown; completion uses `terminated`
on every DAP connection. Java requires an existing jdtls installation, and pytest requires
pytest in the selected project interpreter. The live suites need socket permission.

## Adapter quirks found live

- Listen for `initialized` before sending `initialize`: java-debug sends both in one packet.
- Send breakpoints by line only. A column makes an inline breakpoint, which java-debug then
  matches against nothing on the line.
- java-debug takes `args` and `vmArgs` as single command-line strings, and reports a wrong
  type only as an LSP log message, never as a DAP error.
- js-debug puts the exception message in `exceptionInfo.exceptionId`; debugpy splits it into
  `details.typeName` and `details.message`.
- The standalone js-debug server has no workspace folder. Launches pass explicit `outFiles`
  and `pauseForSourceMap: true` so TypeScript breakpoints bind before compiled code first runs.

Set `GALAXY_DAP_TRACE=<file>` to append every DAP and LSP message as a JSON line.

## Agent debugging and hand-off

Nemotron receives provider-neutral Problems/debug capabilities from the desktop host.
`problems({files?})` is available in read-only chats. Use it after edits to see up to
200 diagnostics and any missing/disabled/error server statuses. See [Problems](problems.md).

`debug_probe({configuration?, entry?, args?, probes, exception_mode?})` runs code and
returns probe values, the first workspace exception with locals, stop reason, timings
and the last 2000 output characters. Prefer probes to adding print statements;
`exception_mode: all` also stops on exceptions the code catches and hides.
`debug_start({configuration?, entry?, args?, breakpoints?, exception_mode?})` captures current source
for pause breakpoints, launches as the agent, and waits up to 30 seconds for a pause
or exit. `debug_step({action})` continues or steps over/into/out and waits again.
`debug_inspect({frame?, expand?})` shows scopes/variables or expands a dotted path one
level (4000 character limit). Frame indices start at zero. `debug_evaluate({expression,
frame?})` uses DAP's `repl` context; values are clipped to 2000 characters and expandable
handles expire when the pause changes. `debug_stop()` ends the agent's run.

Probe, start, and evaluate need the same command approval as `run_command` unless the
chat has full access. Debug tools are unavailable in read-only chats. A probe cannot
interrupt an interactive run; agent tools refuse to take over a user-driven session.
`debug_handoff({message})` requires a pause and sets `driver: 'user'` and
`handoff: {message,time}`. Use it when stuck or when the user should inspect the pause.
The agent can still stop its handed-off run, but other debug tools refuse with
"The user is driving this session". The next user command clears the hand-off; a
launch or stop also clears it. IPC launches and commands default to `driver: 'user'`;
agent launches and commands explicitly pass `{driver:'agent'}`.

The bridge adds `debugEvaluate(session,pause,frameId,expression)` without changing
existing scopes/properties or introducing new transcript event types. Debug tool
transcript entries remain `dynamicToolCall` with arguments and the result.
