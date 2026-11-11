# M3 + M4 Implementation Plan: the agent, voice, replay and polish

> **How to use this plan.** Do the tasks in order. Each task says what to build, the files, the rules it must obey,
> how to check it, and the commit message. Tick a step's checkbox (`- [ ]` to `- [x]`) only when its check passes.
> No plugin or workflow tool is required. When a check fails and the task's notes do not cover it, stop and report.

**Goal:** Talk to a coding agent from inside the galaxy. It reads files, points at code, asks questions, proposes a fix you review and accept by hand, and the fix is shown working in a step-by-step replay. Every feature of the desktop chat window is present in a form that works in a headset.

**Architecture:** The chat is a floating canvas panel, like the code page. Everything it shows comes from pure functions in `src/core/chat/` ported from the desktop chat, with tests. The agent loop and its tools run in the browser against an in-memory copy of the project. A small server function relays each model call to Claude, OpenAI or Nemotron with keys it holds. Everything is built and tested against a recorded session first; the Claude key is asked for only at Task 19.

**Tech stack:** TypeScript, IWSDK, the 2D canvas API, the browser's speech recognition, `@anthropic-ai/sdk` and the OpenAI SDK on the server, Node's test runner, Playwright.

**Read first:** `docs/design.md` §4.5–4.7 and §5; `docs/plans/m1-m2-galaxy-and-code.md` ("The four ideas", "Rules", "Test hook"); the desktop chat sources under `reference/desktop-app/viewer/app/` (`codex-chat.ts`, `panels/CodexTranscript.tsx`, `panels/CodexActions.tsx`, `panels/CodexChat.tsx`, `panels/Markdown.tsx`, `panels/AgentShow.tsx`, `panels/AgentShip.tsx`) and `reference/desktop-app/engine/agent/`.

---

## Read this first

### Where you start

The M1 + M2 plan must be finished and its branch merged or available. Create your branch from it:

```bash
git fetch origin && git checkout -b m3-m4 origin/m1-m2 && npm install && npm run verify
```

Expected: `npm run verify` ends with `SMOKE PASSED` twice.

### Rules

Rules 1–7, 9 and 10 of the M1 + M2 plan apply unchanged (branch name `m3-m4`). In addition:

- **A. Build against the fake first.** Every task before Task 19 must pass with no key and no network. The default agent is the recorded one. Do not ask for a key before Task 19.
- **B. Keys live only on the server**, in `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NEBIUS_API_KEY`. Never in `src/`, in a file git tracks, in a log, or in a message to the owner.
- **C. One provider's code never borrows another's SDK.** Claude uses `@anthropic-ai/sdk`. OpenAI uses OpenAI's SDK. Nemotron uses plain `fetch` against its Chat Completions endpoint, as the desktop loop does.
- **D. Check provider APIs against current documentation** before writing an adapter, not from memory. For Claude, if a `claude-api` skill is available, load it first.
- **E. The conversation history is append-only.** Never edit or drop an earlier assistant message or any block inside one.
- **F. No typing.** Where the desktop app has a text box, this app has voice, a pinchable choice, or both.

### The desktop app's repository is next door

The desktop app this project was copied from, `codebase-viz`, is checked out in the same parent folder as this
repository (normally `../codebase-viz`; confirm with `ls ..`). You may read it whenever `reference/` does not have
what you need: the full desktop chat services under `desktop/`, a panel's styles, a file that was not copied.

- **Read only.** Never edit, commit or run installs in that folder.
- **Nothing here may depend on it.** No import, build step, test or script in this repository may reach into
  `../codebase-viz`, except the two refresh tools that take its path as an argument (`tools/migrate/copy-code.sh`
  and `npm run assets`), and only when a task tells you to run them.
- **Do not copy more code across by hand.** If a task needs a file that is not in `galaxy/` or `reference/`, add it
  to `tools/migrate/copy-code.sh`, run the script, and say so in the commit.
- If the folder is not there, carry on: everything the plan requires is already in this repository.

### Chat feature parity

Every feature of the desktop chat window, and where it lands. "Same" means the same data and behaviour, drawn on the canvas panel.

| Desktop feature | In the headset | Task |
| --- | --- | --- |
| User message bubble, right-aligned, with attachment chips | Same. The chip names the code the user was looking at | 4, 8 |
| Agent message as Markdown: headings, lists, code blocks with a language label, inline code, bold | Same | 2, 4 |
| Emoji in agent text | Drawn in colour by the canvas | 4 |
| Message actions: Copy, Reuse, Reply | Reuse and Reply kept (they refill the pending message). Copy is dropped: there is no clipboard to paste into | 8 |
| Thinking row: "Thinking" while live, "Thought for 8s" after, expandable | Same | 1, 4 |
| Action rows with icon, verb, target, meta: Read, Searched for, Listed, Ran, Created, Edited, Deleted, Called, Searched the web, Compacted | Same wording and icons. Rows for kinds this app cannot produce (terminal commands, web search) still draw correctly if a provider sends them | 1, 4 |
| Live rows shimmer; failed rows turn red with an alert icon | Live rows pulse; failed rows same | 4 |
| Expand a row to its detail: terminal block, diff with added and removed lines, tool arguments and result | Same | 4 |
| Action groups with a summary ("Read x.ts, searched 3 times, edited 2 files"), open while live, closed after, failure count | Same | 1, 4 |
| Plan card with steps: pending, in progress (spinning ring), completed (tick), "N of M done" | Same | 1, 4 |
| "Changed N files this turn" with totals, expandable to diffs | Same | 1, 4 |
| Working line: the rotating `✳` glyph, a word for what the agent is doing, and elapsed time | Same, including the glyph and its orange colour `#d97757` | 4 |
| Agent question card: one block per question, options with label and description, free-text answer, Send answer, "Answer each question before sending." | Options are pinchable. The free-text box becomes "Say your answer" (voice). Secret questions are refused with an error row: there is nothing secret to ask for here | 5 |
| Approval card: "Approve this action" / "Approve file changes", Review changes, Decline, Approve once | Same | 5 |
| Footer status: "Waiting for your response", "Stopped", "Turn failed" | Same | 4 |
| Error bar | Same | 4 |
| Thread title, "New chat" | Same | 7 |
| Welcome text for an empty chat | "What would you like to fix?" with the suggested prompts | 8 |
| Chat list with "Working" and "Needs input" badges, new chat, resume last chat | Same, stored in the browser | 7 |
| Composer text box | Microphone orb: hold to talk, see the words, Send or Cancel | 8, 9 |
| Enter to send, Shift+Enter, key hints | Not applicable | — |
| Stop while running | Same | 8 |
| Follow-up while running: Steer or Queue; queued list with Edit and Remove, Resume queue | Steer and Queue same. Edit becomes "say it again", which replaces the queued text | 8 |
| Slash commands `/new`, `/plan`, `/default`, `/review`, `/compact`, `/model`, `/permissions` | Pinchable chips in a "More" row doing the same things | 8 |
| `/skills`, `/connectors`, `/plugins`, the + menu's connectors and plugins | Not carried over: they belong to a desktop command-line agent that does not exist here | — |
| Attach files, folders, photos; paste images; drag and drop | Replaced by one chip, "What I'm looking at": the open file and selected lines | 8 |
| Image thumbnails and viewer | Not carried over: nothing here produces images | — |
| Model, reasoning effort, permission (Read only / Workspace / Full access), Work/Plan mode | Same, in the settings panel and the "More" row | 8, 16 |
| Provider switch: Codex / Claude Code / Nemotron | Claude / OpenAI / Nemotron, listing only providers the server has a key for | 8, 17 |
| Sign-in, sign-out, "not installed", "key missing" screens | One state: "This provider is not available." Keys are the server's business | 8 |
| Context line: project, branch, changes button that starts a review | Project name and "N files changed"; pinching it asks for a review | 8 |
| Auto-scroll only when near the bottom | Same | 3 |
| Agent "Show me" callout with Show me / Dismiss, and follow mode | Same, as an info card; follow mode flies there by itself | 10 |
| Debugging notice: "Agent is debugging … paused at file:line", Follow ship / Stop following / Dismiss | Same, driven by the replay | 14 |
| Drafts saved per chat | Not applicable: there is no half-typed text | — |

If the owner wants any "not carried over" item back, it becomes a new task; do not build it unasked.

---

## File structure this plan creates

```
src/core/chat/types.ts          items, requests, questions, threads (ported shapes)
src/core/chat/describe.ts       icon, verb, target, meta for an action row; group summaries; diff stats
src/core/chat/arrange.ts        messages and action groups in display order
src/core/chat/markdown.ts       the Markdown subset -> blocks and inline runs
src/core/chat/layout.ts         blocks -> positioned lines and hit regions, with scrolling
src/core/chat/threads.ts        thread list, titles, badges
src/core/agent/wire.ts          the message format shared by browser and server
src/core/agent/tools.ts         tool names, schemas, validation
src/core/agent/loop.ts          the agent loop as a state machine
src/core/agent/permissions.ts   which tool calls need approval in which mode
src/core/workspace.ts           in-memory files and edits
src/core/diff.ts                line diff and unified diff text
src/core/replay.ts              stepping through a recorded run
src/core/scenario.ts            a bug scenario's shape and its checks
src/core/speech.ts              push-to-talk as a state machine
src/ports/agent.ts, speech.ts
src/adapters/fake-agent.ts, http-agent.ts, browser-speech.ts, fake-speech.ts
src/panels/draw-chat.ts, draw-composer.ts, draw-replay.ts, draw-settings.ts, draw-problem-card.ts
src/systems/agent-system.ts, voice-system.ts, replay-system.ts, sound-system.ts
src/galaxy-bridge/agent-events.ts   tool calls -> the cannon and ships
api/agent.ts, api/providers.ts      server functions
api/_lib/claude.ts, openai.ts, nemotron.ts, limits.ts
public/scenarios/range-edge.json    the first bug scenario
tools/dev-api.mjs                   runs the server functions locally
docs/headset-session.md             the two-hour device checklist
```

---

# Part 1 (M3): the agent and voice

### Task 1: Chat data and wording

**Files:** Create `src/core/chat/types.ts`, `describe.ts`, `arrange.ts`, each with a test file.

- [x] **Step 1. Types.** Port `CodexItem`, `CodexChange`, `CodexRequest`, `CodexQuestion` and the thread shape from `reference/desktop-app/viewer/app/codex-chat.ts` (lines 5–60), renamed `ChatItem`, `ChatChange`, `ChatRequest`, `ChatQuestion`, `ChatThread`. Keep the field names and the status values `inProgress`, `running`, `completed`, `failed`, `declined`.
- [x] **Step 2. Tests first, then port** from `reference/desktop-app/viewer/app/panels/CodexActions.tsx`, as pure functions returning data instead of React elements:
  - `stat(diff)` → `{ added, removed }` (their `stat`, line 49);
  - `describe(item)` → `{ icon, verb, target, meta, failed, live }` (their `describe`, lines 80–157), with the same wording: "Reading/Read", "Searching for/Searched for … in path", "Listing/Listed", "Running/Ran … exit N", "Created", "Deleted", "Edited … +a −r", "Calling/Called server · tool", "Searching the web for/Searched the web for", "Compacting/Compacted the conversation", and the `show_user` special case;
  - `isAction(item)` (line 160);
  - `summarize(items)` (line 168): "Read x.ts, searched 3 times, ran 2 commands, edited 2 files, called a tool"; "Thought" / "Thought N times"; "Worked"; plus the failure count;
  - `thinkingLabel(item, elapsedMs)`: a leading `**bold title**` if present, else "Thinking" while live, else "Thought for 8s" or "Thought";
  - `workingLabel(items, elapsedMs)`: the working line's word ("Thinking…", "Reading…", "Writing…", default "Working…") and time as "12s" or "1m 5s".
  Write at least one test per verb and per summary form, using the desktop wording as the expected strings.
- [x] **Step 3. `arrange(items)`** (their `arrange`, `CodexTranscript.tsx` line 102): messages stand alone; consecutive actions between two messages form one group; a single-item group is a plain row. Test with a mixed list.
- [x] **Step 4. Check and commit.** `npm run verify`. Commit: `Port the chat's data shapes and wording as pure functions`

### Task 2: Markdown

**Files:** Create `src/core/chat/markdown.ts` + test.

- [x] **Step 1. Tests first.** `parseMarkdown(text)` returns blocks: `paragraph`, `heading` (levels 1–4, all drawn alike), `list` (ordered or unordered, items not nested), `code` (with `language`), each holding inline runs `{ text, bold?, code? }`. Line breaks inside a paragraph are kept. No links, tables, italics or HTML: they stay as literal text. Port the behaviour of `reference/desktop-app/viewer/app/panels/Markdown.tsx`. Include a test whose text contains an emoji and one with an unclosed code fence.
- [x] **Step 2. Implement, check, commit:** `Parse the chat's Markdown subset`

### Task 3: Chat layout

**Files:** Create `src/core/chat/layout.ts` + test.

`layoutChat(model, metrics, measure)` turns the arranged transcript into drawable lines. `measure(text, font)` is passed in, so the function is pure; tests use a fake that returns `text.length × 10`.

- [x] **Step 1. Tests first.** The result is `{ lines, regions, height }`. Each line has `y`, `height`, `kind` and its runs. Cover: word wrap at the panel width; a code block keeps its lines and never wraps mid-word; a user bubble is right-aligned and at most 80% wide; a collapsed group is one line and an expanded one lists its rows; each expandable row yields a region `toggle:<itemId>`; option rows yield `option:<requestId>:<questionId>:<index>`; buttons yield `button:<name>:<id>`; `visibleSlice(layout, scrollTop, viewHeight)` returns only lines in view; `stickToBottom(previousScrollTop, previousHeight, newHeight, viewHeight)` follows new output only when within 90 px of the bottom.
- [x] **Step 2. Implement, check, commit:** `Lay out the chat transcript for a canvas`

### Task 4: Drawing the transcript

**Files:** Create `src/panels/draw-chat.ts`. Modify `src/panels/test-page.ts`, `src/galaxy-bridge/icons.ts`.

- [x] **Step 1.** `drawChat(ctx, w, h, layout, clock)` on a 1536×1840 canvas for a 0.64 × 0.77 m panel, dark background, body text 30 px. Draw every line kind from Task 3:
  user bubble (`#282f3a`, radius 14 with one square corner) with a paperclip chip per attachment name; agent Markdown; code blocks on a darker block with the language label; thinking rows with the `thought` icon; action rows with their icon, verb, target in monospace and meta (added in `#7fc79a`, removed in `#e48c8c`); failed rows in `#e59a92` with the `alert` icon; a chevron on expandable rows; expanded detail (terminal block with `$ command`, output, "Exit code N"; a diff with a header per file, `@@` hunk lines dim, added lines on a green band, removed lines on a red band; tool arguments and result as indented JSON); group headers with the summary and failure count; the plan card ("Plan", "N of M done", steps with a ring, a spinning ring or a tick); "Changed N files this turn"; the error bar; the footer status; the thread title; the welcome text.
- [x] **Step 2. The working line.** Draw `✳` in `#d97757`, rotated by `clock × 2π / 2.2 s`, then the working label and the elapsed time. Live verbs pulse between 60% and 100% opacity. While anything is live, the panel redraws ten times a second; otherwise only on change.
- [x] **Step 3. Icons.** Add to `icons.ts` a `drawIcon(ctx, name, x, y, size)` that draws `UIIcons.shape(name)`: for each `<path d>`, `new Path2D(d)`; for `<circle>`, `<rect>` and `<ellipse>`, the matching canvas calls; stroke width 2 in the icon's 24-unit box. Names used: `file, search, list, terminal, fileAdd, fileRemove, pencil, plug, sparkles, globe, compress, alert, chevron, thought, checklist, check, diff, paperclip, arrowUp, stop, close, plus, refresh, lock, unlock, shield`. If a name is missing from the module, draw a small circle and list the missing names in the commit message.
- [x] **Step 4. Test page.** Add to `panels.html` a transcript built from a fixture that contains one of every item kind, in each status, including a message with emoji and a failed command.
- [x] **Step 5. Check.** `npm run verify`; `node tools/smoke-page.mjs --page=panels.html --wait="window.__panels?.ready" --size=1600x4000 --out=docs/migration/panels-chat.png`. Open the screenshot and compare each kind with the table at the top of this plan.
- [x] **Step 6. Commit:** `Draw every kind of transcript item on the chat panel`

### Task 5: Questions and approvals

**Files:** Modify `src/core/chat/layout.ts` + test, `src/panels/draw-chat.ts`. Create `src/core/chat/requests.ts` + test.

- [x] **Step 1. Tests first: `requests.ts`.** `answerState(request)` tracks a chosen option or a spoken answer per question; `choose(state, questionId, index)`; `speak(state, questionId, text)` (spoken text overrides the option, as typed text does on the desktop); `readyToSend(state, request)` is false until every question has an answer, with the message "Answer each question before sending."; `toResponse(state)` returns `{ answers: { [questionId]: { answers: [string] } } }`; `approvalResponse(accept)` returns `{ decision: 'accept' }` or `{ decision: 'decline' }`. A question with `isSecret` makes `toResponse` throw with "This app cannot ask for secrets."
- [x] **Step 2. Draw.** Question card: heading "A question for you"; per question its text, then one large row per option (label bold, description smaller, a filled circle when chosen), then a row "Say your answer" with a microphone icon, then the spoken answer once given; a "Send answer" button and the validation message. Approval card: "Approve this action" with the reason and command, or "Approve file changes" with a "Review changes" row that expands to the diff; buttons "Decline" and "Approve once". Cards sit below the messages; the footer reads "Waiting for your response".
- [x] **Step 3. Check.** `npm run verify`; the panels screenshot shows a two-question card with one option chosen and an approval card with its diff expanded.
- [x] **Step 4. Commit:** `Add question and approval cards`

### Task 6: The workspace and diffs

**Files:** Create `src/core/workspace.ts` + test, `src/core/diff.ts` + test, `src/core/scenario.ts` + test, `public/scenarios/range-edge.json`. Modify `galaxy/viewer/app/static-data.js`.

- [x] **Step 1. Tests first: `diff.ts`.** `lineDiff(before, after)` returns hunks (longest-common-subsequence over lines is enough); `unifiedDiff(path, before, after, context = 3)` returns text beginning `diff --git a/<path> b/<path>` with `@@` hunk headers, which `stat` from Task 1 counts correctly.
- [x] **Step 2. Tests first: `workspace.ts`.** `createWorkspace(readOriginal)` where `readOriginal(path)` returns a promise of text. Methods: `read(path)`, `list()`, `search(pattern)` returning `{ path, line, text }` (plain substring or a safe regular expression, at most 200 results), `replace(path, oldText, newText)` (fails unless `oldText` occurs exactly once), `write(path, text)`, `changed()` returning paths, `diff(path)`, `turnDiff()` for everything changed since `markTurn()`, `reset()`. Paths that are absolute or contain `..` are rejected.
- [x] **Step 3. Scenario.** `scenario.ts` defines and validates `{ id, dataset, title, problem, file, line, breakPatch: { file, old, new }, prompts: string[], recordedSession: string, replay: { failing: string, fixed: string } }`. `public/scenarios/range-edge.json`: dataset `editor-core`; title "A cursor at the end of a selection is reported as outside it"; file `core/range.ts`; the function `Range.containsPosition`; `breakPatch` changes, inside that function only, `position.column > range.endColumn` to `position.column >= range.endColumn`. Write `old` long enough (include the preceding line and its leading tabs) that it occurs exactly once in the file; add a test that loads `public/data/editor-core/source/core/range.ts` and asserts that. Prompts: "Find why the end of a selection is treated as outside it", "Show me the function", "Fix it", "Explain the fix".
- [x] **Step 4. Source override.** In `galaxy/viewer/app/static-data.js` add `setSourceOverride(fn)`; `sourceUrl` stays, and a new exported `readSource(name, path)` returns the override's text when it has one, else fetches. Change the one caller, `galaxy/viewer/planet/planet.js`'s `loadSource`, through `tools/migrate/apply-patches.mjs` (add the patch, run it). The workspace becomes the override, so the scene always reads edited text.
- [x] **Step 5. Check and commit.** `npm run verify`. Commit: `Add the in-memory workspace, diffs and the first bug scenario`

### Task 7: Threads

**Files:** Create `src/core/chat/threads.ts` + test. Modify `src/ports/storage.ts`, `src/state/app-state.ts`.

- [x] **Step 1. Tests first.** `createThread(provider, dataset)`, `titleFor(thread)` (first user message, cut at 48 characters, else "New chat"), `badge(thread)` ("Working", "Needs input" or none), `upsert(list, thread)`, `lastFor(list, provider, dataset)`, and serialising to and from JSON with a size cap of 2 MB per thread (oldest tool output is cut first, never a message).
- [x] **Step 2.** Persist through `StoragePort`; restore the last thread for the provider and project on start. A chat list opens from the panel's header: rows with title and badge, "New chat" at the top.
- [x] **Step 3. Check and commit.** `npm run verify`. Commit: `Keep chats per project and restore the last one`

### Task 8: The composer without a keyboard

**Files:** Create `src/panels/draw-composer.ts`, `src/core/chat/composer.ts` + test. Modify `src/systems/panel-system.ts`.

- [x] **Step 1. Tests first: `composer.ts`.** State: `pending` text (what was heard, not yet sent), `attachContext` flag, `mode` (`work | plan`), `permission` (`readOnly | workspace | full`), `queue` (items with text and state), `running`. Functions: `heard(state, text)`, `send(state)` returning the message to send or, while running, a request to choose `steer` or `queue`; `cancel`; `reuse(state, text)`; `reply(state, text)` (prefixes each line with `> `); `enqueue`, `removeQueued(id)`, `replaceQueued(id, text)`, `resumeQueue`; `slash(state, name)` for `new`, `plan`, `default`, `review`, `compact`, `model`, `permissions`, returning the same effects as `reference/desktop-app/viewer/app/codex-chat.ts` lines 443–499.
- [x] **Step 2. Draw.** Under the transcript: the context line (project name, "N files changed" which starts a review when pinched); the suggested prompts as chips; the chip "What I'm looking at: <file>:<lines>" when the code page is open (on by default, pinch to drop); the heard text with `Send` and `Cancel`; the microphone orb (Task 9); `Stop` while running; when the user speaks while a turn runs, a row "Send follow-up: Steer · Queue · ✕"; the queue ("N queued", each with its text, `Say it again` and `Remove`, and `Resume queue` when paused); a `More` chip that opens a row of the slash-command chips and the mode, permission, provider and model choices; and the state "This provider is not available." when the server reports no key for the chosen provider.
- [x] **Step 3. Check.** `npm run verify`; panels screenshot shows the composer idle, with heard text, running with a follow-up row, and with two queued messages.
- [x] **Step 4. Commit:** `Add a composer driven by voice and pinches`

### Task 9: Voice

**Files:** Create `src/core/speech.ts` + test, `src/ports/speech.ts`, `src/adapters/browser-speech.ts`, `src/adapters/fake-speech.ts`, `src/systems/voice-system.ts`.

- [x] **Step 1. Tests first: `speech.ts`.** A state machine: `idle → listening` on `press`; `listening → heard` on `release` once a final result has arrived, or `listening → idle` with the note "I didn't catch that" after 1.5 s without one; `partial(text)` updates the live text; `error(code)` goes to `unavailable` for `not-allowed` and `service-not-allowed`, and back to `idle` for anything else; from `unavailable`, `press` does nothing.
- [x] **Step 2. Port.** `SpeechPort`: `available(): Promise<boolean>`, `start(handlers)`, `stop()`. `browser-speech.ts` uses `window.SpeechRecognition || window.webkitSpeechRecognition` with `interimResults = true`, `continuous = false`, language from `navigator.language`. `fake-speech.ts` returns the phrases given by `?say=`.
- [x] **Step 3. System.** The orb is a sphere under the chat panel. Pinch and hold starts listening; release stops. Its colour shows the state (dim, bright while listening, amber when unavailable). Heard text goes to the composer (`heard`), or to the open question's "Say your answer". On start, call `available()` and try `navigator.mediaDevices.getUserMedia({ audio: true })` once; if either fails, show one card: "Voice isn't available here. Pinch a suggestion instead." and set the orb to unavailable.
- [x] **Step 4. Check.** `npm run verify`, then `npm run smoke:xr -- --query="dataset=editor-core&say=Fix%20it" --wait="window.__orrery?.ready" --read="(__orrery.commands.pressMic(), __orrery.commands.releaseMic(), new Promise(r => setTimeout(() => r(__orrery.state.composer.value.pending), 1500)))"`. Expected: `"read": "Fix it"`.
- [x] **Step 5. Commit:** `Add push-to-talk with the browser's speech recognition`

### Task 10: The agent loop and its tools

**Files:** Create `src/core/agent/wire.ts`, `tools.ts`, `loop.ts`, `permissions.ts` (each with tests), `src/ports/agent.ts`, `src/adapters/fake-agent.ts`, `src/adapters/fake-sessions/range-edge.json`, `src/systems/agent-system.ts`, `src/galaxy-bridge/agent-events.ts`.

- [x] **Step 1. Wire format, tests first.** One format for all providers:
  request `{ provider, model?, effort?, system, tools, messages }`; a message is `{ role: 'user' | 'assistant', blocks }`; blocks are `text`, `thinking` (`opaque` data returned unchanged), `tool_use` (`id`, `name`, `input`), `tool_result` (`toolUseId`, `content`, `isError`).
  Stream events from the server: `text` (delta), `thinking` (delta), `tool_use_start`, `message` (the finished assistant message with `stopReason`: `end`, `tool_use`, `max_tokens`, `refusal`), `usage`, `error`. Functions to validate each shape.
- [x] **Step 2. Tools, tests first.** Schemas (JSON Schema, `additionalProperties: false`, all fields required unless marked):
  `list_files {}`; `read_file { path, start_line?, end_line? }`; `search { pattern, path? }`; `replace_in_file { path, old_text, new_text }`; `write_file { path, content }`; `show_user { file, line?, message }` (message 1–280 characters, file must exist, line in range); `ask_user { questions: [{ id, question, header?, options?: [{ label, description? }] }] }` (at most 8 questions and 12 options each); `update_plan { steps: [{ text, status }] }`; `run_replay { which: 'failing' | 'fixed' }`.
  `validateInput(name, input)` returns the parsed input or an error string. Test every schema with a good and a bad input.
- [x] **Step 3. Permissions, tests first.** `needsApproval(tool, permission)`: `replace_in_file` and `write_file` need approval in `workspace`, are refused in `readOnly`, run directly in `full`; everything else never needs approval. In `plan` mode the two edit tools are refused with "Plan mode: no edits."
- [x] **Step 4. The loop, tests first.** `loop.ts` is a pure reducer over `{ messages, pending, status }` with events `userSaid`, `stream(event)`, `toolFinished(id, result)`, `approved(id)`, `declined(id)`, `answered(id, response)`, `stop`, `steer(text)`. Rules: append the assistant message exactly as received; never run tools from a message whose stop reason is `refusal` or `max_tokens`; run all `tool_use` blocks of a message, then send every result in **one** user message; an invalid input yields an error result, not an exception; `stop` marks the turn "Stopped" and answers any open tool calls with an error result so the history stays valid; `steer` is delivered as a user message after the current tool results; a queued message is delivered when the turn ends. The reducer returns effects (`callModel`, `runTool`, `askApproval`, `askUser`) for the system to carry out.
- [x] **Step 5. Ports and the fake.** `AgentPort.send(request, onEvent, signal)`. `fake-agent.ts` replays `fake-sessions/range-edge.json`: a hand-written session, in wire format, in which the agent thinks, calls `search` and `read_file`, calls `show_user` on `core/range.ts` at the function, asks one question with two options ("Fix only this function" / "Also check the strict version"), updates a plan, calls `replace_in_file` with the exact fix, calls `run_replay` with `fixed`, and ends with a short Markdown summary containing one emoji. Each turn is chosen by how many tool results the request holds, so the fake follows the real loop. It streams with small delays.
- [x] **Step 6. The system.** `AgentSystem` owns the workspace (seeded with the scenario's `breakPatch`), runs effects, turns tool calls and results into `ChatItem`s (`read_file` → a read row, `search` → a search row, `list_files` → a list row, the edit tools → `fileChange` with a diff, `show_user` → a `dynamicToolCall` with `tool: 'show_user'`, `update_plan` → a `plan` item, the end of an editing turn → `turnDiff`), raises approval and question requests, and keeps thinking timings.
- [x] **Step 7. In the world.** `agent-events.ts` turns each tool call into the event the copied cannon understands (see `reference/desktop-app/docs/agent-integration.md` and `galaxy/viewer/agents/agent-events.js`): reads and searches fly ships to the files; an accepted edit fires the cannon at the file; then call the constellation's `update({ refresh: new Set([path]) })` so the planet rebuilds from the edited text. `show_user` raises the "Show me" info card (title "Agent · file:line", the message, `Show me`, `Dismiss`); `Show me`, or follow mode, calls `commands.showCode(file, line)`.
- [x] **Step 8. Check.** `npm run verify`, then run the whole recorded session headlessly:
  `npm run smoke:xr -- --query="dataset=editor-core&scenario=range-edge&say=Fix%20it&auto=1" --wait="window.__orrery?.ready" --settle=60000 --read="({ status: __orrery.state.thread.value.status, changed: __orrery.workspace.changed(), fixed: __orrery.workspace.read('core/range.ts').then(t => !t.includes('position.column >= range.endColumn) {\\n\\t\\t\\treturn false;\\n\\t\\t}\\n\\t\\treturn true')) })" --out=docs/migration/xr-agent.png`
  (`auto=1` makes the test harness choose the first option of any question and approve any approval.) Expected: status `idle`, `changed` is `["core/range.ts"]`, `fixed` is `true`. The screenshot shows the transcript with a group, the plan card and the changes row.
- [x] **Step 9. Commit:** `Run the agent loop and its tools in the browser against a recorded session`

### Task 11: The chat panel in the room

**Files:** Modify `src/systems/panel-system.ts`, `src/state/commands.ts`, `src/panels/test-page.ts`.

- [x] **Step 1.** Place the chat panel at `agentPanel` from `layout.ts` (left of the table). It is a floating panel the user can also move: give its entity `OneHandGrabbable` with translate and rotate, constrained to stay 0.6–1.3 m from the seat. A `Reset layout` button in settings puts it back. Wire every hit region: toggles, options, "Say your answer", send, decline and approve, chips, queue controls, thread list. A vertical drag scrolls.
- [x] **Step 2.** The dock's `Agent` button shows and hides it. A problem card for the scenario (`draw-problem-card.ts`) sits above the table at the start: its title, its problem text and a `Start` button that opens the chat; it turns green with "Fixed" when the workspace no longer contains the broken text.
- [x] **Step 3. Check.** `npm run verify`. In the emulator, with hands only: open the chat, pinch the suggestion "Fix it", answer the question by pinching an option, pinch `Approve once`, and see the problem card turn green. Then repeat using the fake voice (`?say=`) for the answer.
- [x] **Step 4. Commit:** `Put the chat in the room as a floating panel`

### Task 12: The server functions

**Files:** Create `api/agent.ts`, `api/providers.ts`, `api/_lib/claude.ts`, `openai.ts`, `nemotron.ts`, `limits.ts`, tests beside each as `*.test.ts` run by a new script `test:api`, `tools/dev-api.mjs`, `src/adapters/http-agent.ts`. Add dependencies `@anthropic-ai/sdk` and `openai`. Add `test:api` to `verify`.

Functions use the web-standard shape `export default async function handler(request: Request): Promise<Response>`. `api/` may import only from `src/core/`. Add `"api/**/*.ts"` to `include` and `"api/**/*.test.ts"` to `exclude` in `tsconfig.json`; `test:api` is `node --experimental-strip-types --test "api/**/*.test.ts"`.

- [x] **Step 1. `providers.ts`.** `GET` returns `{ providers: [{ id, label, models, available }] }` where `available` is whether that provider's environment variable is set. No key material is ever returned.
- [x] **Step 2. `limits.ts`, tests first.** A per-visitor rate limit (by a hash of the forwarded address: 30 requests per 5 minutes) and a daily budget in US cents from `DAILY_BUDGET_CENTS` (default 2500), counted from the usage each adapter reports. Over either, the function answers with a wire `error` event `{ code: 'rate_limited' | 'budget_spent' }`; the browser then switches to the recorded agent and says so.
- [x] **Step 3. `agent.ts`.** Validate the request with `wire.ts`; reject tool lists that are not exactly this app's tools; reject bodies over 2 MB; pick the adapter; stream wire events back as server-sent events. Never log message contents.
- [x] **Step 4. Claude adapter.** Read the current TypeScript documentation for `@anthropic-ai/sdk` first. Use `client.messages.stream(...)`; model `claude-opus-5-5` unless the request names another the server allows; adaptive thinking; `output_config.effort` set explicitly (default `medium`, from the request); `max_tokens` 64000; each tool with `eager_input_streaming: true` and `strict: true`; `tool_choice` left as `auto`; server-side refusal fallbacks switched on (`fallbacks: "default"` with its beta flag); the system prompt and tool list marked for caching. Translate stream events to wire events; pass thinking blocks through as `opaque` data untouched in both directions. Map typed SDK errors (rate limit, overloaded, bad request) to wire errors.
- [x] **Step 5. OpenAI adapter.** Read OpenAI's current documentation first. Use OpenAI's own SDK with streaming and function tools; translate to and from the wire format; reasoning items it returns are carried as `opaque`.
- [x] **Step 6. Nemotron adapter.** Follow `reference/desktop-app/engine/agent/providers/nemotron-loop.cjs`: `fetch` to its Chat Completions endpoint with `NEBIUS_API_KEY`, the default model named there, streaming, tool calls translated to the wire format.
- [x] **Step 7. Tests.** Each adapter is tested with a stubbed client or a stubbed `fetch`: a text-only turn, a turn with two tool calls, a refusal, a rate-limit error, and that a returned assistant message survives a round trip unchanged.
- [x] **Step 8. Local running.** `tools/dev-api.mjs` serves the functions on a local port; `vite.config.ts` proxies `/api` to it in development. `http-agent.ts` implements `AgentPort` over `/api/agent`. The composition root chooses: the recorded agent by default, the live one when `?agent=live` and the chosen provider is available.
- [x] **Step 9. Check and commit.** `npm run verify` (now including `test:api`). Commit: `Add the server relay with Claude, OpenAI and Nemotron adapters`

---

# Part 2 (M4): replay and polish

### Task 13: The replay engine

**Files:** Create `src/core/replay.ts` + test, `public/scenarios/range-edge.failing.json`, `range-edge.fixed.json`.

- [x] **Step 1. Tests first.** A replay is `{ title, outcome: 'fails' | 'passes', steps: [{ file, line, label, stack: [{ file, line, label }], variables: [{ name, value }], note? }] }`. `createReplay(data)` gives `current()`, `step()`, `back()`, `restart()`, `play(intervalMs)` driven by a clock passed in, `atEnd()`. Validate that every `file` exists in the dataset and every `line` is in range (the test loads the baked sources).
- [x] **Step 2. Author the two replays** for the scenario by reading the code: a caller checks whether position (line 3, column 9) lies in the range (3,1)–(3,9); step through `containsPosition` line by line with the variable values; the failing replay returns `false` with the note "Expected true: the end edge counts as inside"; the fixed one returns `true`.
- [x] **Step 3. Check and commit.** `npm run verify`. Commit: `Add the replay engine and the scenario's two recorded runs`

### Task 14: The replay in the world

**Files:** Create `src/panels/draw-replay.ts`, `src/systems/replay-system.ts`. Modify `src/galaxy-bridge/inspector.ts`.

- [x] **Step 1.** The replay panel sits below the code page: title, outcome badge, the current step's label and note, the variables as a two-column list, and large buttons `Restart`, `Back`, `Step`, `Play`. On each step call the constellation's existing debug entry points (see `galaxy/viewer/galaxy/constellation-detail.js` lines 160–175 and `execution-ship.js` line 191): `view.executionAt({ file, line, label, paused: true, stack })`, `view.runtimeStack(frames, selected)`, and `commands.showCode(file, line)`. The execution ship and the frame cards then show where execution is.
- [x] **Step 2.** The debugging notice from the desktop app becomes an info card: "Agent is debugging · paused at file:line", with `Follow ship`, `Stop following`, `Dismiss`.
- [x] **Step 3.** `run_replay` from the agent, and a `Replay` button on the problem card, start it: `failing` before the fix, `fixed` after.
- [x] **Step 4. Check.** `npm run verify`; `npm run smoke:xr -- --query="dataset=editor-core&scenario=range-edge" --wait="window.__orrery?.ready" --settle=4000 --read="(__orrery.commands.startReplay('failing'), __orrery.commands.replayStep(), __orrery.commands.replayStep(), new Promise(r => setTimeout(() => r(__orrery.state.replay.value.index), 4000)))" --out=docs/migration/xr-replay.png`. Expected: `"read": 2`.
- [x] **Step 5. Commit:** `Replay the bug and the fix step by step`

### Task 15: Sound

**Files:** Create `src/systems/sound-system.ts`, `src/core/sound.ts` + test.

- [x] **Step 1.** No audio files: every sound is made with the Web Audio API. `sound.ts` (pure, tested) maps events to a recipe `{ frequency, duration, type, gain }`: hover (very soft tick), press, send, agent reply started, edit accepted (two rising notes), error (one low note), replay step. The system plays them, starting the audio context on the first pinch. A master volume and a mute live in settings; nothing is louder than a quiet click.
- [x] **Step 2. Check and commit.** `npm run verify`. Commit: `Add quiet synthesised feedback sounds`

### Task 16: Settings and accessibility

**Files:** Create `src/panels/draw-settings.ts`, `src/core/settings.ts` + test.

- [ ] **Step 1. Tests first.** Settings with defaults and validation: `textScale` (0.85, 1, 1.2, 1.4), `seatHeight` offset (−0.15 to +0.15 m), `handedness` (left or right; swaps the palm menu and the microphone side), `highContrast`, `reduceMotion` (stops the rotating glyph, label pulses and cannon camera moves), `volume`, `mute`, `provider`, `model`, `effort`, `permission`, `mode`, `followAgent`, `palmMenu`. Stored through `StoragePort`.
- [ ] **Step 2.** A settings panel opened from the dock's `Help` area: each setting is a row of large pinchable choices. `textScale` rescales the code page and chat fonts and relays them out; `highContrast` switches panels to pure black and white with thicker focus bands. `Reset layout` restores panel positions.
- [ ] **Step 3.** Confirm in the emulator that the whole scenario can be completed (a) with no voice, (b) with the right hand only, (c) with `textScale` 1.4.
- [ ] **Step 4. Check and commit.** `npm run verify`. Commit: `Add settings, larger text, high contrast and one-handed use`

### Task 17: Pause, resume and a fast start

**Files:** Modify `src/systems/*.ts`, `src/index.ts`.

- [ ] **Step 1.** Subscribe to `world.visibilityState`: when the session is blurred or hidden, stop the galaxy's time, stop redrawing panels, stop listening; resume cleanly. An in-flight model call is not cancelled.
- [ ] **Step 2.** Start-up order: room, table, project cards and tutorial first; the galaxy's heavy models (island, cannon, rigs) load after the first frame; the chat's fonts load before its first draw. Record the time from navigation to the first interactive frame in `docs/migration/m1-notes.md`; aim for under 5 s on a desktop browser.
- [ ] **Step 3. Check and commit.** `npm run verify`. Commit: `Pause cleanly and start fast`

### Task 18: Frame rate and the headset asset tier

**Files:** Modify `tools/assets/build-assets.mjs` (this plan permits it), `src/systems/galaxy-system.ts`. Create `docs/headset-session.md`.

- [ ] **Step 1. Measure.** Using `__orrery.stats()` at overview, landed, and landed with all panels open, compare with the baseline in `docs/migration/m1-notes.md`. Budgets: at most 300 draw calls and 750,000 triangles in any of the three.
- [ ] **Step 2. Reduce** until within budget, in this order: use the `-lod` rig models everywhere; cap visible ships; skip the island's landmark and house models beyond the first; lower the label pool; merge static town props. Then add `--tier=quest` to the asset script: textures at most 512 px for kit, vehicles and buildings, 1024 px elsewhere; write to `public/assets-quest/`; the app picks the folder by `?tier=` and by default on a headset user agent. The initial download (before a planet is opened) must be under 40 MB; print the total in the script.
- [ ] **Step 3. Renderer.** Set fixed foveation to a medium level and keep the default framebuffer scale; do both only inside an immersive session. Read `.claude/skills/iwsdk-dev/references/api-reference.md` ("XR Session Optimization") first.
- [ ] **Step 4. The device checklist.** Write `docs/headset-session.md`, a script for the owner's two hours on a Quest, in priority order: 1. does the page enter VR and track hands; 2. microphone permission and one recognised sentence; 3. frame rate at the three states (the browser's performance overlay); 4. can the code page be read comfortably, and at which `textScale`; 5. reach: every button from a seat; 6. the full scenario with voice; 7. the same with no voice; 8. anything uncomfortable. Each item has a "what to change if it fails" line pointing at a setting or constant.
- [ ] **Step 5. Check and commit.** `npm run verify`. Commit: `Meet the draw budgets and add a headset asset tier`

### Task 19: The live check (this is where the key is needed)

- [ ] **Step 1.** Confirm every earlier task passes with no key: `npm run verify`.
- [ ] **Step 2. Stop and ask the owner** for the Claude API key and a daily budget figure. Say what is built, that everything so far runs on the recorded session, and that the key unlocks the live end-to-end check. Ask in the same message whether keys for OpenAI or Nemotron will follow. Request the key through the environment's secure credential mechanism (in a Claude Code cloud session: the credential form for host `api.anthropic.com`, header `x-api-key`); on a local machine, ask the owner to put it in their shell environment themselves. Never ask for it to be pasted into the conversation. First check whether a credential already exists (`ANTHROPIC_API_KEY` set, or an active `ant auth` profile).
- [ ] **Step 3.** With the key in the environment of `tools/dev-api.mjs`, run the scenario with `?agent=live` in the emulator, by hand. The agent must find the function, show it, and propose a fix that makes the problem card turn green. Tune only the system prompt and the effort level; keep the system prompt and tool list byte-stable between requests so caching works, and confirm `cache_read_input_tokens` is above zero on the second request.
- [ ] **Step 4.** Save the live session as the new `fake-sessions/range-edge.json` (through a `?record=1` switch that writes the wire messages to the console for copying), so the recorded fallback shows a real run.
- [ ] **Step 5.** If OpenAI or Nemotron keys were supplied, repeat Step 3 for each. A provider that was not checked live stays unavailable: do not set its variable in any deployed environment.
- [ ] **Step 6. Commit:** `Check the agent live and record a real session for the fallback`

### Task 20: Review and report

- [ ] **Step 1.** `npm run verify`. Walk the whole experience in the emulator with hand input: tutorial, pick the project, problem card, talk or pinch a prompt, watch the agent work, answer its question, review and approve the edit, replay the fix, change two settings.
- [ ] **Step 2.** Field-of-view check with every panel open (`.claude/skills/iwsdk-glasses-test/SKILL.md`).
- [ ] **Step 3.** Go down the "Chat feature parity" table and tick each row against the running app; list any row that is not met.
- [ ] **Step 4.** Push: `git push -u origin m3-m4`. Do not merge.
- [ ] **Step 5. Report:** tasks passed and failed; the parity rows not met; which providers were checked live; the three stats against the budgets; the initial download size; the start-up time; and the items in `docs/headset-session.md` that remain unknown until the device session.

---

## Notes on how this plan was checked

- **Checked ahead of time:** the chat's features were inventoried from the desktop sources, with file and line references; the scenario's bug site exists as described in the baked `core/range.ts`; the debug entry points named in Task 14 exist in the copied code; the test runner, page smoke test and import rules this plan relies on work on the starting branch.
- **Not checked ahead of time:** any code in this plan, the three provider adapters against live services, and speech recognition in the Quest browser. Provider APIs must be read from current documentation when the adapters are written.
