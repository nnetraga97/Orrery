# Visual style: light on glass

This is how every panel, label, marker and surface in Orrery should look. It applies to
all tasks in both plans that draw something. Where a plan gives a colour or a look that
differs from this page, this page wins.

The reference sheet is `docs/style/hologram-reference.png`, and the code that drew it is
`docs/style/mock.html`. Its drawing functions (`glowStroke`, `glassPanel`, `microLabel`,
`marker`, `ridges`, `button`) are written to be copied into panel drawing code.

![Reference sheet](style/hologram-reference.png)

## Where the look comes from, and where it must stop

The owner's reference is the ship interfaces in the film *Passengers* (2016), made by
the team at MPC London. What we take from it is a **design language**: thin lines of
cool light on dark glass, a single warm colour for anything that needs attention, small
capital labels, diamond markers with a pointer, ridge charts that step back in depth,
and interfaces that turn to face the person.

What we do **not** take: any frame, screen layout, logo, icon, wording or asset from the
film. The competition requires original work and forbids commercial artwork, and a
design language is free to learn from while a specific screen is not. Concretely:

- Do not copy an image from the film or from a site about it into the repository.
- Do not reproduce a recognisable screen (the timeline of numbered days, the pod
  diagnostics, the ship's logo or name).
- Every shape here is drawn by our own code from the tokens below.

## The five rules

1. **Light, not paint.** Lines and shapes glow against darkness. Draw a line twice: a
   wide faint pass, then a thin bright one, with additive blending. No drop shadows, no
   gradients on buttons, no rounded cards.
2. **Glass you can read on.** Text always sits on a dark backing that is at least 85%
   opaque. Purely additive, see-through elements never carry text the user must read.
   The film's screens look wonderful and are often hard to read; ours must be read.
3. **Cool is information, warm is attention.** Blues and white for everything normal.
   Amber and orange-red only for the bug, an error, a step marker, or the one thing the
   user should look at now. If a view has more than three warm things, it has too many.
4. **Thin and exact.** Lines are 1 to 2 pixels on a panel canvas. Corners are square.
   Panels are framed by a hairline and four corner brackets, not a border all round.
5. **Small capitals for names, sentences for sentences.** Labels, titles and buttons are
   uppercase with wide spacing. Anything longer than five words is ordinary sentence case
   in the body font.

## Tokens

Put these in `src/core/theme.ts` as constants (it is pure data, so it belongs in core)
and use them everywhere. Do not write a colour or a font anywhere else.

| Token | Value | Used for |
| --- | --- | --- |
| `ink` | `#06101f` at 88% opacity | The backing of every text panel |
| `grid` | `#1b3b5c` | Faint rules, the table's grid, dividers |
| `lineDim` | `#2f6f9f` | Resting outlines, line numbers, the far rows of a ridge chart |
| `line` | `#7fd4ff` | Active outlines, labels, keywords in code |
| `glow` | `#2aa7ff` | The fill of a hovered or pressed button, selection bands |
| `white` | `#eaf6ff` | Body text, identifiers in code, the bright core of a line |
| `amber` | `#ffb21a` | Attention labels, pointers, the bug line's band and edge |
| `alert` | `#ff5a36` | The fill of an attention diamond, failures |
| `ok` | `#5fe0c0` | Success, added lines in a diff, literals in code |
| `work` | `#d97757` | The rotating working glyph only |

| Font token | Value | Used for |
| --- | --- | --- |
| `label` | Barlow Condensed 600, uppercase, letter spacing 2 px at 15 px | Labels, titles, buttons |
| `body` | Barlow 400 | Sentences |
| `mono` | JetBrains Mono 400 | Code |

All three fonts have open licences and install from npm (`@fontsource/barlow-condensed`,
`@fontsource/barlow`, `@fontsource/jetbrains-mono`). Load them with `FontFace` before the
first panel is drawn. Sizes are set per panel in pixels of that panel's canvas and scale
with the `textScale` setting.

Diff colours follow the same rule: added lines on an `ok` band at 16%, removed lines on
an `alert` band at 16%, hunk headers in `lineDim`.

## Components

| Component | How it looks | Where it is used |
| --- | --- | --- |
| **Glass panel** | `ink` backing, hairline frame in `lineDim` at 60%, four glowing corner brackets in `line`, title as a micro label at the top left | Code page, chat, replay, settings, info cards, problem card |
| **Micro label** | The `label` font in `line`, or `amber` for attention | Every title, every scene label, button text |
| **Marker** | A micro label, a diamond below it, and a small triangle pointing down at the thing. Attention: `alert` fill, `amber` outline and pointer. Focus: `ink` fill, `line` outline and pointer | Selected file, selected town, the bug's location, the agent's "show me", replay steps |
| **Focus ring** | A thin `line` circle around the focused body, with a partial `amber` arc when the agent is pointing at it | The selected planet or town; replaces the white ring sprite |
| **Button** | Outline in `lineDim` at rest; on hover the outline brightens to `line` and the inside fills with `glow` at 20%; pressed fills to 42% | Every button and chip. A button is at least 4.5 cm tall in the room |
| **Ridge chart** | Rows of thin lines stepping back in depth, every fourth row brighter, soft peaks, markers standing on the peaks | The replay timeline: one peak per step, the current step's marker in focus colours. Also the idle state of the table |
| **Band** | A full-width strip at 16% opacity with a 3 px solid edge on the left | Selected lines (`glow`), hovered lines (`glow` at 8%), the bug line (`amber`) |
| **The table** | A dark disc with a `grid` ring every 10 cm, short tick marks around the rim, and one bright `line` rim | Under the galaxy |

Scene labels (file and function names above the model) use the marker's micro label on a
small `ink` plate so they stay readable over stars.

## Motion

- **Things draw on.** A panel appears by its corner brackets extending, then its frame,
  then its contents, in about 250 ms. Lines in a ridge chart sweep in from one side.
- **Things face you.** Panels and labels turn smoothly toward the head, never snapping.
- **One slow pulse.** The thing that needs attention breathes between 70% and 100%
  brightness once every 1.6 s. Nothing else pulses.
- **Reduce motion** (a setting) removes the draw-on, the pulse and the rotating glyph.

## In the room

Additive light looks right against darkness and washes out against brightness, so the
room stays dark: the star field, a dark floor, and one or two thin bright strips at the
table's rim as the only "lighting". On three.js materials use additive blending with
`depthWrite: false` and `toneMapped: false` for glowing lines, and keep panel textures
ordinary (not additive) so their backing stays dark. Do not add a bloom post-process: it
costs too much on a headset. The two-pass stroke is the glow.

**High contrast** (a setting) turns the backing fully opaque black, text pure white,
drops additive decoration, and thickens outlines to 3 px.

## How the plans apply this

| Plan and task | What changes |
| --- | --- |
| M1+M2 Task 6, labels | Micro label on an `ink` plate; the selected label becomes a focus marker |
| M1+M2 Task 10, canvas panels and info cards | `CanvasPanel` draws the glass panel; add `src/core/theme.ts` and `src/panels/draw-kit.ts` with the functions from `mock.html` |
| M1+M2 Task 11, the room | The table as described above; a dark floor; bright rim strip |
| M1+M2 Task 14, code page | Glass panel; token colours: keywords `line`, identifiers `white`, literals `ok`, comments `lineDim`; bands as above |
| M1+M2 Tasks 16–18, dock, picker, tutorial | Buttons and micro labels from the kit |
| M3+M4 Tasks 4, 5, 8, chat | Glass panel; the user bubble is an outlined box in `lineDim` rather than a filled one; action icons in `line`, failures in `alert`; the working glyph keeps `work` |
| M3+M4 Task 11, problem card | An attention marker over the table and a glass card; turns to `ok` when fixed |
| M3+M4 Task 14, replay | The timeline is a ridge chart with one step marker per step |
| M3+M4 Task 16, settings | High contrast and reduce motion as defined here |

Work already finished before this page arrived is restyled in one commit, "Apply the
light-on-glass style", before the next task that draws something.

## Sources

Reading about how the film's interfaces were made, for the design language only:

- A gallery of the film's interface work by MPC London: <https://www.hudsandguis.com/home/2019/passengers>
- An interview with the studio's creative director on the film: <https://www.pushing-pixels.org/2017/06/14/the-art-and-craft-of-screen-graphics-interview-with-ryan-jefferson-hays.html>
- A feature on designing interfaces for films, with MPC London's motion designer: <https://www.techradar.com/news/spaceship-dashboards-and-future-computers-designing-ui-for-film>
- A review of the film's technology that singles out the muted palette and curved transparent screens: <https://community.element14.com/members-area/engineering-life/b/blog/posts/engineer-at-the-movies-reviews-passengers-2016>
