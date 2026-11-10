# Desktop Codex chats

The composer supports Read only, Workspace (default), and Full access permission
levels. The native service validates each choice and applies its policy to thread
start/resume and turn/start. Turn steering uses `turn/steer` with the active
`expectedTurnId` and cannot change permissions or start a replacement turn.

Follow-ups live in the app-owned chat index. The queue sends one new turn at a
time, retains per-message settings, and pauses on interruption, failure, disconnect,
or restart. Uncertain deliveries remain visible for manual recovery without retries.

The Electron app is the primary place to open a codebase, start a Codex chat and see
the resulting work in its galaxy. Chats belong to projects opened in Galaxy. The
desktop experience does not require following a session started in another client.

## Start a chat

1. Install this repository's dependencies with `npm install`. Install the Codex CLI
   separately and ensure `codex` is on `PATH`. Set `GALAXY_CODEX_BIN` to an absolute
   executable path if the desktop process cannot find it.
2. Run `npm run desktop`. On Welcome, use **Open Folder…** for an existing codebase
   or **New Folder…** for a new local directory. In a multi-folder workspace,
   select the folder in Explorer before starting a chat.
3. Open **Chats** and choose **Sign in with ChatGPT**. Complete the official Codex
   sign-in in the system browser, then return to Galaxy. The app receives the login
   completion event; no token or credential needs to be pasted into the chat.
4. Choose **New chat**, select a model and supported reasoning effort, and send a
   prompt. The conversation shows streamed replies, command output, file changes,
   and requests for a decision. Send follow-up messages in the same chat.

## Reading a turn

The agent's actions appear as compact rows: an icon, what it did and to what (**Read**
`project-model.mjs`, **Searched for** `resolveModule`, **Ran** `npm test`, **Edited**
`main.ts` with lines added and removed). Codex's own classification of a command decides
whether it shows as a read, a search, a listing or a command. Select a row to see its
output or diff. The actions between two messages fold into one group whose summary says
what happened; a group is open while the agent works in it and closes when the turn ends,
unless you opened or closed it yourself. Thinking appears as its own row, named by the
agent's summary title and timed when it was watched live. While a turn runs, the last
line shows what the agent is doing and for how long. Plans update in place as a
checklist, and each turn ends with a summary of the files it changed.

**Stop** interrupts the current turn. It does not undo completed commands or writes.
Each chat allows one active turn; other chats can run independently. Reopening a
saved chat reads its Codex history, and the next message resumes that same thread.
Sending a prompt starts model work; selecting or reading an existing chat does not.

Choose **Plan** (or type `/plan`) to explore and answer questions before receiving an
implementation plan. `/plan your task` starts that task in Plan mode; `/default`
returns to Work. Native question cards also work during regular Codex work with
the installed CLI's `default_mode_request_user_input` feature enabled by Galaxy.
Question cards accept either a suggested option or your own answer. The
[app-server protocol](https://learn.chatgpt.com/docs/app-server) defines mode
settings and `item/tool/requestUserInput`; this integration uses its experimental capability.

Sent photos and local Markdown image references in responses have previews you can
open at full size. Previews read only images referenced by that message inside the
project or its owned attachment snapshots. Copy, Reuse (your messages), and Reply
(agent messages) prepare text without modifying history. Right-click the composer
for spelling suggestions and native text editing.

The slash menu reflects the selected provider. `/model` and `/permissions` open
their pickers; `/compact` summarizes the current chat; `/new` starts a fresh chat;
`/review` asks the agent to review uncommitted changes without editing them. Picker,
compact and new commands reject unsupported arguments. Codex skill commands attach
the installed skill; Claude Code chooses its own skills and integrations.

The model list comes from the signed-in account's app-server rather than a fixed
list in Galaxy. An unavailable executable, failed sign-in or provider error is
shown in the panel. A failed send is not automatically retried; inspect the chat's
saved history before sending it again.

## Approvals and project access

By default, Codex runs in the selected project's real directory with
`workspace-write` and `on-request` approvals. Network access is disabled in this
default sandbox. Read only uses a read-only sandbox without write/network grants;
Full access disables the sandbox and approval prompts for subsequent turns.
Requests to run commands or change files beyond the current sandbox appear inline
with **Approve once** and **Decline** controls. Questions from the agent are answered
in the chat. The app does not grant permanent approval rules or extra persistent
write roots through this UI.

Opening a different project does not change a chat's working directory. The main
process checks the project and canonical root before it reads, sends, stops or
answers a request. A chat cannot be resumed against a different folder by changing
the selection in the renderer.

## Account and conversation storage

The installed Codex app-server owns the login flow and token refresh. Galaxy starts
it with an isolated `CODEX_HOME` at `userData/codex-chat/codex/`, where `userData` is
Electron's application data directory. It does not copy authentication from
`~/.codex` or another Codex app. Host OpenAI and
Codex API-key environment variables are not passed to this app-owned server.

`userData/codex-chat/chats.json` stores Galaxy's project-to-thread index and chat
metadata. Codex stores the conversation rollouts in the private `CODEX_HOME`.
Signing out uses that private server's account logout and preserves saved chats;
active turns must be stopped first. `GALAXY_DATA_DIR` selects a separate application
data directory for an isolated development run.

The renderer has no Node access and receives account metadata, conversation items
and pending decisions through named preload methods. Credentials remain in the
Codex-managed store. The main process opens only the supported HTTPS sign-in hosts
in the system browser.

## How work reaches the galaxy

Typed app-server activity is translated into the existing provider-neutral event
format. The cannon responds to current operations; the filesystem observer
independently confirms changes and schedules map analysis. Restoring conversation
history does not replay old shots. A command being requested or a patch being
proposed is not presented as proof that its files were written.

Codex subagents launch drones using their child thread IDs. Spawn and
`subAgentActivity` records share one lifecycle registry; a spawn-call result or
timed-out wait does not finish the child. Verified descendants are attached with
metadata-only `thread/read` and `thread/resume`, and their typed tool activity
fires from their own drones. Children keep independent turns, so background work
can continue after the parent turn ends. Follow-ups reuse the child's identity
and colour. Completed, interrupted, and failed work docks independently; a lost
connection records an unknown outcome rather than success.

The explicit local-rollout connection also follows child transcripts whose
metadata links them to the selected session and workspace. App-owned chat uses
only app-server notifications, preventing duplicate shots from two transports.
Reloading the window restores active drones without replaying historical tools.

`node checks/codex-drones.cjs` covers lifecycle reduction and descendant rollout
discovery. `node checks/codex-drones-desktop.mjs` launches `npm run desktop` with a
deterministic app-server fixture and checks drone clicks, child read/edit shots,
docking, rebuild/reload recovery, background work, and follow-ups. This is real
Electron verification with simulated provider events, not a live model run.

## Claude Code chats

The chat panel can drive Claude Code as well as Codex. Choose the agent in the
account menu at the top right of **Chats** (`Codex · …` / `Claude Code · …`). The
choice and each project's last chat are remembered per agent. Transcript, approvals,
queue, attachments and the galaxy activity work the same way for both.

`desktop/claude-chat.cjs` starts the user's installed `claude` in headless
stream-json mode (`claude -p --input-format stream-json --output-format stream-json
--permission-prompt-tool stdio`). This is the protocol the Claude Agent SDK uses
internally. Galaxy speaks it directly instead of bundling the SDK, which would add
a native CLI binary for every platform. `engine/agent/providers/claude-cli.cjs`
resolves the executable: `GALAXY_CLAUDE_BIN`, then `PATH` (read under either
`PATH` or Windows' `Path`), then `~/.local/bin` and `~/.claude/local`. On Windows
an npm `claude.cmd` shim is replaced by the native executable or the package's
`cli.js` (run on Electron's own Node) when one is beside it, and process trees are
ended with `taskkill /T`.

- **Login.** Galaxy uses Claude Code's own login or `ANTHROPIC_API_KEY`. It reads
  `claude auth status --json` and never handles credentials or runs an OAuth flow.
  When Claude Code is signed out, the panel asks the user to run `claude` in a
  terminal, log in, and choose **Check again**.
- **Models.** The model and effort lists come from the CLI's `initialize` answer.
  `Default` leaves the choice to the user's Claude Code settings.
- **Conversations.** A chat is a Claude Code session. Its first turn starts with
  `--session-id <id>` and later processes use `--resume <id>`. Galaxy stores only
  the project index (`userData/claude-chat/chats.json`). History is read back from
  Claude Code's own transcript under `~/.claude/projects/` (or
  `CLAUDE_CONFIG_DIR`). One process serves a chat while it is in use and exits after
  ten idle minutes. Changing the model, effort or permission restarts it on the same
  session.
- **Project settings are not loaded.** `claude -p` skips Claude Code's workspace
  trust dialog. Every process therefore starts with `--setting-sources user`, so a
  project's `.claude/settings.json` and `settings.local.json` (hooks, allow rules,
  MCP servers) never run or pre-approve anything. Your own user-level settings,
  including their allow rules, still apply. Project `CLAUDE.md` instructions may
  not load either.
- **Permissions.** Workspace maps to `--permission-mode acceptEdits`. Edits and
  Claude Code's built-in file commands (such as `mkdir` or `touch`) are accepted;
  other commands ask. Full access maps to `bypassPermissions`. Read only offers
  only `Read`, `Grep`, `Glob`, `WebSearch` and `TodoWrite` (`--tools`) and no MCP
  servers (`--strict-mcp-config`), so no allow rule can reach a tool that writes or
  runs code. Galaxy also refuses any other tool a read-only chat asks for. Every
  other prompt arrives as a `can_use_tool` control request and appears as
  **Approve once** / **Decline**. `AskUserQuestion` is shown as a question card.
- **Approval cards show what they approve.** A card's command or diff is built
  from the permission request's own input, the exact input **Approve once**
  allows, and is never shortened. A request too large to show is declined.
- **Galaxy activity.** CLI messages are replayed through the same record mapping
  that observes Claude transcripts (`claude.mjs`, via `claude-chat-events.mjs`).
  Reads, edits and commands fire the cannon. Subagents (`Agent`/`Task`) launch and
  dock drones, and their own tool calls fly from the drone. Subagent work stays out
  of the chat transcript.
- **Not supported.** Steering a running turn (queue the message instead), choosing
  skills or connectors in the composer (Claude Code chooses its own), and signing in
  or out from the app.

`checks/claude-chat.cjs` exercises this path offline against a fake `claude` that
speaks stream-json.

## Nemotron chats

Choose **Nemotron** in the Chats account menu. Galaxy calls Nebius Token Factory's
Chat Completions endpoint with `nvidia/nemotron-3-super-120b-a12b`; set
`GALAXY_NEMOTRON_MODEL` before launch to override the model. Provide `NEBIUS_API_KEY`
in the desktop process environment, or save the key in `~/.config/nebius/api_key`
and choose **Check again**. There is no in-app sign-in or sign-out flow.

The app runs the tool loop itself, with up to 40 model calls per turn. Read only
offers listing, file reading and search. Workspace also permits edits and writes;
every shell command needs **Approve once**. Full access runs commands without
asking. File tools resolve paths inside the canonical project root. Commands run
in that root using the user's shell with a 120-second timeout; this is an approval
policy, not an operating-system sandbox. Stop aborts HTTP requests and kills the
running command process tree. Completed edits are not undone.

History, transcript items and queued messages are stored in
`userData/nemotron-chat/chats.json`. The API key is kept out of that store and the
renderer. Tool outputs returned to the model are capped at about 8 KB. Activity
uses the v1 provider ID `nemotron`, with the same scene operations and disk
confirmation as other providers. Responses are not streamed yet. Compaction,
steering, images, skills and connectors are unsupported; text file attachments
are limited to 64 KB and attached folders must be inside the project.

`node checks/nemotron-chat.cjs` uses a local HTTP fixture with an injected loopback
endpoint and a fixture key; the desktop has no endpoint environment override.
For environments that deny loopback listeners, `--in-process` exercises the same
scenarios without verifying HTTP transport. Neither mode makes a live model call.

## Integration boundary

Native chat supports Codex (app-server JSON-RPC), Claude Code (stream-json), and
Nemotron (Nebius Chat Completions). Each
provider has its own service with the same API and event shapes, so the panel does
not branch on the provider. A shared ACP client is not implemented.

The development baseline is the app-server protocol supplied by Codex CLI 0.149.1.
It uses the managed ChatGPT login described in the
[Codex app-server auth documentation](https://developers.openai.com/codex/app-server#auth-endpoints).

Offline protocol fixtures verify transport, chat persistence and decision handling
without making a model call. Native Electron UI verification and a successful live,
authenticated model turn are separate checks for either provider; neither should be inferred from a
passing fake server.

See [Verification](verification.md) for the current offline checks and native UI flow.

## Composer and attached context

The composer shows the selected project and Git branch above its input. The existing
send button remains; during a turn it offers Queue, Steer, and Stop. Model, effort,
and permission controls sit below the input. **Refresh available models** asks the
account's app-server for a fresh catalog, including Astra when an older catalog
marks it hidden. Galaxy never invents an unavailable model or unsupported effort.

Use **+** to add files/photos or a folder. Files can also be dropped onto the
composer, and images pasted from the clipboard. Cmd/Ctrl+U opens the file picker.
Each message accepts up to 12 attachments, with a 20 MB limit per file. File and
photo attachments are copied into the app's private chat store; macOS HEIC photos
are converted to PNG. Folders are references to the selected directory. File paths
and attachment validation stay in the main process. Images use Codex's `localImage`
input; other files/folders are supplied as explicit paths for the agent to read
under the selected permission policy. Attachment chips can be removed before
sending and appear in the conversation after sending.

Type `/` or choose **Slash commands** in the + menu. Arrow keys move through
suggestions, Enter/Tab selects, and Escape closes the menu. Built-in actions include
`/compact`, `/new`, `/review`, `/plan`, `/model`, and `/permissions`. `/compact` uses
`thread/compact/start` after the current turn finishes; `/review` and `/plan` send
explicit review/planning requests. Unknown commands produce a local error rather
than being silently sent as a normal prompt.

Enabled skills are discovered with `skills/list` for the selected project and are
sent as structured skill inputs. **Plugins** lists enabled skills contributed by
installed plugins. **Connectors** reads the installed app runtime snapshot and lets
you attach callable apps as structured mentions; disabled/unavailable apps cannot
be selected. These menus reflect this app's private Codex environment. They do not
install plugins or perform connector sign-in. Integration discovery errors appear
in the menu's details, with a refresh action.

Attachment and skill/app selections follow their draft when switching chats or
projects. Queued messages retain their attachment ids, integration choices, and
permission settings across restarts. Editing a queued message restores its attached
context. A missing attachment or integration fails visibly without an automatic
retry.
