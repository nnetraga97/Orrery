# M1 notes: the galaxy in the room

> The walk-through and baseline below record the first build, with a table and a file info card; the design review
> removed both (see "After the design review").

Recorded on 2026-11-10 at the end of Part 1 of `docs/plans/m1-m2-galaxy-and-code.md` (Task 12).

## Hand-only walk-through (emulator)

Desktop emulator, Quest 3 profile, hand input mode, driven with `npx @iwsdk/cli xr ...` and read back through
`tools/xr-eval.mjs`. Orbits were paused (`#speed` = 0) so a millimetre-sized planet stays under the ray between
aiming and pinching.

| Step | Result |
| --- | --- |
| Enter VR | Session presenting |
| Point at a planet and pinch | `config/editorOptions.ts` selected; its info card is shown above it |
| Pinch it again | Phase `landed`, landed path `config/editorOptions.ts`; globe 0.64 m across with its towns |
| Pinch in the air and drag 20 cm | The globe turned (model rotation changed); nothing was selected |
| Two-hand pinch apart | Landed: no change. The globe is capped at 0.64 m (owner's choice), and zooming out is limited by the copied planet code's own camera distance limits. In the overview the model grew (scale 0.00216 → 0.00551) |
| `__orrery.commands.goHome()` | Phase `overview`, nothing selected, the home view restored |

## Field of view (narrower glasses view)

Limits: 37° either side, 25° up, 43° down, measured against the view axis (`.claude/skills/iwsdk-glasses-test`).
Remeasured after the design review (`docs/plans/changes-after-review.md`): there is no table, and the model floats at
`[0, 1.05, -0.95]`, pitched 20° down, 1.0 m wide. Angles for a seated eye at 1.2 m at the origin, from the room
geometry; overview bounds measured in a browser tab (x −0.38..0.75, y 1.02..1.38, z −1.63..−0.88).

| Element | Looking straight ahead | Looking 15° down |
| --- | --- | --- |
| Overview model | −23°..+40°, −12°..+6° (right edge **out**) | −23°..+40°, +3°..+21° (right edge **out**) |
| Landed globe (0.64 m, centre `[0, 1.10, −0.95]`) | −19°..+19°, −24°..+13° | −19°..+19°, −9°..+28° (top **out**) |

Looking straight ahead the landed globe fits whole. The overview's right edge falls outside because the copied home
view frames the galaxy off-centre; the competition is judged on Quest 3 and 3S, whose view is far wider, so the model
is not shrunk or moved to fit the glasses.

## Draw calls and triangles (baseline)

`__orrery.stats()` in a browser tab (`npm run smoke:xr`, built page, 1440 × 900, editor-core):

| View | Draw calls | Triangles |
| --- | --- | --- |
| Overview | 110 | 210,928 |
| Landed globe (`core/range.ts`, detail ready) | 157 | 2,850,369 |

# M2 notes: reading code

> Superseded by "After the design review" below. This section records the first build: the table, the code page, the
> dock, the palm menu and the project picker have since been removed or replaced.

Recorded on 2026-11-10 at the end of `docs/plans/m1-m2-galaxy-and-code.md` (Task 19).

## Hand-only walk-through (emulator)

Same set-up as above, starting on the project picker (no `?dataset=`). Every step by hand input only.

| Step | Result |
| --- | --- |
| Pinch the "Editor core" card | Project opened; phase `overview` |
| Point at a planet and pinch | `config/editorOptions.ts` selected; info card shown |
| Pinch it again | Phase `landed`; globe 0.64 m on the table; code page shown, function mode |
| Pinch and drag | The globe turned |
| Pinch a building (open its town, read its code) | Its statement selected (line 2969); the page scrolled to it |
| Pinch line 2967 on the page | The building holding it selected (range 2967), so its town focus moved to it |
| Drag the page up 6 cm | Scrolled 120 → 122.9 lines |
| Page down | Scrolled to 149 |
| Whole file | Mode `file`, scrolled to keep the selection in view |
| Home on the dock | Phase `overview`, nothing selected, the code page hidden |
| Tutorial (separate run) | All four steps completed by hand; "seen" stored; the panel hid |
| Palm menu | Shows when the left palm faces the head, hides when it turns away; its Code button works with the right hand's ray |

Building hover from a hand ray is not forwarded to the landed planet (pinches are); hovering lines on the page works.

## Field of view with the windows (narrower glasses view)

Window corners from a seated eye at 1.2 m (`src/core/layout.ts`), after the design review:

| Window | Looking straight ahead | Looking 15° down |
| --- | --- | --- |
| Code card (0.46 × 0.34 m, 30° right, 1.0 m) | +17°..+43°, −18°..+8° (right edge **out**) | +17°..+45°, −3°..+23° (right edge **out**) |
| Chat window (0.40 × 0.72 m, 30° left, 1.1 m) | −40°..−20°, −29°..+16° (left edge **out**) | −44°..−18°, −14°..+31° (left edge, top **out**) |
| Tutorial card (0.30 × 0.10 m, 12° up, 1.0 m) | −9°..+9°, +9°..+15° | −10°..+10°, +24°..+30° (top **out**) |

Every window's centre is inside the glasses' view (the layout tests keep centres within ±32° and −20°..+12°). On the
glasses the user turns about 10° toward the code card or the chat to see its outer edge; on Quest every window fits.
The tutorial card sits above the model, so it is in view looking straight ahead, not looking down.

## Draw calls and triangles

| View | Draw calls | Triangles |
| --- | --- | --- |
| Overview | 116 | 212,984 |
| Landed globe (`core/range.ts`) | 167 | 2,806,325 |
| Landed globe with the code page | 171 | 2,916,133 |

The landed counts vary by a few percent between runs with what the copied code has built at that moment.

## Road cars hidden (Task 15, after the design review)

On the 0.64 m globe a road car is 2 to 5 mm long. The bridge hides every object under the model whose name starts with
`road-car:` while landed (`src/systems/galaxy-system.ts`; nothing in `galaxy/` changes). Measured in one browser-tab
session, landed on `core/range.ts` with `showCode('core/range.ts', 90)`, by showing the cars again for one frame:

| Landed | Triangles |
| --- | --- |
| Cars shown | 3,177,452 |
| Cars hidden | 2,208,900 |
| Saved | 968,552 |

The saving is above the 800,000 the change list asks for. The total is not below its 1,630,000 target: this session's
landed count with cars shown was 3.18 million, not the 2.43 million the change list measured, because more of the
landed planet's detail had been built. What remains: town buildings and props about 1,140,000, the island's
landmarks and houses about 530,000, dependency arcs about 220,000, the other planets about 200,000. The island and the
rest of the budget belong to the next plan's Task 18; hiding the other planets while landed waits for the owner.

# After the design review

Recorded on 2026-11-10, after `docs/plans/changes-after-review.md` was applied (commits "Apply the design review
changes", "Link towns and code in both directions", "Add the chat window shell and its tab strip").

## Hand-only walk-through (emulator)

Desktop emulator, Quest 3 profile, hand input, headset at a seated 1.2 m and both hands resting at 0.95 m (the layout's
seat; standing at 1.6 m the tutorial card sits on the ray from a resting hand to the model). Orbits paused. Every step
by hand ray and pinch only.

| Step | Result |
| --- | --- |
| Open the app (no `?dataset=`) | `editor-core` opens directly; 229 files; tutorial step 1 shown |
| Point at the glowing planet and pinch | `config/editorOptions.ts` selected; its marker shown; no card for the file; tutorial step 2 |
| Pinch in the air and drag | The model turned; selection kept; tutorial step 3 |
| Pinch the planet again | Landed; globe 0.64 m; code card **absent** (the copied code's own start town is not the user's pick); tutorial step 4 |
| Pinch a town on the globe | Town 72 selected; code card opened on its function; tutorial done, "seen" stored, card hidden (the town outline was checked in a browser tab) |
| Pinch another town | Town 75 (`computeLayout`); the card shows it instead |
| Pinch a line on the card (line 3016) | That statement selected on the globe |
| Drag the card's text up | Scrolled 5.9 lines; the card did not move |
| `More` | 24 rows; the card grew downward |
| The card's close mark | Card gone; the town stays selected |
| `Home` on the tab strip | Phase `overview`; nothing selected; no code card |
| Chat window: grab bar, close mark, Chat tab | Moved with the ray, strip following; hidden; brought back |

Two fixes came out of this walk-through: with both hands resting, the idle hand's ray reached the model too and
wiped out the pointing hand's hover each frame, and a window under the idle hand's ray blocked the other hand's
orbit. The scene kit now keeps one ray per hand and gives the hover to the hand that hits something, and the orbit
check asks only the pinching hand's own ray.

## Draw calls and triangles

`__orrery.stats()` in a browser tab (`npm run smoke:xr`, built page, 1440 × 900), road cars hidden:

| View | Draw calls | Triangles |
| --- | --- | --- |
| Overview | 116 | 210,556 |
| Landed globe (`core/range.ts`, no code card) | 161 | 2,285,087 |
| Landed globe with the code card (`showCode('core/range.ts', 90)`) | 136 | 2,225,664 |

The landed counts vary between runs with how much detail the copied code has built and where its camera flew (the
card view flies to another town, so fewer buildings are drawn than in the plain landing).

# Meta VR Glasses

Recorded on 2026-11-10. The glasses run the same browser and WebXR as Quest 3 and 3S, with eye gaze for aiming plus a
hand pinch, no controllers in the box, and a narrower view (70° × 66°; recommended area for essential UI 58° × 54°).
The app now requests gaze as an optional feature (`gazeTracking: true` in `iwsdk.config.json`); without it, hand rays
aim as before. To test in the emulator set `dev.emulator.device` to `metaVRGlasses`.

## Gaze and pinch (emulator, glasses profile, seated)

`gaze-tracking` and `hand-tracking` granted. Gaze aimed with `xr look-at`, pinches with the right hand.

| Step | Result |
| --- | --- |
| Look at the glowing planet and pinch | Selected; tutorial step 2 |
| Look at empty space, pinch and drag the hand | The model turned |
| Look at the planet and pinch | Landed |
| Look at a town and pinch (twice) | Towns 54 and 75 selected; card opened; tutorial done |
| Look at a line on the card and pinch | That statement selected (line 2161) |
| `More`, the card's close mark, `Home` on the tab strip | 24 rows; card closed; back to the overview |
| Look at the chat's grab bar, pinch, move the hand 15 cm | The window followed the hand |
| Look at the card's text, pinch, move the hand up 12 cm | Scrolled 5.85 lines |
| Gaze disconnected: hand ray on a line, on a town | Both work |
| Gaze reconnected | Gaze aims again (three more towns picked) |

Fixes this needed:

- During a gaze pinch IWSDK moves the pointer onto the pinching hand, so a drag follows the hand. The press and click
  events then carry the hand's ray, which no longer points at what the eyes chose. Clicks on the model and presses on
  windows now use where the pointer aimed just before the pinch.
- Windows capture the pinch and measure drags where the ray meets the window's plane, so a drag continues when the
  hand's ray leaves the window.
- Gaze's cone tie-break (nearer surface) chose the model's hit volume over a window inside it. A comparer now lets a
  window win that tie, as pointer priority already did for hand rays.
- The pinch check for turning the model uses the gaze pointer while gaze aims.
- The tutorial says "Look at …" when gaze aims.

## Field of view

Looking straight at the landed globe, the globe fits; the chat window's left side and tab strip, and the code card's
right side, fall outside the view. Turned about 25° toward either window, the whole window fits (chat 21° × 36°,
code card 26° × 19°). The overview model's right edge falls outside looking straight ahead. Not changed.

Not checked: real eye-tracking accuracy on small targets (code lines are about 1.2° tall), and comfort, on the device.

## Start-up time (M4, Task 17)

From navigation to the first frame with the galaxy shown and taking input (`__orrery.startupMs`), in the headless
desktop browser of the smoke test, served from the local build: 552, 460 and 472 ms over three loads. The goal was
under 5 s. The agent's cannon and its island now join after that first frame (`attachCannon`), and the chat's fonts
load before its first draw. A served deployment adds network time for `graph.js` and the first models; the headset
session should measure it there.

## Draw budget (M4, Task 18)

Budgets: at most 300 draw calls and 750,000 triangles at each of three states. `__orrery.stats()` in the smoke test's
browser tab (1440 × 900, editor-core), the landed state on `core/range.ts`, "all panels" adding the code card, a
replay, the agent's "Show me" card, the chat and the problem card. The landed counts vary between runs (339 to 391
calls) with where the copied camera flew.

| State | Before (calls / triangles) | After (calls / triangles) | Budget met |
| --- | --- | --- | --- |
| Overview | 121 / 211,266 | 121 / 211,266 | yes |
| Landed | 339 / 3,394,393 | 348–389 / 2,038,435–2,040,663 | **no** |
| Landed, all panels | 176 / 1,871,557 | 125 / 1,116,175 | calls yes, triangles **no** |

Reductions applied, in the plan's order: the light (`-lod`) model of every rig (the arc ship alone was 354k triangles);
at most six ship hulls drawn at once (the rest are engine glints, which still take a pinch); the island's modelled
buildings only for its first landmark and first house (the rest are simple blocks, and their sheets are not loaded);
the label pool lowered from 32 to 24. Switches in `src/galaxy-bridge/budget.js`, added to the copied code by
`tools/migrate/apply-patches.mjs`.

Not met: what remains landed is the landed planet's own towns (about 0.95 million triangles from the copied town
renderer), the other planets' library models (about 0.3 million) and the cannon's district and moons. Merging static
town props (the plan's last step) would cut draw calls but not triangles, and was not done: the town renderer builds
its instanced batches itself. Reaching 750,000 needs one of: lighter towns (fewer or simpler buildings on the landed
globe), or hiding the rest of the galaxy while landed, which is waiting for the owner's decision
(`docs/plans/changes-after-review.md`, "Waiting for the owner"). The device session (item 3) will show whether the
headset holds its frame rate anyway.

## Headset tier (M4, Task 18)

`node tools/assets/build-assets.mjs <codebase-viz> --tier=quest` writes `public/assets-quest/` (99.6 MB): textures at
most 512 px for the kit, vehicles and buildings and 1024 px elsewhere, and the island's and cannon's geometry quantized
(KHR_mesh_quantization; three's loader reads it without a decoder). The app uses it in a headset's browser, or with
`?tier=quest` (`src/galaxy-bridge/asset-tier.ts`, through three's loading manager).

Initial download, before a planet is opened (resource timing in the smoke test's browser, all files):

| Tier | Total | Models and images | Code |
| --- | --- | --- | --- |
| Full | 43.1 MB | 39.4 MB | 3.2 MB |
| Headset | 37.5 MB | 33.8 MB | 3.2 MB |

The budget was under 40 MB: met by the headset tier. The landed towns are identical in both tiers (same triangle
counts). Fixed foveation is set to a medium level (0.5) each time an immersive session becomes visible; the
framebuffer scale is left at its default.

## Meta VR Glasses with the agent (M4, Task 20)

Emulator, glasses profile, seated, `gaze-tracking` granted. Every window open (the chat, its tab strip, the code card
with a replay, the problem card, the agent's "Show me" card, the debugging card, the tutorial card). Angles of each
window's corners from the eye looking straight ahead (the view is 37° left and right, 25° up, 43° down):

| Window | Horizontal | Vertical | In view looking ahead |
| --- | --- | --- | --- |
| Chat | −40.8° to −19.2° | −31.8° to 15.4° | its left edge is cut |
| Tab strip | −43.6° to −40.8° | −2.1° to 13.1° | no: an 8° head turn left |
| Code card | 16.7° to 43.3° | −24.5° to 7.4° | its right edge is cut |
| Problem card | 3.2° to 16.3° | 12.2° to 19.2° | yes |
| "Show me" card | 3.1° to 16.3° | 18.6° to 25.5° | its top half-degree is cut |
| Debugging card | 3.0° to 15.5° | 21.1° to 27.5° | its top is cut |
| Tutorial card | −8.8° to 8.8° | 7.4° to 14.9° | yes |

Every window comes fully into view with a head turn of 10° or less up, or 25° or less to the side, as before. The
cards stack upward beside the bug's planet; on the glasses the third card reaches past the top of the view.

Gaze and pinch on the new controls: looking at the microphone and holding a pinch heard "Fix it"; Send with a
left-hand pinch; holding "Say your answer" by gaze heard the answer; an option chosen by gaze; a gaze-started drag on
the transcript scrolled it.
