# M1 notes: the galaxy on the table

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
