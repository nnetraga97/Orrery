# M3 + M4 notes

How `docs/plans/m3-m4-agent-and-polish.md` was applied after the design review
(`docs/plans/changes-after-review.md`) and the first plan's rework. Where the plan's text and the review differ,
the review wins; where both name something that no longer exists, the replacement is listed here.

## What stands in for what

| The plan says | Built as |
| --- | --- |
| Colours `#282f3a`, `#7fc79a`, `#e48c8c`, `#e59a92`, … | `THEME` tokens only (`src/core/theme.ts`): added lines `ok`, removed lines and failures `alert`, the glyph `work`. |
| Chat canvas 1536×1840 for 0.64×0.77 m, text 30 px | `CHAT_WINDOW`: 1200×2160 for 0.40×0.72 m, body text 26 px (review, Task 4). |
| `src/galaxy-bridge/icons.ts` with `drawIcon` | `src/panels/icons.ts`. Panels may not import the copied code, so the composition root hands it `UIIcons.shape` (`setIconShapes`). A name the module lacks draws as a small circle. |
| The dock, its `Agent` and `Help` buttons, the palm menu | The tab strip: Chat shows and hides the chat, Replay starts a replay, Settings shows settings inside the chat window. `palmMenu` is not a setting. |
| The microphone orb | The microphone button at the right end of the composer (review, Tasks 8 and 9). |
| The table, project cards | There is no table; the project is chosen in Settings ("Project"). |
| `OneHandGrabbable` on the chat panel, 0.6–1.3 m | The window's existing grab bar (`CanvasPanel` window option `movable`, clamped 0.5–1.4 m by `clampReach`). |
| A problem card above the table with `Start` | A red attached card (0.24×0.09 m) beside the bug's town with the scenario's title and function, plus a red fault dot. Pinching it opens the chat with the first prompt ready. Fixed: `ok` for five seconds, then gone. |
| The replay panel with a timeline | No panel: the code card's footer gets `Back`, `Step`, `Play` and "3 / 7"; the step's note and up to four variables sit under its header. |
| The "Show me" info card | An attached card beside the function's town: "Agent · file:line", the message, `Show me`, `Dismiss`. |

## Deviations found while building

- Task 1: branch `m3-m4` was made from `main`, which already holds the merged first plan (`origin/m1-m2` is merged).
- Task 3: the layout also returns `boxes` (bubbles, cards, code and terminal blocks, bands) beside `lines`, `regions`
  and `height`. A group's toggle key is `group:<first item id>`, so it never collides with its first row's
  `toggle:<itemId>`. Option and button regions (`option:…`, `button:…`) are laid out by the request cards and tested
  in Task 5, where their answer state exists.
- Task 4: live rows are lit (`line`) rather than pulsing: the style page allows one pulse only (the fault dot), and the
  working line's rotating ✳ already shows the turn is live. The panel still redraws ten times a second while anything
  is live (the glyph and spinning plan rings move). Code text is drawn with a hair of letter spacing, which turns off
  the monospace face's ligatures (`>=` would otherwise draw as ≥). Every icon name the plan lists exists in the copied
  icon module; the microphone is the one shape this app adds (`src/panels/icons.ts`). Diff file headers (`---`, `+++`)
  are not repeated under the path. Screenshot: `docs/migration/panels-chat.png`.
- Task 5: request cards are laid out by `layoutChat` from `model.requests` and `model.answers` (no separate hook). The
  "Say your answer" row has the region `say:<requestId>:<questionId>`; holding it records the spoken answer (Task 9).
  Approval buttons read left to right `Decline`, `Approve once` (outlined in `ok`). Chat buttons are about 2.3 cm tall.
- Task 6: the scenario's `breakPatch` starts at the start-edge check (three lines above the end-edge line): the strict
  version of the function already contains the broken `>=` line, so a shorter patch would leave "fixed" undecidable.
  The scenario also carries `shortTitle` and `function` for the problem card. `planet.js`'s earlier "source text is a
  static file" patch was rewritten (not stacked) so `loadSource` asks `sourceOverride` first and reads through
  `readSource`; `tools/migrate/apply-patches.mjs` applies it to the copied original. Edited files bypass the source
  cache, so a rebuild always sees the latest text.
- Task 7: the thread store lives in core (`src/core/chat/thread-store.ts`, over any key-value store) so it is tested;
  `StoragePort` gains `remove` and reports whether `set` was kept. A thread also carries its wire-format `messages`, so
  a restored chat can carry on. Fifty chats are kept. The chat list is a page of the chat window (`chatPage`), opened
  from the window's header; restoring the last chat on start is done by the agent system (Task 10), which owns the
  thread.
- The occasional "error during build" (also seen on the M1 + M2 merge) was Vite failing to empty `dist/data` with
  ENOTEMPTY while macOS wrote a `.DS_Store` into it. `npm run build` now removes `dist/` first with retries
  (`tools/clean-dist.mjs`).
- Task 8: the composer's state and effects are `src/core/chat/composer.ts`; its layout is
  `src/core/chat/composer-layout.ts` (pure and tested), drawn by the same code as the transcript. Stop also pauses
  the queue (Resume queue sends it), as the desktop does after an interruption. Reuse and Reply are small labels under
  the messages. The window's pinch wiring is Task 11 (the chat window system), not `panel-system.ts`.
- Task 9: the microphone is the composer's round button (review); there is no orb. The browser adapter asks for the
  microphone inside `available()`, so the fake (`?say=`, phrases split by `|`) never prompts. When voice is
  unavailable, the one notice ("Voice isn't available here. Pinch a suggestion instead.") shows above the composer
  and the microphone turns amber. Heard words go to the composer, to a held question's "Say your answer", or to a
  queued message being said again (`voiceTarget`). Check: `"read": "Fix it"`.
- Task 10: the tool executor (`src/core/agent/run-tool.ts`) and the recorded reply choice
  (`src/core/agent/recorded.ts`) are in core, so a core test plays the whole recorded session through the real loop
  and workspace. The agent system also handles every pinch on the chat window by region id (`chatAction`). The plan's
  Step 8 check for `fixed` (the file no longer contains `>= range.endColumn) {…return true`) can never pass: the strict
  version of the function rightly keeps that text. The check used is the scenario's own: the unique broken text is
  gone (`isFixed`). Result: status `idle`, `changed` `["core/range.ts"]`, `fixed` `true`. The show_user card, the
  problem card and the transcript on the chat window are drawn in Task 11.
- Task 11: the chat window system draws the transcript (or the chat list) over the composer and routes pinches by
  region id; holding `mic`, `say:…` or `queue:again:…` talks (`CanvasPanel.onPressStart` / `onPressEnd`). The window
  moves by its existing grab bar (no `OneHandGrabbable`). The attached cards (`src/systems/callout-system.ts`) sit
  beside the bug's planet, on the side toward the middle of the view (the chat window stands on the left and would
  hide a card on the far side), and draw over the chat window. They anchor to the file's planet (`bodyPos` plus its
  size), not to the function's town: the copied code has no town position to ask for. The "Show me" card is
  0.24 × 0.09 m like the problem card. Emulator check, Quest 3 profile, seated, hands only: pinched "Fix it" and Send,
  pinched the first option and Send answer, pinched Approve once; the problem card turned green ("Fixed"). Again with
  `?say=Fix it|Fix only this function`: held the microphone, then held "Say your answer"; the answer reached the model
  and the card turned green. The test hook gains `__orrery.target(panel, region)` and `__orrery.regions(panel)`.
- Task 12: provider APIs were checked against current documentation (2026-11). Claude: `claude-opus-5-5`, adaptive
  thinking with `display: "summarized"` (thinking text is hidden by default on this model family), effort explicit in
  `output_config` (default `medium`), strict tools with `eager_input_streaming`, `fallbacks: "default"` with the beta
  `server-side-fallback-2026-07-01`, the system prompt and tool list cached plus top-level automatic caching for the
  conversation. Strict tools reject `minLength`, `maxLength`, `minimum` and `maxItems`, so the Claude adapter strips
  them from the schemas it sends; the browser's validator still enforces them. OpenAI: the Responses API (function
  calling with its reasoning models goes through it), stateless (`store: false`), reasoning items passed back
  unchanged as `opaque`, default model `gpt-6-astra`; tools not strict there, because OpenAI's strict mode needs every
  property required. Nemotron: plain `fetch` to the desktop loop's endpoint and default model, streamed. The relay
  logic is `api/_lib/relay.ts` with its dependencies injected (tested without keys); `api/agent.ts` wires the real
  clients. Prices for the budget guard are estimates on the high side (`api/_lib/limits.ts`). `npm run dev:api` runs
  the functions locally; Vite proxies `/api` to it. `?agent=live` offers only providers the server holds a key for;
  `rate_limited` or `budget_spent` switches to the recorded agent with a notice.
- Task 14: as the review says, no replay panel: the code card grows by the step's note and up to four values and its
  footer gets Back, Step, Play/Pause and "3 / 5" (`src/systems/replay-system.ts`, `draw-code-card.ts`). The ship moves
  through `view.executionAt` with the step's stack (innermost first), which labels the frames. The plan's
  `view.runtimeStack(frames, selected)` is not called: it expects a live debugger session's frames (ids, depth,
  source revision checks) and has nothing to show for a recorded run. Closing the code card ends the replay. The
  Replay tab runs the failing run before the fix and the fixed run after; `run_replay` does the same. Check:
  `"read": 2`; screenshot `docs/migration/xr-replay.png`.
