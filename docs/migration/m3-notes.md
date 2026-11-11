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
