# Changes after the owner's design review

The owner reviewed the interface and changed several decisions. This page lists what
that does to each task in the two plans. **Where this page and a plan disagree, this
page wins.** The look and the sizes are in `docs/visual-style.md`; read that first.

If you have already finished a task that this page changes, bring that work into line
in one commit named `Apply the design review changes` before your next task, and run
`npm run verify`. The section "What is already built" below lists exactly what that
commit touches on the `m1-m2` branch.

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
10. **A landed planet is a 0.64 m globe** (the owner's choice while building). Towns are
   still laid out with one building per statement, but at that size a building is a few
   millimetres, so the model and the code are linked by function: a town on one side, its
   lines on the other.

## What is already built

Tasks 1 to 14 of the first plan were built on the branch `m1-m2` before this page
existed, and the owner and the working agent changed some things along the way. This
section was written after reading that branch (commit `282b403`) and measuring it.

### Kept as built

These differ from the plan and are now the plan. Do not undo them.

| What | Where | Note |
| --- | --- | --- |
| A landed planet is a globe 0.64 m across with its centre on the anchor, however close the copied code flies its camera. The owner chose this. | `focusedPose` in `src/core/table-frame.ts`, `LANDED_GLOBE_DIAMETER` in `src/systems/galaxy-system.ts` | A two-hand zoom while landed does nothing. See "What the 0.64 m globe means" below. |
| Hand rays hit one invisible box around the model, and the copied picking code does the picking with the ray. | `src/galaxy-bridge/pointer-bridge.ts` | Its size follows the model: see the catch-up list. |
| The copied loaders are reached through one gateway. | `src/galaxy-bridge/galaxy-session.js` | |
| `constellation.js` takes the scene kit from the host when one is supplied, as a recorded patch. | `tools/migrate/apply-patches.mjs` | |
| Code is drawn one character at a time in a bundled monospace font under a neutral family name. | `src/panels/code-font.ts`, `src/panels/draw-code-page.ts` | Keep the font and the per-character drawing in the code card. |
| `tools/xr-eval.mjs`, the point-size scaler, and the import rule that lets `src/galaxy-bridge/` use `three/examples/jsm/`. | | |

### The catch-up commit

One commit, `Apply the design review changes`, before Task 15. Everything in it is
already described in the tables further down; this is the same list against the files
that exist.

| File | Change |
| --- | --- |
| `src/systems/room.ts` | Delete the table, its rim and the `TABLE` export. Keep the floor; recolour its lines with the `grid` token. |
| `src/systems/galaxy-system.ts` | `TABLE_ANCHOR` becomes position `[0, 1.05, -0.95]`, pitch 20° down, width `1.0`, `maxScale 5`. `LANDED_CENTER` becomes `[0, 1.10, -0.95]`: with no table the globe floats, its centre a little below a seated eye. Keep `LANDED_GLOBE_DIAMETER` at `0.64`. |
| `src/galaxy-bridge/pointer-bridge.ts` | Measure the model's bounds in the overview again, as you did for the first box, and resize `HIT_VOLUME` to cover them and the landed globe at its new centre. |
| `src/core/theme.ts` (new), `src/panels/paint.ts` | Add the tokens and fonts of `docs/visual-style.md`; `paint.ts` takes every colour and font from them. The syntax colours of the code become: keywords `line`, identifiers `white`, literals `ok`, comments `lineDim`. No purple, no orange. |
| `src/panels/canvas-panel.ts` | Becomes the window of the Task 10 row below: glass panel, corner brackets, close mark, grab bar. |
| `src/panels/draw-info-card.ts`, `src/panels/info-card-content.ts`, `src/systems/panel-system.ts` | No card for a file: ignore context items whose key starts with `file:`. Selecting a file shows only its marker. A second pinch on the selected file still lands on it. Cards for other items become attached cards, 12 cm above and 8 cm to the side. |
| `src/panels/draw-code-page.ts`, `src/core/code-view.ts`, `src/core/layout.ts`, `src/state/app-state.ts` | The code page becomes the code card of the Task 14 row below: 0.46 × 0.34 m, 12 rows, 56 columns, shown only while a function or a range is selected. Remove `codePageOpen`; the card's visibility follows the selection. In `layout.ts` remove `dock`, rename `codePage` to `codeCard`, and resize `agentPanel` to 0.40 × 0.72 m. |
| `src/panels/test-page.ts`, `docs/migration/*.png`, `docs/migration/m1-notes.md` | Redraw the screenshots; replace the field-of-view rows about the table. |

The field-of-view table in `m1-notes.md` measures against the narrow view of the
glasses. The competition judges on Quest 3 and 3S, whose view is far wider. Keep every
window inside the narrow limits, as `layout.test.ts` already does, but do not shrink or
move the model to fit them.

### What the 0.64 m globe means

Measured on `m1-m2` with `core/range.ts` landed (a built page in a browser tab):

| Thing on the globe | Size in the room |
| --- | --- |
| A town's buildings | 2 to 10 mm across, a few up to 19 mm |
| Road cars | 2 to 5 mm; their wheels 0.6 mm |
| Dependency ships | about 25 mm; their arcs about 40 mm |
| Other planets around the user | about 0.5 m each; the black hole larger still |

| What is drawn while landed | Triangles |
| --- | --- |
| Everything | about 2,430,000 (the budget is 750,000) |
| Road cars and wheels | about 920,000 |
| Town buildings and props | about 1,100,000 |
| The island, its landmarks and houses | about 510,000 |
| Dependency arcs | about 237,000 |

Two things follow.

1. **A building cannot be picked with a hand ray.** A 7 mm target one metre away is
   under half a degree. Linking is therefore between a **town** (a function) and the
   code card, not between a building and a line. The Task 15 row below says how.
2. **Most of the triangles draw things nobody can see.** Do not wait for the
   performance task for the worst of it: in Task 15's commit, hide the road cars from the
   bridge when a planet's detail finishes loading (set `visible = false` on every object
   under the model whose name starts with `road-car:`; do not edit `galaxy/`). Record the
   new total in `m1-notes.md`. The island stays, because the agent's cannon fires from
   it in the second plan; it and the rest of the budget belong to that plan's Task 18.

### Waiting for the owner

Do **not** build these until the owner says which. Until then, follow the rows below.

- **A closer look at one town.** Pinching a town could bring that town up to about 0.5 m
  across, so its buildings are 3 to 5 cm and can be picked one by one, with a Back
  control returning to the globe. Without it, buildings are decoration.
- **The rest of the galaxy while landed.** At the landed scale the other planets hang
  around the user as half-metre globes and the black hole fills the left of the view.
  They could be hidden while landed, leaving the one globe and the stars.

## M1 + M2 plan (`m1-m2-galaxy-and-code.md`)

| Task | Change |
| --- | --- |
| 5 The galaxy system, Step 3 | The anchor is an invisible point in the air, not a table top: position `[0, 1.05, -0.95]`, orientation pitched 20° down from level, width `1.0`, `minScale 0.0005`, `maxScale 5`. The names `tablePose` and `TableAnchor` in `src/core/table-frame.ts` stay as they are; only the numbers change. Screenshots now show the model floating, larger, in the middle of the view. A landed globe stays 0.64 m across (the owner's choice, already built) with its centre at `[0, 1.10, -0.95]`. |
| 6 Labels | The selected file's or function's label is a marker: micro label over a small diamond. No pointer triangle. |
| 9 Turning and zooming | As built: one pinch dragged in the air turns the model; two pinches zoom the overview. While landed the globe keeps its size and a two-hand zoom does nothing. |
| 10 Info cards, loading, errors | `CanvasPanel` becomes a **window**: glass panel, close mark, and a grab bar beneath it that moves the window when pinched and dragged (give the window's entity a grab component for translate and rotate, constrained to 0.5–1.4 m from the seat; pressing the close mark hides it). Do **not** show a card when a file is pinned or hovered: ignore context items whose key starts with `file:`. Keep cards for the other context items the copied code raises (the cannon, the station, the moon) as **attached cards**: placed 12 cm above and 8 cm to the side of their anchor, no line. Loading and error cards are unchanged. |
| 11 The room | **No table.** Build only the floor: a large dark disc at height 0 with a faint grid in `grid` that fades with distance, and keep the star field. Nothing sits under the model. The check becomes: the screenshot shows the model floating above a faint floor grid, with no disc or rim under it. Commit: `Add a floor so the room has a stable frame`. |
| 14 The code page | Becomes the **code card**: 0.46 × 0.34 m, about 12 rows (`rows: 12`, `columns: 56`), on a 1380 × 1020 canvas with 26 px code text. It opens to the right of the model when `codeView` gains a selected function or range, and closes when the selection clears or its close mark is pressed. Footer: `More` toggles 12 and 24 rows (the card grows downward). Remove the `Function / Whole file`, `Page up` and `Page down` buttons; a vertical drag still scrolls, and the range shown is always the selected function with 3 lines of context. Update the tests in `code-view.test.ts` to these numbers. In `layout.ts`, `codePage` becomes `codeCard` at its new size and the test's limits still apply. |
| 15 Linking | Renamed **Linking towns and code**. Buildings on the 0.64 m globe are millimetres across, so the link is at the level of a function. **Model to card:** the copied `planet-interaction.js` already does this without a building: a ray on the globe's surface hovers the region it falls in (`ownerOfDir`) and a click opens that function. Confirm it through the hit volume, outline the selected town in `line`, and open the card on the function. A click that does land on a building still selects its statement. **Card to model:** a press on a line still calls `onStatement` for the smallest element containing it, so the copied highlight shows, and the globe turns so that the function's town faces the user (the copied code already moves its camera to the town; the pose follows). There are no page buttons to wire. `showCode(path, line)` lands if needed, selects the function, and opens the card with the line banded. In the same commit hide the road cars, as "What the 0.64 m globe means" says. Check: the Task 15 smoke command still returns a range that includes line 90, and `__orrery.stats().triangles` while landed is at least 800,000 lower than the 2,430,000 recorded above. Commit: `Link towns and code in both directions`. |
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
