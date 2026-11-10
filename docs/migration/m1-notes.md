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
