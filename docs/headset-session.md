# Headset session

A script for two hours on a Quest (3 or 3S), in priority order: if time runs out, the items at the top matter most.
Each item says what to look for and what to change if it fails. Sit down for all of it; the app is designed for a
seated user.

## Before you start

- On the computer: `npm run dev` (the dev server) and, for the live agent only, `npm run dev:api` in a second terminal
  with the provider key in that terminal's environment (never in a file).
- On the headset, open the dev server's network URL (`npx @iwsdk/cli dev status` lists it) in the browser on the same
  Wi-Fi, and accept the local certificate warning. Add `?dataset=editor-core` (the default) and, for the live agent,
  `&agent=live`.
- The headset tier (`public/assets-quest/`) is chosen automatically in a headset's browser; `?tier=full` forces the
  full one for comparison.
- Have the browser's performance overlay ready (Quest browser: the developer settings' performance HUD, or OVR Metrics
  Tool) for item 3.

## 1. Enter VR and hands

Pinch `Enter VR`. The room is dark with a grid floor, the galaxy floats in front, the chat window stands on the left
with its tab strip. Put the controllers down: both hands should appear and their rays reach the windows.

- **If it fails:** no hands: the browser's hand-tracking permission (prompted once per origin) was refused; allow it in
  the browser's site settings. No VR button: the page is not on HTTPS (use the network URL, not `http://`).

## 2. Microphone and one sentence

Pinch and hold the microphone at the right end of the chat's composer, say "Fix it", let go. The words should show
while you speak and stay as the pending message with `Send` and `Cancel`.

- **If it fails:** a notice "Voice isn't available here" means the browser refused the microphone or has no speech
  recognition; allow the microphone in site settings and reload. Words cut off: hold a little longer after speaking
  (`WAIT_MS` in `src/core/speech.ts` is how long the app waits for the final words after you let go).

## 3. Frame rate at three states

With the overlay showing frames per second:

1. The overview, nothing selected.
2. Landed on a planet (pinch a planet twice).
3. Landed, with the code card, the chat, the problem card and a replay all showing (pinch "Show me the function", then
   the Replay tab).

The target is the headset's 72 frames per second, steady. Note the numbers for each state.

- **If it fails:** first try `?tier=quest` explicitly and compare. Then lower `VISIBLE_HULLS` in
  `src/galaxy-bridge/budget.js`, the label pool `POOL` in `src/galaxy-bridge/label-layer.ts`, and the foveation
  `FOVEATION` in `src/systems/pause-system.ts` (towards 1). The landed towns are the heaviest part (about 0.95 million
  triangles); see "Draw budget" in `docs/migration/m1-notes.md`.

## 4. Reading the code card

Pinch a town on the landed globe so the code card opens: can you read its 12 lines comfortably? Try `More` (24 lines),
then the Settings tab's text sizes 100%, 120% and 140%.

- **If it fails:** note the smallest size that reads well and make it the default `textScale` in
  `src/core/settings.ts`. At 140% the code card overlaps the globe from the seat; if that is the size people need,
  move the card further right in `SPEC.codeCard` (`src/core/layout.ts`).

## 5. Reach from the seat

Without leaning, pinch: every tab of the tab strip, the chat's suggestion chips, `Send`, an option of a question,
`Approve once`, the microphone, the code card's `More`, `Back`, `Step`, `Play`, the problem card, and the close marks.
Is the tab strip easy to hit? Does moving a window by its grab bar feel steady?

- **If it fails:** buttons too small: the button height in `Builder.buttons` (`src/core/chat/layout.ts`) and the tab
  cell `CELL` in `src/panels/draw-tab-strip.ts`. A window out of reach: its placement in `SPEC`
  (`src/core/layout.ts`), or the Seat height setting. A shaky grab bar: the turn rate `TURN_RATE` in
  `src/panels/canvas-panel.ts`.

## 6. The whole scenario with voice

Pinch the red problem card (the chat opens with the first prompt ready), say "Fix it" instead, send it. Watch the
agent search, read, point at the function and ask how far the fix should go; hold "Say your answer" and say "Fix only
this function", then `Send answer`. Review the change, pinch `Approve once`. The problem card should turn green for
five seconds; the agent replays the fixed run on the code card.

- **If it fails:** note where. Speech misheard: speak the option's words exactly; the options can always be pinched.

## 7. The same with no voice

Reload. Do item 6 only by pinching: the suggestion chips, the option, `Send answer`, `Approve once`.

- **If it fails:** any step that needed voice is a bug against the competition rules (hands only): note it.

## 8. Anything uncomfortable

Note anything that strains: text at the edge of view, windows too close or too far, flicker, the floor, motion while
the model turns, sounds too loud or too frequent (Settings: Volume, Sounds, Reduce motion).

- **If it fails:** reduce motion and volume are settings; distances are in `SPEC` (`src/core/layout.ts`); the sound
  recipes are `src/core/sound.ts`.

## Unknown until this session

- Speech recognition in the Quest browser (it may be missing or need a network connection).
- Frame rate at the three states, and whether the headset tier's initial download (37.5 MB measured on a desktop
  browser) loads in reasonable time over Wi-Fi.
- Readability of 12 code lines, and the best default text size.
- Whether the grab bar and the tab strip feel steady and easy to hit with real hands.
- How the foveation level looks on text.
