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
Angles computed from the room geometry for a head at the origin, looking straight ahead and pitched down.

| Element | Seated, eyes 1.2 m, 25° down | Standing, eyes 1.6 m, 25° down |
| --- | --- | --- |
| Table far edge | 0° / +5° | 0° / −13° |
| Table left / right edge | ∓34° / −9° | ∓29° / −29° |
| Table near edge (10 cm in front of the head) | 0° / −50° **out** | 0° / −58° **out** |
| Landed globe top / bottom | 0° / +22°, 0° / −26° | 0° / −13°, 0° / −38° |
| Overview galaxy far corners | −21°, +27° / +20° | −18°, +24° / +3° |
| Overview galaxy near corners | −43°, +52° / −24° **out** | −35°, +44° / −41° (right **out**) |

Looking straight ahead (no pitch) the table's sides and the landed globe's lower half fall below the view; a seated
user needs to look about 15–25° down. Two things do not fit at any comfortable angle:

- the table's near edge, which sits under the chin because the head is only 10 cm behind it;
- the overview's near corners, because the copied home view frames the galaxy about 1.1 m wide and 0.3 m beyond the
  table anchor.

The panel positions are decided in Task 14, whose layout tests keep every panel within ±32° and between 20° below and
12° above eye level, inside these limits; they are checked in Task 19.

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

## Field of view with the panels (narrower glasses view)

Panel corners from a seated eye at 1.2 m (`src/core/layout.ts`):

| Panel | Looking straight ahead | Looking 15° down |
| --- | --- | --- |
| Code page | 12°..52° right, −34°..+17° — right part **out** | 11°..55°, −19°..+32° — **out** |
| Dock | −13°..+13°, −22°..−16° | −12°..+12°, −7°..−1° |
| Tutorial | −11°..+11°, +7°..+13° | −12°..+12°, +22°..+28° — top **out** |

The layout rules (centres within ±32°, −20°..+12°) hold, but a 0.86 m page at 1.2 m is 40° wide: on the glasses the
user turns about 15–20° toward it to see it whole. On Quest it fits.

## Draw calls and triangles

| View | Draw calls | Triangles |
| --- | --- | --- |
| Overview | 116 | 212,984 |
| Landed globe (`core/range.ts`) | 167 | 2,806,325 |
| Landed globe with the code page | 171 | 2,916,133 |

The landed counts vary by a few percent between runs with what the copied code has built at that moment.
