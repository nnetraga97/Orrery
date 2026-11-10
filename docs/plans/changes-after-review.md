# Changes after the owner's design review

The owner reviewed the interface and changed several decisions. This page lists what
that does to each task in the two plans. **Where this page and a plan disagree, this
page wins.** The look and the sizes are in `docs/visual-style.md`; read that first.

If you have already finished a task that this page changes, bring that work into line
in one commit named `Apply the design review changes` before your next task, and run
`npm run verify`.

## The decisions

1. **The code view is not a standing window.** It is a small card that appears only
   while a function is picked, the agent points at code, or a replay runs.
2. **No leader lines.** A card that belongs to something floats beside it.
3. **No info card for a selected file.** Selecting a file shows its marker (a label and
   a diamond) and nothing else.
4. **No ring menu, no dock, no palm menu.** Navigation is a tab strip on the chat window.
5. **No project picker.** The app opens on the demo project.
6. **No replay timeline.** The replay stays; its three controls sit on the code card.
7. **The chat keeps the shape of the desktop chat box**, narrow, in the new theme, with
   ordinary Approve and Decline buttons.
8. **No charts or graphs anywhere.**
9. **No table.** The model floats in the air in front of the user. A dark floor with a
   faint grid is the only fixed thing in the room, for comfort.
10. **Unchanged:** towns are still laid out with one building per statement, and buildings
   and code lines are still linked in both directions.

## M1 + M2 plan (`m1-m2-galaxy-and-code.md`)

| Task | Change |
| --- | --- |
| 5 The galaxy system, Step 3 | The anchor is an invisible point in the air, not a table top: position `[0, 1.05, -0.95]`, orientation pitched 20° down from level, width `1.0`, `minScale 0.0005`, `maxScale 5`. The names `tablePose` and `TableAnchor` in `src/core/table-frame.ts` stay as they are; only the numbers change. Screenshots now show the model floating, larger, in the middle of the view. |
| 6 Labels | The selected file's or function's label is a marker: micro label over a small diamond. No pointer triangle. |
| 10 Info cards, loading, errors | `CanvasPanel` becomes a **window**: glass panel, close mark, and a grab bar beneath it that moves the window when pinched and dragged (give the window's entity a grab component for translate and rotate, constrained to 0.5–1.4 m from the seat; pressing the close mark hides it). Do **not** show a card when a file is pinned or hovered: ignore context items whose key starts with `file:`. Keep cards for the other context items the copied code raises (the cannon, the station, the moon) as **attached cards**: placed 12 cm above and 8 cm to the side of their anchor, no line. Loading and error cards are unchanged. |
| 11 The room | **No table.** Build only the floor: a large dark disc at height 0 with a faint grid in `grid` that fades with distance, and keep the star field. Nothing sits under the model. The check becomes: the screenshot shows the model floating above a faint floor grid, with no disc or rim under it. Commit: `Add a floor so the room has a stable frame`. |
| 14 The code page | Becomes the **code card**: 0.46 × 0.34 m, about 12 rows (`rows: 12`, `columns: 56`), on a 1380 × 1020 canvas with 26 px code text. It opens to the right of the model when `codeView` gains a selected function or range, and closes when the selection clears or its close mark is pressed. Footer: `More` toggles 12 and 24 rows (the card grows downward). Remove the `Function / Whole file`, `Page up` and `Page down` buttons; a vertical drag still scrolls, and the range shown is always the selected function with 3 lines of context. Update the tests in `code-view.test.ts` to these numbers. In `layout.ts`, `codePage` becomes `codeCard` at its new size and the test's limits still apply. |
| 15 Linking | Unchanged, except that there are no page buttons to wire. `showCode(path, line)` opens the card. |
| 16 Dock and palm menu | **Replaced.** Build the **chat window shell** now, so navigation has a home: a window 0.40 × 0.72 m at `agentPanel`, titled "Agent", with an empty transcript area showing "The agent arrives in the next milestone", and the **tab strip** on its left edge with four icons: Home (calls `goHome()`), Chat (shows the window if hidden), Replay (disabled for now), Settings (disabled for now). Do not build a dock, a ring menu or a palm menu, and do not add `state.palmMenu`. Files: `src/panels/draw-chat-shell.ts`, `src/panels/draw-tab-strip.ts`, `src/systems/chat-window-system.ts`. Check: in the emulator, pinch the Home tab and see the phase return to `overview`; pinch the window's grab bar, move, and see the window follow. Commit: `Add the chat window shell and its tab strip`. |
| 17 Choosing a project | **Replaced.** With no `?dataset=`, the app opens `editor-core` directly. Still write `public/data/index.json` and `DatasetPort.list()`; the settings tab uses them in the next plan. Do not build picker cards. The check becomes: without a query the phase reaches `overview` with 229 files. Commit: `Open the demo project directly`. |
| 18 Tutorial | The tutorial card is 0.30 × 0.10 m above the model. `Help` no longer exists; the tutorial restarts from Settings in the next plan, and from `__orrery.commands.restartTutorial()` now. |
| 19 Review | Drop the palm-menu line from the report. Add: confirm the code card is absent until a function is picked and gone after the selection is cleared. |

## M3 + M4 plan (`m3-m4-agent-and-polish.md`)

| Task | Change |
| --- | --- |
| 4 Drawing the transcript | Draw on a 1200 × 2160 canvas for the 0.40 × 0.72 m chat window, body text 26 px, in the layout the style page gives under "The chat window". User bubbles are outlined, not filled. Plan cards, diffs, questions and approvals are small glass panels inside the transcript. |
| 5 Questions and approvals | Buttons are ordinary buttons. "Approve once" is outlined in `ok`. There is no large round control. |
| 8 The composer | One rounded row: placeholder text "Hold the microphone and talk", the microphone button at its right end, suggested prompts as a row of chips above it. The heard text replaces the placeholder, with `Send` and `Cancel`. `Stop`, the follow-up row, the queue and the `More` row appear between the chips and the composer only when they apply. |
| 9 Voice | The microphone is the button in the composer, not a separate orb. Pinch and hold it to talk. |
| 10 The agent loop, Step 7 | `show_user` raises an **attached card** beside the function's town (title "Agent · file:line", the message, `Show me`, `Dismiss`), no line. `Show me`, or follow mode, calls `commands.showCode(file, line)`, which opens the code card. |
| 11 The chat in the room | The chat window already exists from the first plan's Task 16; fill it in. The Chat tab shows and hides it. The **problem card** is a red attached card beside the bug's location, 0.24 × 0.09 m, with the scenario's short title and the function name; pinching it opens the chat with the first suggested prompt ready. A red fault dot marks the location on the model. When fixed, the card and dot turn `ok` for five seconds and then leave. |
| 13 The replay engine | Unchanged. |
| 14 The replay in the world | **No replay panel and no timeline.** Starting a replay opens the code card on the current step's line and adds `Back`, `Step`, `Play` and the position ("3 / 7") to the card's footer. The step's note shows as one line under the card's header; variables show as up to four `name = value` lines beneath it, pushing the code down. The Replay tab on the chat window starts the failing run before the fix and the fixed run after; `run_replay` from the agent does the same. The "Agent is debugging" notice is an attached card beside the execution ship with `Follow ship`, `Stop following`, `Dismiss`. Delete `src/panels/draw-replay.ts` from the file list. |
| 16 Settings | Opened from the Settings tab, shown inside the chat window in place of the transcript. Adds: "Project" (the two entries from `public/data/index.json`), "Restart tutorial", "Reset layout". Remove `palmMenu` from the settings. |
| 18 Device checklist | Add to `docs/headset-session.md`: can the code card be read at 12 lines; is the tab strip easy to hit; does moving a window by its grab bar feel steady. |
| 20 Review | In the parity table, read "Provider, model, effort, permission, mode: in the settings panel" as "in the Settings tab of the chat window". |

## Reference

The layout these changes describe is drawn in `docs/style/hologram-reference.png`.
