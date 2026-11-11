# M3 + M4 report

The report Task 20 of `docs/plans/m3-m4-agent-and-polish.md` asks for. Deviations task by task are in
`docs/migration/m3-notes.md`; measurements are in `docs/migration/m1-notes.md`.

## Tasks

| Task | Result |
| --- | --- |
| 1–17 | Passed: built, tested, `npm run verify` green, checks run as each task describes (or as recorded in the notes). |
| 18 | Partly: the headset asset tier and its initial download (37.5 MB, under 40 MB) and the renderer step pass; the landed draw budget is **not met** (about 350–390 calls and 2.0 million triangles against 300 and 750,000). |
| 19 | **Not done**: no provider key was given. Everything runs on the recorded session. The `?record=1` switch and a way to read cache usage in the browser are still to be built at that step. |
| 20 | This report. Walk-through, glasses check and parity below; branch pushed, not merged. |

## Walk-through (emulator, Quest 3 profile, seated, hands only)

| Step | Result |
| --- | --- |
| Tutorial: point, turn, open, read | All four done by pinch; the code card opened on the town pinched |
| Pick the project (Settings tab) | Both baked projects listed, the open one lit |
| Problem card | Opened the chat with the first prompt ready |
| Send, watch the agent work | Search, read, "Show me" card, plan card |
| Answer its question | Option pinched, Send answer |
| Review and approve the edit | "Review changes" opened the diff; Approve once; the card turned green, then left |
| Replay the fix | The agent's replay started; Step pinched twice on the code card (3 / 5) |
| Change two settings | Volume to 25% and high contrast on; both applied |

Found and fixed during the walk-through: with another planet landed, the problem card followed the bug's planet out of
reach (about 58 m away); attached cards now hide until their planet comes back. Found and fixed just before it: a
reload restored the chat without its fix in the workspace; a stopped turn left rows running; a steer made a second
plan card. Screenshot: `docs/migration/xr-walkthrough-m4.png`.

## Glasses (emulator, glasses profile)

All windows' centres are in view; the chat's left edge, the code card's right edge, the tab strip and the top of the
third stacked card are outside the view looking straight ahead, and come into view with a head turn of 25° or less.
Gaze and pinch worked for the microphone (hold), Send, "Say your answer" (hold), an option, and dragging the
transcript. Details: `docs/migration/m1-notes.md`, "Meta VR Glasses with the agent".

## Chat feature parity

| Desktop feature | Met | Notes |
| --- | --- | --- |
| User bubble with attachment chips | yes | The chip names the open file and lines |
| Agent Markdown | yes | Headings, lists, code with language, inline code, bold |
| Emoji | yes | Drawn by the canvas; colour on the headset unchecked |
| Reuse, Reply | yes | Copy dropped, as planned |
| Thinking row, "Thought for 8s", expandable | yes | |
| Action rows: wording and icons | yes | |
| Live rows shimmer; failed rows red with alert | yes | Live rows are lit rather than pulsing (the style page allows one pulse) |
| Expanded detail: terminal, diff, tool arguments and result | yes | |
| Action groups with summary and failures | yes | |
| Plan card | yes | |
| "Changed N files this turn" | yes | |
| Working line with ✳ in `work` | yes | |
| Question card; secret questions refused | yes | Options pinchable; "Say your answer" by voice |
| Approval card | yes | |
| Footer status | yes | |
| Error bar | yes | Tested in layout; a live failure not exercised |
| Thread title, New chat | yes | |
| Welcome text with prompts | yes | |
| Chat list with badges, resume last chat | yes | Restores the chat with its workspace edits |
| Composer: microphone, see the words, Send or Cancel | yes | |
| Stop | yes | |
| Steer, Queue, Say it again, Remove, Resume queue | yes | Steer and Queue checked in the emulator; Say it again by the pure tests |
| Slash commands in "More" | partly | `/compact` only says the chat is short enough: the browser loop has no compaction |
| "What I'm looking at" chip | yes | |
| Model, effort, permission, mode: in the Settings tab of the chat window | yes | Also in "More" |
| Provider switch, only providers with a key | yes | Not checked against a live relay |
| "This provider is not available." | yes | |
| Context line, "N files changed" starts a review | yes | |
| Auto-scroll only near the bottom | yes | |
| "Show me" card and follow mode | yes | Follow mode is the "Follow the agent" setting |
| "Agent is debugging" card | yes | |

## Providers checked live

None: no key was supplied (Task 19 skipped).

## Draw budget (three states)

| State | Calls | Triangles | Budget (300 / 750,000) |
| --- | --- | --- | --- |
| Overview | 121 | 211,266 | met |
| Landed | 348–389 | about 2.04 million | not met |
| Landed, all panels | 125 | 1,116,175 | triangles not met |

What remains is the landed planet's towns (about 0.95 million), the other planets' library models and the cannon's
district. Closing the gap needs lighter towns, or hiding the rest of the galaxy while landed (waiting for the owner).

## Download and start-up

Initial download before a planet is opened: 37.5 MB on the headset tier, 43.1 MB on the full tier. Start-up to the
first interactive frame: about 0.5 s on a desktop browser (552, 460, 472 ms).

## Unknown until the device session (`docs/headset-session.md`)

- Speech recognition in the Quest browser.
- Frame rate at the three states.
- Whether 12 code lines read comfortably, and the best default text size.
- Whether the tab strip is easy to hit and the grab bar feels steady with real hands.
- Download time of the headset tier over Wi-Fi; how the foveation looks on text.
- Sound levels, and pausing (the emulator cannot blur a session).

## Questions for the owner

- The provider names ("Claude", "OpenAI", "Nemotron") are shown in Settings, and the headset tier is named "quest"
  (`public/assets-quest/`, `?tier=quest`). The rules forbid brand names in anything shown to users and in file names:
  what should they be called?
- The two items under "Waiting for the owner" (a closer look at one town; hiding the rest of the galaxy while landed);
  the second would close most of the draw-budget gap.
- The Claude key and a daily budget for Task 19.
