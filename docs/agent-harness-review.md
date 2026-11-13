# Agent harness review: user interactions and tools

Date: 2026-11-12. Reviewed at `d758d93` (main). Nothing was changed.

## How this was checked

- **Run, recorded agent:** the built app (`dist/`) loaded as a browser tab with no query parameter, driven through
  `__orrery.commands.chatAction`.
- **Run, stand-in model:** the same build with `?agent=live`, where `/api/providers` and `/api/agent` were answered by a
  local script that returns whatever wire events a test needs. This is the only way the harness has been exercised off
  the recorded path. It is not a real model: no provider key is set on this machine, and
  `docs/migration/m3-m4-report.md` says no provider has ever been called through the relay.
- **Cards as drawn:** each window's canvas was saved as a PNG from the running page.
- **Read only:** marked as such. Nothing here was checked in a headset or with emulated pinches; the pinch walk-through
  of the recorded path is already in `docs/migration/m3-m4-report.md`.
- **Scene:** screenshots of the browser tab during the recorded fix, with the app's own warnings captured (there were
  none). The agent's marker, its "Recorded · Thinking" label and its beams to `range.ts` appear; the ten activity rows
  are all "ok". A tab is not a headset: distances and what is in view may differ.

## Blocking: the app is not yet an agent a visitor can talk to

### 1. A visitor always gets the recording, and it ignores what they say (run; the provider list by reading)

- The relay is only consulted when the address has `?agent=live` (`src/index.ts:70`). Without it, Settings and the More
  row offer one provider, "Recorded". There is no hands-only way to reach a live model.
- The recording picks its next reply by counting tool results (`src/core/agent/recorded.ts:13`). "Explain the fix" as a
  first message, and "What does the tokenizer folder do?", both produced the same search, read, pointer, plan and scope
  question as "Fix it".
- After the scripted fix, every further message gets "That is the end of the recorded session."
- The live path has never run against a real provider (M4 Task 19 is open). There is no `vercel.json`; whether
  anything is deployed was not checked.

### 2. Voice is the only free-form input, and it may not exist on the headset (read, plus sources)

- `src/index.ts:45` uses the browser's speech recognition. There is no server transcription adapter.
- Developer reports on Meta's forums say the headset browser does not support it. Meta's browser specifications page
  says to detect features at run time and does not mention speech recognition. `docs/headset-session.md` already calls
  it unknown.
- If it is missing, the whole harness is the four chips. Three of them ("Show me the function", "Fix it", "Explain the
  fix") only make sense in order, and with a live model none carries the context it needs (finding 6).
- Two smaller voice problems, by reading: a second utterance replaces the first instead of adding to it
  (`src/core/chat/composer.ts:70`, confirmed by a run with the fake microphone), and recognition is single-utterance
  (`src/adapters/browser-speech.ts:45`), so a pause while holding the microphone ends the capture.

## Bugs a live model will hit

### 3. A proposed edit that cannot apply hangs the turn for good (run)

- With the default "Workspace" permission, `replace_in_file` whose `old_text` is missing or not unique fails its
  preview (`src/systems/agent-system.ts:454`) and reports `toolFinished`. The loop only accepts that for a call in the
  `running` state (`src/core/agent/loop.ts:162`); this call is in `approval`, so the event is dropped.
- Result: the row shows failed, no card appears, the model is never called again, and the chat reads "working" until
  the user pinches Stop. Under "Full access" the same edit returns the error to the model and the turn continues.
- This is the most common mistake a real model makes with this tool, and the demo file is tab-indented.

### 4. The relay's rate limit throws away the chat and the approved fix (run)

- When `/api/agent` answers `rate_limited` or `budget_spent`, the switch falls back to the recording
  (`src/adapters/agent-switch.ts:21`) and sets the provider to "recorded". The agent system treats that as a provider
  change (`src/systems/agent-system.ts:86`): it stops the turn, opens a different chat and resets the workspace.
- Result in the run: an empty chat, the problem card red again, the fix gone, and the notice "the recorded agent takes
  over". The recording then replays its script whatever is asked.
- The fix cannot be got back. The chat was last saved when Approve was pinched, before the edit ran, so reopening it
  from the chat list shows the edit as failed and the file still broken.
- Pinching New chat while a turn is running after an approval loses the approved edit the same way.
- The limit is 30 model calls in five minutes per visitor (`api/_lib/limits.ts:7`). The scripted fix alone is 7 calls.
  How many a real model needs per request is not measured; a few requests in five minutes would reach 30.

### 5. A wrong fix turns the problem card green, and the replay says "passes" (run)

- `isFixed` only checks that the broken text is gone (`src/core/scenario.ts:47`). Changing `>=` to `<` turned the card
  green.
- `run_replay` plays a canned run (`src/core/agent/run-tool.ts:73`). It showed "fixed · passes" while the bug was still
  in the file, because it ran in the same reply as the edit, before the edit was approved.
- In a project with no scenario it tells the model "Replaying the fixed run in the scene" and plays nothing.
- The system prompt tells the model to call it after every fix (`src/core/agent/prompt.ts:12`).

### 6. The model is not told what the user is looking at (run)

- First message "Fix it": the model received exactly "Fix it". The problem card's text is never sent.
- A file selected at the overview, and a landed planet with no code card: the model received only the user's words.
- Context is attached only when the code card is open with lines selected (`src/systems/agent-system.ts:517`), and then
  only those lines (97–99), not the function.

## What the user sees when the agent points, asks and edits

### 7. The "Show me" card cannot be read (cards as drawn, on the default path too)

- The message column is about eight characters wide (`src/panels/draw-problem-card.ts:58` reserves 140 units for two
  62-unit buttons). The recording's own message renders as "This / end-ed / ge…".
- The Dismiss button hangs below the card's bottom edge.

### 8. Pointing does not move the scene, keeps one place, and is wiped by the next message (run)

- `show_user`'s description tells the model "the scene flies there" (`src/core/agent/tools.ts:45`). It only does so with
  "Follow the agent" on, and that defaults to off (`src/core/settings.ts:40`).
- Two `show_user` calls in one reply left only the second. The transcript folds them into "Called 2 tools".
- The next user message clears the pointer (`src/systems/agent-system.ts:541`).
- The attached cards sit beside the file's star, and hide when it is more than 2.5 m away
  (`src/systems/callout-system.ts:26`). Since functions became planets, landing on the bug's own function puts its
  star out of reach. Sampled in a tab after Approve on the recorded path: the green "Fixed" card, the pointer card and
  the "Agent is debugging" card were shown for about 2.5 s during the fly-in, on top of each other, then all three
  hid. The debugging card (Follow ship, Stop following, Dismiss) stayed hidden for the whole replay, and the card had
  left by the time the scene settled.
- A pointer at a neighbouring file sat 4 cm from the problem card; the cards are 24 cm wide, so they overlap. Only a
  pointer at the bug's own file is lifted clear.

### 9. The code card hides the bug (cards as drawn)

- Lines are cut at 56 columns (`src/panels/draw-code-card.ts:18`). Line 97 of `core/range.ts` ends "&& p…": the `>=`
  the whole scenario is about is not visible, before or after the fix. It is readable in the chat's diff; the Flow
  list and the 24-row view were not checked.
- The stepper label ("containsPosition · n of 39") is drawn under the Flow button
  (`src/panels/draw-code-card.ts:226`).

### 10. Saying the answer into the main microphone does not answer a question (run)

- With a question card open, words said into the composer's microphone become a follow-up with Steer and Queue. Steer
  shows the words as a sent message, but the loop holds a steer until the open call is answered
  (`src/core/agent/loop.ts:148`), so the card keeps waiting.

### 11. Review and recovery

- The approval card's diff is closed until "Review changes" is pinched, so Approve can be pinched without seeing it.
- No undo: after an approved edit nothing in the chat reverts it. Decline cannot carry a reason.
- New chat resets the workspace without warning (`src/systems/agent-system.ts:179`): the fix is gone and the card is red
  again. Reopening the old chat should bring it back when the turn had finished (by reading; not run).
- A failed turn shows the error but no Retry; the route is Reuse on the last message, then Send.
- A reply cut off by `max_tokens` ends quietly: a half sentence and a failed row, with no note
  (`src/core/agent/loop.ts:114`).
- A relay that never answers runs until Stop; there is no time limit.
- `/compact` does nothing (`src/systems/agent-system.ts:561`) while the relay refuses requests over 2 MB
  (`api/_lib/relay.ts:12`). Unlikely within a ten-minute session.

## The tools

| Tool | State |
| --- | --- |
| `list_files`, `read_file`, `update_plan`, `ask_user` | Work as described. A question with no options gets "You decide" plus voice. |
| `search` | Case-sensitive plain text. A file path in `path` returns "No matches." because it is treated as a folder (`src/core/workspace.ts:66`). |
| `replace_in_file` | Finding 3. |
| `write_file` | Works, including new files. Whether a new file appears in the galaxy was not checked. |
| `show_user` | Findings 7 and 8. |
| `run_replay` | Finding 5. |

Missing, in order of value for an agent that lives inside a code visualiser:

1. **The galaxy's own model.** `functions.json` holds 878 functions and 848 calls, and no tool reads it. A
   `find_function` and a `callers` tool would let the agent answer "who calls this?" and light the call lanes.
2. **Where the user is.** The selected file, the landed function and the problem card's text, sent with each message.
3. **Moving the scene.** A tool (or `show_user` itself) that selects or lands on a file or function, so the agent's
   words and the model move together.
4. **Undo.** A button that puts the files back to the start of the turn (`workspace.markTurn` already keeps it).

Running code or tests is out by design (nothing runs in the browser), so the only "verification" is the canned replay.

## Suggested order

1. Findings 3 and 4: small code fixes, and both end a live demo.
2. Finding 1: offer the live provider without the query parameter, then do the live check with the owner's key.
3. Findings 7, 8 (the cards hiding after the fix), 9 and 5: all are on the default path a judge sees.
4. Findings 6, the rest of 8, and 10: make the agent and the scene act together.
5. Finding 2: decide after one sentence is tried on a headset; the fallback is context-aware chips or server
   transcription.

## Sources for finding 2

- https://communityforums.atmeta.com/discussions/dev-quest/speechrecognition-in-webxr/1168273
- https://communityforums.atmeta.com/discussions/dev-general/speech-to-text-library-react-speech-recognition-not-working-in-oculus-quest-2-br/1188891

## Status after the fixes (2026-11-12, branch `agent-harness-fixes`)

Checked with the stand-in model and the recorded agent in a browser tab, and with `npm run verify`. Live results are
in the last section. Nothing was checked in a headset.

| Finding | Now |
| --- | --- |
| 1. Always the recording | The live provider answers whenever the relay holds a key; no query parameter. `?agent=recorded` forces the recording, and a recorded chat says "Recorded agent: it replays one prepared fix, whatever is asked." Hosting is still to do. |
| 2. Voice | Not changed, apart from the main microphone answering an open question card (finding 10). Waiting on the owner's choice. |
| 3. An edit that cannot apply hangs | The error goes back to the model and the turn continues. |
| 4. Rate limit wipes the chat | The turn fails with the relay's message and a Retry button; the chat, its edits and the provider stay. The limit is 90 model calls in five minutes. A spent budget hands a chat to the recording only when the chat has not started. A chat is saved the moment an edit is applied, so the fix survives a failure, a new chat or a reload. |
| 5. Wrong fix turns green | Fixed means the original text is back. `run_replay` is refused, as an error the model reads, when the project has no problem card or when "fixed" is asked while the problem is open. |
| 6. No context | Every message carries a bracketed note: the open problem card (a chat's first message), then the code card's function and selected lines, or the landed function, or the selected file. The "What I'm looking at" chip shows the same place. |
| 7. Unreadable pointer card | The card is taller, the message runs across it for up to four lines, and the buttons sit in a row under it. |
| 8. Pointing does not move the scene | "Follow the agent" is on by default: the scene lands on the function and the code card opens at the line with the agent's message under its header. Each pointer stays in the transcript with its message and a "Show me" action. A pointer card beside the problem card sits above it. |
| 8. Cards hide after the fix | While landed on a function of the card's own file, the problem, pointer and debugging cards dock above the code card (above the globe when the code card is closed). |
| 9. Code card hides the bug | Selected lines wrap onto continuation rows, so the picked statement is readable to its end. The stepper note is cut where the buttons begin. |
| 10. Main microphone and questions | While a question card is open, the main microphone fills that question's spoken answer. |
| 11. Review and recovery | The approval card opens with its diff in view. "Undo these changes" under the latest turn's diff puts the files back and tells the model with the next message. A failed turn has Retry. A reply that is cut off or refused says so. A model call with no event for 90 seconds fails the turn. New chat says the files went back and where the changes are. A declined edit tells the model not to resend it and to ask what is wanted. `/compact` is unchanged. |
| Tools | `search` takes one file as `path`, and a folder with a trailing slash. New `find_function` reads the galaxy's function map: where a function is, what calls it and what it calls. |

Found while testing the fixes, and fixed: after an approved edit to the landed file, the planet was rebuilt showing the
file's largest function, and the code card closed. The rebuilt globe now shows the same function, and the card stays
open on the same lines with the new text.

Two safety nets were added after the first live run, so the judged moment does not depend on what the model chooses
to call: an approval card brings up the code the edit changes (when "Follow the agent" is on and the scene is not
already there), and the fixed run replays by itself 1.5 s after the problem closes.

Checked only by unit test and by reading: the main microphone answering a question card (the test rig cannot hold the
microphone region). Checked on a desktop only: the code card staying open through a rebuild.

Limits that remain:

- "Fixed" means the broken line reads as it did before the bug. A correct fix written another way leaves the card red,
  and `run_replay` tells the model so. Nothing runs in the browser, so there is no better check.
- New chat still puts the files back (it now says so). `/compact` still does nothing.
- Visitors get the relay's default model (`claude-opus-5-5`); every live result below is `claude-sonnet-5-5`.
- Not done: voice; a newly written file appearing in the galaxy (not checked); hosting; the headset session.

## Live runs (2026-11-12, `claude-sonnet-5-5`, effort medium, through the local relay)

The first calls of a real model through the app (M4 Task 19, step 3). Three conversations, 21 model calls in all,
driven by a script that plays the user: it sends the message, answers questions with the first option and approves or
declines edits. Prompt caching works: from the second call on, the prompt and tools are read from the cache.

| Run | What was said | What happened |
| --- | --- | --- |
| 1 (before the prompt was tightened) | The first chip: "Find why the end of a selection is treated as outside it" | 3 calls, 15 s. Read the file, made the right edit, card turned green. It never pointed at the code, so the scene did not move, and it ended with "once you approve the edit, I'll replay": it took a successful edit as still waiting for approval. This led to the prompt changes, the "The user approved it" result and the two safety nets. |
| 2 | "Fix it", nothing else | 7 calls, 15 s then 4 s. The note about the problem card was enough to find the function. Its first edit did not match the file (wrong indentation): the error went back and it retried with success, which is finding 3 on a real model. The approval card brought up lines 97–99, the model called `run_replay` itself, and for "Explain the fix" it pointed at line 97. |
| 3 | Landed on the function with its code open: "Who calls this?", then "Add a short comment above the end check…", declined | 11 calls, 7 s then 30 s. It read "this" from the note, called `find_function`, then `search`, and listed callers in three other files. Two edits were refused as not unique and it re-read the file; the third was declined, and it asked what was wanted with three options; given "Fix the bug", it made the fix and replayed it. |

Across the runs, three of the four first edit attempts did not apply. Before finding 3 was fixed, each would have left
the turn hanging.

Seen in the live transcript and fixed: code inside bold text ("**`file.ts:84`**") was drawn with its backticks.

The system prompt and tool descriptions are final as of run 2; `npm run dev:api` must be restarted after either
changes.

